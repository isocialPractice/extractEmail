/**
 * helpers/objects.mjs
 *
 * Strict output-format standards for extracted email data.
 *
 * PURPOSE
 * -------
 * Guarantees that every script / task formatting email-extraction results for
 * a post-process (batch script, shell script, piped command) uses one
 * consistent block-marker convention, and emits an unambiguous
 * -??EXTRACTION_ERROR block whenever the extraction is incomplete or invalid.
 *
 * The post-process checks for that specific opening tag and skips the task
 * immediately, preventing downstream breakage from empty or malformed data.
 *
 * BLOCK FORMAT
 * ------------
 * Every data section is wrapped in an opening and closing tag:
 *
 *   Opening :  -??MARKER_NAME       (hyphen prefix + double-? + name)
 *   Closing  :  ??MARKER_NAME-       (double-? + name + hyphen suffix)
 *
 * Example:
 *   -??DATE_RANGE
 *   02/01/2026 to 03/23/2026
 *   ??DATE_RANGE-
 *
 * POST-PROCESS DETECTION
 * ----------------------
 * An extraction error is signalled by the unique opening tag:
 *   -??EXTRACTION_ERROR
 *
 * BAT script check (detect and skip):
 *   echo %scriptOutput% | findstr /C:"-??EXTRACTION_ERROR" >nul 2>nul
 *   if %ERRORLEVEL%==0 goto :_skipTask
 *
 * Shell script check:
 *   grep -qF -- '-??EXTRACTION_ERROR' result.txt && continue
 *
 * CLI USAGE (for calling from BAT / shell scripts)
 * -------------------------------------------------
 *   node helpers/objects.mjs --eval-map <file>
 *       Evaluate a narrowRequestedData map output file.
 *       Exits 1 and writes an error block to stdout when extraction is invalid.
 *       Exits 0 (no output) when the extraction is valid.
 *
 *   node helpers/objects.mjs --is-error <file>
 *       Exits 1 when the file contains a -??EXTRACTION_ERROR block.
 *       Exits 0 otherwise.
 *
 *   node helpers/objects.mjs --create-error <CODE> <reason text…>
 *       Writes a formatted error block to stdout and exits 1.
 *       Use this inside a BAT script to emit a standard error when a
 *       custom condition occurs without re-implementing the format.
 *
 * INTEGRATION EXAMPLE (BAT script)
 * ---------------------------------
 *   node "%~dp0..\helpers\narrowRequestedData.js" -m frfcReports.json -f "%msg%" > "%tmp%\map.txt"
 *
 *   node "%~dp0..\helpers\objects.mjs" --eval-map "%tmp%\map.txt" > "%tmp%\err.txt" 2>nul
 *   if %ERRORLEVEL%==1 (
 *       type "%tmp%\err.txt"
 *       goto _cleanUp
 *   )
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// BLOCK MARKER FORMAT
// ---------------------------------------------------------------------------

/**
 * Marker names used in the block convention.
 * @type {Readonly<{[key: string]: string}>}
 */
export const MARKERS = Object.freeze({
  ATTACHMENTS:      'ATTACHMENTS',
  DATE_RANGE:       'DATE_RANGE',
  RECIPIENT:        'RECIPIENT',
  CARDHOLDER:       'CARDHOLDER',
  EXTRACTION_ERROR: 'EXTRACTION_ERROR',
});

/**
 * Build the opening tag for a block.
 * @param {string} markerName - One of the MARKERS values
 * @returns {string}  e.g. "-??DATE_RANGE"
 */
export function openTag(markerName) {
  return `-??${markerName}`;
}

/**
 * Build the closing tag for a block.
 * @param {string} markerName - One of the MARKERS values
 * @returns {string}  e.g. "??DATE_RANGE-"
 */
export function closeTag(markerName) {
  return `??${markerName}-`;
}

/**
 * Wrap content in an extraction block.
 * @param {string} markerName - One of the MARKERS values
 * @param {string} content    - Content to wrap (may be multi-line)
 * @returns {string}
 */
export function wrapBlock(markerName, content) {
  return `${openTag(markerName)}\n${content}\n${closeTag(markerName)}`;
}

// ---------------------------------------------------------------------------
// ERROR CODES
// ---------------------------------------------------------------------------

/**
 * Standard error codes for extraction failures.
 * @type {Readonly<{[key: string]: string}>}
 */
export const ERROR_CODES = Object.freeze({
  NO_FILES_MATCHED:  'NO_FILES_MATCHED',
  NO_DATE_RANGE:     'NO_DATE_RANGE',
  NO_RECIPIENT:      'NO_RECIPIENT',
  NO_CARDHOLDER:     'NO_CARDHOLDER',
  EMPTY_ATTACHMENTS: 'EMPTY_ATTACHMENTS',
  PARSE_FAILURE:     'PARSE_FAILURE',
  INVALID_RESULT:    'INVALID_RESULT',
});

// ---------------------------------------------------------------------------
// EXTRACTION ERROR BUILDERS
// ---------------------------------------------------------------------------

/**
 * Build a standard extraction-error block.
 *
 * The post-process detects "-??EXTRACTION_ERROR" in the output and skips the
 * task entirely, leaving no side-effects.
 *
 * @param {string}  reason  - Human-readable description of the failure
 * @param {string}  [code]  - One of ERROR_CODES (defaults to INVALID_RESULT)
 * @param {string}  [detail] - Optional additional context
 * @returns {string}  The complete error block, ready to write to stdout
 */
export function buildExtractionError(
  reason,
  code = ERROR_CODES.INVALID_RESULT,
  detail = ''
) {
  const lines = [
    `CODE: ${code}`,
    `REASON: ${reason}`,
  ];
  if (detail) lines.push(`DETAIL: ${detail}`);
  return wrapBlock(MARKERS.EXTRACTION_ERROR, lines.join('\n'));
}

/**
 * Test whether a text string contains an extraction-error block.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isExtractionError(text) {
  return typeof text === 'string' && text.includes(openTag(MARKERS.EXTRACTION_ERROR));
}

// ---------------------------------------------------------------------------
// RESULT VALIDATION
// ---------------------------------------------------------------------------

/**
 * Fields that a complete extraction result must supply.
 * Each field is validated independently so the post-process knows which
 * part of the extraction failed.
 */
export const REQUIRED_FIELDS = Object.freeze([
  'attachments',  // Array<{filename: string, path: string}> — non-empty
  'dateRange',    // string  e.g. "02/01/2026 to 03/23/2026"
  'recipient',    // string  email address or display name
  'cardholder',   // string  account / cardholder name
]);

/**
 * Validate an extraction result object.
 *
 * @param {{
 *   attachments : Array<{filename: string, path: string}>,
 *   dateRange   : string,
 *   recipient   : string,
 *   cardholder  : string,
 * }} result
 * @param {{ requireAttachments?: boolean }} [options]
 *   requireAttachments  (default true) – treat an empty attachments array as
 *                        an error; set false to allow tasks that only need
 *                        date/recipient/cardholder data.
 * @returns {{ valid: boolean, errors: Array<{field: string, code: string, reason: string}> }}
 */
export function validateResult(result, options = {}) {
  const { requireAttachments = true } = options;
  const errors = [];

  if (!result || typeof result !== 'object') {
    errors.push({
      field: 'result',
      code: ERROR_CODES.INVALID_RESULT,
      reason: 'Result is null or not an object',
    });
    return { valid: false, errors };
  }

  if (requireAttachments) {
    if (!Array.isArray(result.attachments) || result.attachments.length === 0) {
      errors.push({
        field: 'attachments',
        code: ERROR_CODES.EMPTY_ATTACHMENTS,
        reason: 'No attachments found or matched for the extracted date range',
      });
    }
  }

  if (!result.dateRange || !String(result.dateRange).trim()) {
    errors.push({
      field: 'dateRange',
      code: ERROR_CODES.NO_DATE_RANGE,
      reason: 'No date range could be extracted from the email',
    });
  }

  if (!result.recipient || !String(result.recipient).trim()) {
    errors.push({
      field: 'recipient',
      code: ERROR_CODES.NO_RECIPIENT,
      reason: 'No recipient was resolved from the email',
    });
  }

  if (!result.cardholder || !String(result.cardholder).trim()) {
    errors.push({
      field: 'cardholder',
      code: ERROR_CODES.NO_CARDHOLDER,
      reason: 'No cardholder / account name was provided',
    });
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// RESULT BUILDING
// ---------------------------------------------------------------------------

/**
 * Build the full standard extraction output string.
 *
 * When validation fails the function returns an extraction-error block
 * instead of the normal blocks, so the post-process always receives either
 * well-formed data or a detectable error — never an empty / partial result.
 *
 * @param {{
 *   attachments : Array<{filename: string, path: string}>,
 *   dateRange   : string,
 *   recipient   : string,
 *   cardholder  : string,
 * }} result
 * @param {{ requireAttachments?: boolean }} [options]
 * @returns {string}  Complete block output or a -??EXTRACTION_ERROR block
 */
export function buildExtractionResult(result, options = {}) {
  const { valid, errors } = validateResult(result, options);

  if (!valid) {
    const primary = errors[0];
    const detail = errors.length > 1
      ? `Additional failures: ${errors.slice(1).map(e => e.field).join(', ')}`
      : '';
    return buildExtractionError(primary.reason, primary.code, detail);
  }

  const attachmentLines = [
    'export const emailAttachments = [',
    ...result.attachments.map(
      a => `{filename: '${a.filename}', path: '${a.path}'},`
    ),
    '];',
  ].join('\n');

  return [
    wrapBlock(MARKERS.ATTACHMENTS, attachmentLines),
    '',
    wrapBlock(MARKERS.DATE_RANGE, result.dateRange),
    '',
    wrapBlock(MARKERS.RECIPIENT, result.recipient),
    '',
    wrapBlock(MARKERS.CARDHOLDER, result.cardholder),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// BLOCK PARSER
// ---------------------------------------------------------------------------

/**
 * Parse all ??MARKER blocks from an output text string.
 *
 * @param {string} text
 * @returns {Object.<string, string>}  Map of marker name -> block content string
 */
export function parseBlocks(text) {
  if (!text) return {};
  const result = {};
  // Matches -??NAME\n<content>\n??NAME-  (non-greedy, dotAll)
  const blockRegex = /-\?\?(\w+)\n([\s\S]*?)\n\?\?\1-/g;
  let match;
  while ((match = blockRegex.exec(text)) !== null) {
    result[match[1]] = match[2];
  }
  return result;
}

// ---------------------------------------------------------------------------
// MAP OUTPUT EVALUATOR
// ---------------------------------------------------------------------------
// The narrowRequestedData.js CLI prints a human-readable summary to stdout.
// evalMapOutput() reads that text and decides whether the extraction was
// valid — specifically whether at least one file was matched.

/**
 * Evaluate the text output produced by narrowRequestedData.js.
 *
 * Returns an object describing whether the extraction is usable:
 *   { valid, reason, code, parsedDateRange, parsedRecipient, fileCount }
 *
 * @param {string} mapText  - Full stdout of narrowRequestedData.js
 * @returns {{
 *   valid          : boolean,
 *   reason         : string,
 *   code           : string,
 *   parsedDateRange: string|null,
 *   parsedRecipient: string|null,
 *   fileCount      : number,
 * }}
 */
export function evalMapOutput(mapText) {
  if (!mapText || !mapText.trim()) {
    return {
      valid: false,
      reason: 'narrowRequestedData produced no output',
      code: ERROR_CODES.PARSE_FAILURE,
      parsedDateRange: null,
      parsedRecipient: null,
      fileCount: 0,
    };
  }

  // Extract date range:  "?? Date Range: MM/DD/YYYY to MM/DD/YYYY"
  const dateMatch = mapText.match(/\?\? Date Range:\s*([^\n(]+)/);
  const parsedDateRange = dateMatch ? dateMatch[1].trim() : null;

  // Extract recipient:  "?? Recipient: "email@…""
  const recipientMatch = mapText.match(/\?\? Recipient:\s*"?([^\n"]+)"?/);
  const parsedRecipient = recipientMatch ? recipientMatch[1].trim() : null;

  // Count matched files under "++ FILES MATCHING:"
  const filesSection = mapText.match(/\+\+ FILES MATCHING:\n([\s\S]*?)(?:\n-{3,}|$)/);
  let fileCount = 0;
  if (filesSection) {
    fileCount = filesSection[1]
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .length;
  }

  if (!parsedDateRange) {
    return {
      valid: false,
      reason: 'No date range extracted from the email body',
      code: ERROR_CODES.NO_DATE_RANGE,
      parsedDateRange,
      parsedRecipient,
      fileCount,
    };
  }

  if (fileCount === 0) {
    return {
      valid: false,
      reason: `No files matched the extracted date range (${parsedDateRange})`,
      code: ERROR_CODES.NO_FILES_MATCHED,
      parsedDateRange,
      parsedRecipient,
      fileCount,
    };
  }

  return {
    valid: true,
    reason: '',
    code: '',
    parsedDateRange,
    parsedRecipient,
    fileCount,
  };
}

// ---------------------------------------------------------------------------
// CLI ENTRY POINT
// ---------------------------------------------------------------------------
// Enables BAT / shell integration without extra dependencies:
//
//   node helpers/objects.mjs --eval-map <file>
//       Exit 1 + write error block → extraction invalid
//       Exit 0 + no output         → extraction valid
//
//   node helpers/objects.mjs --is-error <file>
//       Exit 1 → file contains -??EXTRACTION_ERROR
//       Exit 0 → file is clean
//
//   node helpers/objects.mjs --create-error <CODE> <reason…>
//       Write error block to stdout and exit 1
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] === __filename;

if (isMain) {
  const args = process.argv.slice(2);
  const cmd  = args[0];

  if (cmd === '--eval-map') {
    const filePath = args[1];
    if (!filePath) {
      process.stderr.write('Usage: objects.mjs --eval-map <map-output-file>\n');
      process.exit(2);
    }
    if (!existsSync(filePath)) {
      process.stdout.write(
        buildExtractionError(`Map file not found: ${filePath}`, ERROR_CODES.PARSE_FAILURE)
        + '\n'
      );
      process.exit(1);
    }
    const mapText = readFileSync(filePath, 'utf-8');
    const result  = evalMapOutput(mapText);
    if (!result.valid) {
      process.stdout.write(
        buildExtractionError(result.reason, result.code) + '\n'
      );
      process.exit(1);
    }
    process.exit(0);

  } else if (cmd === '--is-error') {
    const filePath = args[1];
    if (!filePath) {
      process.stderr.write('Usage: objects.mjs --is-error <file>\n');
      process.exit(2);
    }
    if (!existsSync(filePath)) {
      process.exit(1); // missing file is treated as an error condition
    }
    const text = readFileSync(filePath, 'utf-8');
    process.exit(isExtractionError(text) ? 1 : 0);

  } else if (cmd === '--create-error') {
    const code   = args[1] || ERROR_CODES.INVALID_RESULT;
    const reason = args.slice(2).join(' ') || 'Extraction failed';
    process.stdout.write(buildExtractionError(reason, code) + '\n');
    process.exit(1);

  } else {
    process.stderr.write(
      [
        'helpers/objects.mjs — extraction output format standards',
        '',
        'Usage:',
        '  node objects.mjs --eval-map <map-output-file>',
        '      Evaluate narrowRequestedData output; exits 1 + writes error block on failure.',
        '',
        '  node objects.mjs --is-error <file>',
        '      Exits 1 when the file contains a -??EXTRACTION_ERROR block.',
        '',
        '  node objects.mjs --create-error <ERROR_CODE> <reason text>',
        '      Write a formatted -??EXTRACTION_ERROR block to stdout and exit 1.',
        '',
        'Error codes: ' + Object.values(ERROR_CODES).join(', '),
      ].join('\n') + '\n'
    );
    process.exit(2);
  }
}
