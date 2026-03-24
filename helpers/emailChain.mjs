/**
 * helpers/emailChain.mjs
 *
 * Detect and split chained / forwarded / reply email bodies into individual
 * message segments, then expose utilities to find the most useful segment
 * for downstream parsing (e.g. the segment that contains a date range).
 *
 * BACKGROUND
 * ----------
 * When an email is a reply-chain or forward, the raw body looks like:
 *
 *   [latest reply — usually empty or terse]
 *   ----------------------------------------
 *   From: …
 *   Sent: …
 *   To:   …
 *   Subject: …
 *
 *   [previous message body]
 *   ----------------------------------------
 *   …
 *
 * The segment that contains the actionable content (e.g. the date range
 * "02/01/2026 to 03/23/2026") is often NOT in the top segment — it is
 * buried in one of the quoted segments.  `emailChain.mjs` finds it.
 *
 * EXPORTS
 * -------
 *   isChainedEmail(body)                              → boolean
 *   splitChain(body)                                  → ChainSegment[]
 *   findBestSegment(segments, opts?)                  → ChainSegment | null
 *   extractBestBody(body, opts?)                      → string
 *   extractBestBodyByTask(body, pattern, type, opts?) → string  ← task-aware entry point
 *   SEGMENT_TYPES                                     — named type constants
 *   classifySegment(body)                             → string
 *   classifyChain(segments)                           → { counts, dominantType, classified }
 *   classifyAndNarrowChain(body, opts?)               → string
 *
 * TYPE: ChainSegment
 * {
 *   index   : number,   // 0 = outermost / latest
 *   headers : object,   // { from, sent, to, subject } (may be empty for first)
 *   body    : string,   // text content of this segment
 * }
 *
 * CLI USAGE
 * ---------
 *   node helpers/emailChain.mjs --split        <file>
 *       Print a JSON array of all chain segments.
 *
 *   node helpers/emailChain.mjs --best-body    <file>
 *       Print the body of the best segment (first with a date range).
 *
 *   node helpers/emailChain.mjs --best-body-file <outfile> <infile>
 *       Write the best body to <outfile> (useful from BAT scripts to replace
 *       the tmp message.txt before passing to narrowRequestedData.js).
 *
 *   node helpers/emailChain.mjs --narrow             <file>
 *       Classify chain segments and print combined body of the dominant type.
 *
 *   node helpers/emailChain.mjs --narrow-by-task <outfile> <bodyPattern> <narrowTypeBy> <infile>
 *       Task-aware narrowing: filter segments by bodyPattern (e.g. a recurring
 *       signature), then pick the lowest-index segment satisfying narrowTypeBy,
 *       and write it to <outfile>.
 *       narrowTypeBy: "date-range" | "file-name:<name>" | "raw-data:<type>"
 *
 *   node helpers/emailChain.mjs --is-chained   <file>
 *       Exit 0 when the file contains a chained email, 1 otherwise.
 *
 * INTEGRATION EXAMPLE (BAT script — replaces the sed pipeline that builds
 * message.txt inside frfcCardholderReportRequest.bat)
 * -----------------------------------------------------------------------
 *   rem step 1 – capture the FULL body (no truncation at bodyPattern)
 *   echo "%body%" | sed "s/\\n/\n/g" | sed 1d > "%tmp%\raw.txt"
 *
 *   rem step 2 – task-aware narrowing: filter by bodyPattern, pick best segment
 *   node "%~dp0..\helpers\emailChain.mjs" --narrow-by-task "%tmp%\message.txt" "%bodyPattern%" "%narrowTypeBy%" "%tmp%\raw.txt"
 *
 *   rem step 3 – narrowRequestedData reads the already-correct message.txt (unchanged)
 *   node "%~dp0..\helpers\narrowRequestedData.js" -m frfcReports.json -f "%tmp%\message.txt" > "%tmp%\map.txt"
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// CHAIN SEPARATOR DETECTION
// ---------------------------------------------------------------------------

/**
 * Patterns that signal the start of a quoted/forwarded segment header.
 * Each separator line is a run of dashes or the classic Outlook-style
 * "From:" block that immediately follows a dashed divider.
 *
 * We recognise two forms:
 *   A) A line of 10+ dashes (Outlook "--------…--------" divider)
 *   B) A bare "From:" line that is NOT part of an email body sentence
 *      (i.e. appears at the start of a line, possibly with leading spaces)
 */
const DASH_DIVIDER_RE  = /^-{10,}\s*$/;

/**
 * After a dash divider the next non-blank line should be a chain header field.
 * Accepted header field names (case-insensitive):
 */
const CHAIN_HEADER_FIELDS = ['from', 'sent', 'to', 'subject', 'date', 'cc'];
const CHAIN_HEADER_RE = new RegExp(
  '^(' + CHAIN_HEADER_FIELDS.join('|') + ')\\s*:',
  'i'
);

// ---------------------------------------------------------------------------
// isChainedEmail
// ---------------------------------------------------------------------------

/**
 * Return true when the body text contains at least one chain divider
 * (a dash-separator followed by recognisable header fields).
 *
 * @param {string} body
 * @returns {boolean}
 */
export function isChainedEmail(body) {
  if (!body || typeof body !== 'string') return false;
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    if (DASH_DIVIDER_RE.test(lines[i].trim())) {
      // Look at the next few non-blank lines for header fields
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        const l = lines[j].trim();
        if (!l) continue;
        if (CHAIN_HEADER_RE.test(l)) return true;
        break; // first non-blank is not a header → not a chain divider
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// splitChain
// ---------------------------------------------------------------------------

/**
 * Split an email body into an ordered array of chain segments.
 *
 * Segment 0 is the outermost (latest) message; higher indices are older.
 * Each segment carries parsed header fields (from/sent/to/subject) when
 * preceded by a chain divider, and the trimmed body text.
 *
 * @param {string} rawBody
 * @returns {ChainSegment[]}
 */
export function splitChain(rawBody) {
  if (!rawBody || typeof rawBody !== 'string') return [];

  const lines = rawBody.split(/\r?\n/);
  const segments = [];

  // Boundaries: indices into `lines` where each segment starts.
  // Each boundary is { lineIndex, headers }.
  const boundaries = [{ lineIndex: 0, headers: {} }];

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (DASH_DIVIDER_RE.test(trimmed)) {
      // Try to collect header fields from the lines that follow
      const hdrs = {};
      let j = i + 1;
      while (j < lines.length) {
        const hLine = lines[j].trim();
        if (!hLine) { j++; continue; }
        const hMatch = hLine.match(/^(from|sent|to|subject|date|cc)\s*:\s*(.*)/i);
        if (hMatch) {
          hdrs[hMatch[1].toLowerCase()] = hMatch[2].trim();
          j++;
        } else {
          break;
        }
      }

      if (Object.keys(hdrs).length > 0) {
        // This divider introduces a new quoted segment.
        // The previous segment ends just before this divider.
        boundaries[boundaries.length - 1].endLine = i;
        boundaries.push({ lineIndex: j, headers: hdrs });
        i = j;
        continue;
      }
    }

    i++;
  }

  // Mark the end of the last segment
  boundaries[boundaries.length - 1].endLine = lines.length;

  // Build segment objects
  for (let idx = 0; idx < boundaries.length; idx++) {
    const { lineIndex, endLine, headers } = boundaries[idx];
    const bodyLines = lines.slice(lineIndex, endLine);
    const bodyText  = bodyLines.join('\n').trim();
    segments.push({
      index  : idx,
      headers: headers || {},
      body   : bodyText,
    });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// DATE RANGE DETECTION (lightweight — no dependency on narrowRequestedData)
// ---------------------------------------------------------------------------

/**
 * Quick check: does this text contain something that looks like a date range?
 * We accept:
 *   "MM/DD/YYYY to MM/DD/YYYY"
 *   "MM-DD-YYYY to MM-DD-YYYY"
 *   "from MM/DD/YYYY to MM/DD/YYYY"
 *   "between MM/DD/YYYY and MM/DD/YYYY"
 *   "last N months/weeks/days"
 *   "after MM/DD" / "since MM/DD"
 *   Inline dates like "02/01/2026" or "02-01-2026" appearing at least once
 *
 * @param {string} text
 * @returns {boolean}
 */
function hasDateRange(text) {
  if (!text) return false;
  const t = text;
  // Explicit "X to Y" or "X and Y" ranges
  if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\s+to\s+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/i.test(t)) return true;
  if (/(?:from|between)\s+\d{1,2}[\/\-]\d{1,2}/i.test(t)) return true;
  // Relative ranges
  if (/\b(?:last|past|previous|prior)\s+\d+\s*(?:month|week|day|year)/i.test(t)) return true;
  if (/\b(?:after|since|before)\s+\d{1,2}[\/\-]\d{1,2}/i.test(t)) return true;
  // Any fully-qualified date (has year)
  if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/.test(t)) return true;
  // Compact inline range: MM/DD-M/DD (forward-slash dates joined by a hyphen, no year)
  if (/\d{1,2}\/\d{1,2}-\d{1,2}\/\d{1,2}/.test(t)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// findBestSegment
// ---------------------------------------------------------------------------

/**
 * From an array of chain segments return the segment most likely to contain
 * the actionable content (date range, request details, etc.).
 *
 * Strategy (in order):
 *   1. First segment whose body contains a recognisable date range.
 *   2. First non-empty segment (fallback).
 *   3. null when segments is empty.
 *
 * @param {ChainSegment[]} segments
 * @param {{ prefer?: 'earliest'|'latest' }} [opts]
 *   prefer  'latest'   (default) — use the first match scanning from index 0
 *           'earliest' — use the last match scanning from the oldest segment
 * @returns {ChainSegment|null}
 */
export function findBestSegment(segments, opts = {}) {
  if (!segments || segments.length === 0) return null;

  const { prefer = 'latest' } = opts;
  const ordered = prefer === 'earliest'
    ? [...segments].reverse()
    : segments;

  // Priority 1: segment with a date range
  for (const seg of ordered) {
    if (hasDateRange(seg.body)) return seg;
  }

  // Priority 2: first non-empty segment
  for (const seg of segments) {
    if (seg.body.trim()) return seg;
  }

  return null;
}

// ---------------------------------------------------------------------------
// extractBestBody  ← PRIMARY ENTRY POINT FOR TASKS
// ---------------------------------------------------------------------------

/**
 * Given a full (possibly chained) email body string, return the body text
 * of the best segment for downstream date-range / content parsing.
 *
 * When the email is NOT chained the original text is returned unchanged.
 *
 * @param {string} rawBody
 * @param {{ prefer?: 'earliest'|'latest', stripCidLines?: boolean }} [opts]
 *   prefer        — passed to findBestSegment (default 'latest')
 *   stripCidLines — remove lines containing [cid:…] image refs (default true)
 * @returns {string}
 */
export function extractBestBody(rawBody, opts = {}) {
  if (!rawBody || typeof rawBody !== 'string') return rawBody || '';

  const { prefer = 'latest', stripCidLines = true } = opts;

  if (!isChainedEmail(rawBody)) {
    return stripCidLines ? removeCidLines(rawBody) : rawBody;
  }

  const segments = splitChain(rawBody);
  const best     = findBestSegment(segments, { prefer });
  if (!best) return rawBody;

  const body = best.body;
  return stripCidLines ? removeCidLines(body) : body;
}

// ---------------------------------------------------------------------------
// SEGMENT CLASSIFICATION
// ---------------------------------------------------------------------------

/**
 * Named segment types, exported so callers can branch on them.
 * @type {Readonly<{[key: string]: string}>}
 */
export const SEGMENT_TYPES = Object.freeze({
  ATTACHMENT_RECEIVED: 'attachment-received', // sender is providing/forwarding files
  SEND_DATA:           'send-data',           // requester asks for specific data
  DID_YOU_RECEIVE:     'did-you-receive',     // follow-up / chase: "did you get my email?"
  BOOLEAN_RESPONSE:    'boolean',             // yes/no question or confirmation
  UNCLASSIFIED:        'unclassified',
});

// Priority order for tiebreaking: index 0 wins over higher indices
const _TYPE_PRIORITY = [
  SEGMENT_TYPES.ATTACHMENT_RECEIVED,
  SEGMENT_TYPES.SEND_DATA,
  SEGMENT_TYPES.DID_YOU_RECEIVE,
  SEGMENT_TYPES.BOOLEAN_RESPONSE,
  SEGMENT_TYPES.UNCLASSIFIED,
];

/**
 * Classify a single segment body into one of SEGMENT_TYPES.
 *
 * @param {string} body
 * @returns {string} One of SEGMENT_TYPES values
 */
export function classifySegment(body) {
  if (!body || !body.trim()) return SEGMENT_TYPES.UNCLASSIFIED;
  const t = body.toLowerCase();

  // attachment-received: original message that delivers files / statements
  if (
    /\battach(ed|ment|ments)\b/.test(t) ||
    /\bstatements?\b/.test(t) ||
    /\bfiles?\s+(are\s+)?attached\b/.test(t) ||
    /\bplease\s+find\s+(the\s+)?attach/.test(t) ||
    /\b(enclosed|included|sending)\b.{0,40}\b(files?|docs?|documents?|statements?)\b/.test(t)
  ) {
    return SEGMENT_TYPES.ATTACHMENT_RECEIVED;
  }

  // did-you-receive: sender is chasing / checking if a previous email arrived
  if (
    /\b(just\s+wondering|was\s+wondering)\b/.test(t) ||
    /\bdid\s+you\s+(get|receive|see)\b/.test(t) ||
    /\bhave\s+you\s+(received|gotten|seen)\b/.test(t) ||
    /\b(checking\s+in|following\s+up)\b/.test(t) ||
    /\bany\s+update\b/.test(t)
  ) {
    return SEGMENT_TYPES.DID_YOU_RECEIVE;
  }

  // send-data: requester explicitly asks for data / information
  if (
    /\b(would\s+you\s+be\s+able|could\s+you|can\s+you|please\s+send|i\s+need|looking\s+for|requesting)\b/.test(t) ||
    /\b(show\s+me|how\s+many|how\s+much|what\s+is|what\s+are)\b/.test(t) ||
    /\b(provide|supply|forward\s+me|email\s+me)\b.{0,60}\b(report|data|file|record|statement|document)\b/.test(t)
  ) {
    return SEGMENT_TYPES.SEND_DATA;
  }

  // boolean: yes/no question or affirmation/denial (must contain a question mark or explicit token)
  if (
    /\?/.test(t) &&
    !/\battach/.test(t) &&
    (
      /\bare\s+you\s+(going|able|planning|available|coming)\b/.test(t) ||
      /\b(yes|no|confirmed?|denied?|correct|incorrect|agree|disagree)\b/.test(t) ||
      /\bwill\s+you\b/.test(t) ||
      /\bdo\s+you\s+(plan|intend|want)\b/.test(t)
    )
  ) {
    return SEGMENT_TYPES.BOOLEAN_RESPONSE;
  }

  return SEGMENT_TYPES.UNCLASSIFIED;
}

/**
 * Classify all segments in a chain, count type occurrences, and return the
 * dominant type together with the classified segments.
 *
 * @param {ChainSegment[]} segments
 * @returns {{
 *   counts       : Object.<string, number>,
 *   dominantType : string,
 *   classified   : Array<ChainSegment & {type: string}>,
 * }}
 */
export function classifyChain(segments) {
  const classified = segments.map(seg => ({
    ...seg,
    type: classifySegment(seg.body),
  }));

  // Count each type
  const counts = {};
  for (const seg of classified) {
    counts[seg.type] = (counts[seg.type] || 0) + 1;
  }

  // Find dominant type — most frequent, tiebreak by _TYPE_PRIORITY order
  let dominantType = SEGMENT_TYPES.UNCLASSIFIED;
  let maxCount = 0;
  for (const type of _TYPE_PRIORITY) {
    const count = counts[type] || 0;
    if (count > maxCount) {
      maxCount = count;
      dominantType = type;
    }
  }

  return { counts, dominantType, classified };
}

/**
 * Detect chain, classify segments, combine all segments of the dominant type
 * into a single body string, and return it for use in downstream parsers
 * (e.g. narrowRequestedData.js).
 *
 * When the body is NOT a chain, the original text is returned unchanged
 * (with optional cid-line stripping).
 *
 * @param {string} rawBody
 * @param {{ prefer?: 'earliest'|'latest', stripCidLines?: boolean }} [opts]
 * @returns {string}
 */
export function classifyAndNarrowChain(rawBody, opts = {}) {
  const { stripCidLines = true } = opts;

  if (!rawBody || typeof rawBody !== 'string') return rawBody || '';

  if (!isChainedEmail(rawBody)) {
    return stripCidLines ? removeCidLines(rawBody) : rawBody;
  }

  const segments = splitChain(rawBody);
  const { dominantType, classified } = classifyChain(segments);

  // Collect all segments matching the dominant type; fall back to all non-empty
  let chosen = classified.filter(seg => seg.type === dominantType && seg.body.trim());
  if (chosen.length === 0) {
    chosen = classified.filter(seg => seg.body.trim());
  }
  if (chosen.length === 0) return rawBody;

  const combined = chosen.map(seg => seg.body).join('\n\n');
  return stripCidLines ? removeCidLines(combined) : combined;
}

// ---------------------------------------------------------------------------
// TASK-AWARE CHAIN NARROWING
// ---------------------------------------------------------------------------

/**
 * Task-aware chain narrowing — the primary entry point for BAT scripts and
 * task runners that know the `bodyPattern` and `narrowTypeBy` config values.
 *
 * Algorithm
 * ---------
 * 1. Split chain into indexed segments (0 = newest / outermost).
 * 2. Build a *filtered pool*:
 *      - For all narrowTypeBy values except "raw-data": segments whose body
 *        contains `bodyPattern` (requester's segments, e.g. by signature).
 *      - For "raw-data": segments whose body does NOT contain `bodyPattern`
 *        (responder's segments — the other party).
 *    If no segments survive the filter, the full segment list is used.
 * 3. From the pool, pick the LOWEST-INDEXED segment satisfying the criterion:
 *      "date-range"           — body contains a recognisable date range
 *      "file-name:<name>"     — body mentions the given filename
 *      "raw-data:<type>"      — ATTACHMENT_RECEIVED-classified segment
 * 4. Fall back to findBestSegment on pool, then on all segments.
 * 5. Return the chosen body (cid lines stripped by default).
 *
 * @param {string} rawBody
 * @param {string|null} bodyPattern  Substring matched against each segment body.
 *   Pass null / empty to skip per-segment filtering.
 * @param {string} [narrowTypeBy]   "date-range" (default) | "file-name:<name>" |
 *   "raw-data:<type>"
 * @param {{ stripCidLines?: boolean }} [opts]
 * @returns {string}
 */
export function extractBestBodyByTask(rawBody, bodyPattern, narrowTypeBy = 'date-range', opts = {}) {
  const { stripCidLines = true } = opts;

  if (!rawBody || typeof rawBody !== 'string') return rawBody || '';

  if (!isChainedEmail(rawBody)) {
    return stripCidLines ? removeCidLines(rawBody) : rawBody;
  }

  const segments = splitChain(rawBody);
  const type     = (narrowTypeBy || 'date-range').toLowerCase().trim();

  /** Does this segment body contain the pattern string? */
  const matchesPattern = (seg) =>
    !bodyPattern ||
    seg.body.toLowerCase().includes(bodyPattern.toLowerCase());

  let chosen = null;

  if (type.startsWith('raw-data')) {
    // raw-data: use RESPONDER segments (body does NOT match bodyPattern)
    // — these are the other party's messages, expected to hold attachments.
    const responderSegs = segments.filter(seg => !matchesPattern(seg) && seg.body.trim());
    const pool = responderSegs.length ? responderSegs : segments.filter(s => s.body.trim());
    chosen =
      pool.find(seg => classifySegment(seg.body) === SEGMENT_TYPES.ATTACHMENT_RECEIVED) ||
      pool[0] ||
      null;

  } else if (type.startsWith('file-name:')) {
    const fileName    = type.slice('file-name:'.length).trim().toLowerCase();
    const patternSegs = segments.filter(matchesPattern);
    const pool        = patternSegs.length ? patternSegs : segments;
    chosen =
      pool.find(seg => seg.body.toLowerCase().includes(fileName)) ||
      findBestSegment(pool) ||
      findBestSegment(segments);

  } else {
    // "date-range" (default): look in requester segments (bodyPattern match)
    // for the LOWEST-INDEXED one that contains a date range.
    const patternSegs = segments.filter(matchesPattern);
    const pool        = patternSegs.length ? patternSegs : segments;
    chosen =
      pool.find(seg => hasDateRange(seg.body)) ||
      findBestSegment(pool) ||
      findBestSegment(segments);
  }

  if (!chosen) return rawBody;

  const body = chosen.body;
  return stripCidLines ? removeCidLines(body) : body;
}

// ---------------------------------------------------------------------------
// INTERNAL HELPERS
// ---------------------------------------------------------------------------

/**
 * Remove lines that are purely [cid:…] inline image references.
 * @param {string} text
 * @returns {string}
 */
function removeCidLines(text) {
  return text
    .split(/\r?\n/)
    .filter(line => !/^\s*\[cid:[^\]]*\]\s*$/.test(line))
    .join('\n');
}

// ---------------------------------------------------------------------------
// CLI ENTRY POINT
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] === __filename;

if (isMain) {
  const args = process.argv.slice(2);
  const cmd  = args[0];

  function readBodyFile(filePath) {
    if (!filePath) {
      process.stderr.write('Error: file path required\n');
      process.exit(2);
    }
    if (!existsSync(filePath)) {
      process.stderr.write(`Error: file not found: ${filePath}\n`);
      process.exit(2);
    }
    return readFileSync(filePath, 'utf-8');
  }

  if (cmd === '--split') {
    const body = readBodyFile(args[1]);
    const segs = splitChain(body);
    process.stdout.write(JSON.stringify(segs, null, 2) + '\n');
    process.exit(0);

  } else if (cmd === '--best-body') {
    const body = readBodyFile(args[1]);
    process.stdout.write(extractBestBody(body) + '\n');
    process.exit(0);

  } else if (cmd === '--best-body-file') {
    // --best-body-file <outfile> <infile>
    const outFile = args[1];
    const inFile  = args[2];
    if (!outFile || !inFile) {
      process.stderr.write('Usage: emailChain.mjs --best-body-file <outfile> <infile>\n');
      process.exit(2);
    }
    const body = readBodyFile(inFile);
    const best = extractBestBody(body);
    writeFileSync(outFile, best, 'utf-8');
    process.exit(0);

  } else if (cmd === '--narrow') {
    // --narrow <file>  — classify and return dominant-type combined body
    const body = readBodyFile(args[1]);
    process.stdout.write(classifyAndNarrowChain(body) + '\n');
    process.exit(0);

  } else if (cmd === '--narrow-by-task') {
    // --narrow-by-task <outfile> <bodyPattern> <narrowTypeBy> <infile>
    const outFile      = args[1];
    const bodyPattern  = args[2] || '';
    const narrowTypeBy = args[3] || 'date-range';
    const inFile       = args[4];
    if (!outFile || !inFile) {
      process.stderr.write(
        'Usage: emailChain.mjs --narrow-by-task <outfile> <bodyPattern> <narrowTypeBy> <infile>\n'
      );
      process.exit(2);
    }
    const body = readBodyFile(inFile);
    const best = extractBestBodyByTask(body, bodyPattern, narrowTypeBy);
    writeFileSync(outFile, best, 'utf-8');
    process.exit(0);

  } else if (cmd === '--is-chained') {
    const body = readBodyFile(args[1]);
    process.exit(isChainedEmail(body) ? 0 : 1);

  } else {
    process.stderr.write(
      [
        'helpers/emailChain.mjs — chained email splitter',
        '',
        'Usage:',
        '  node emailChain.mjs --split          <file>',
        '      Print JSON array of all chain segments.',
        '',
        '  node emailChain.mjs --best-body      <file>',
        '      Print the body of the best (date-containing) segment.',
        '',
        '  node emailChain.mjs --best-body-file <outfile> <infile>',
        '      Write the best body to <outfile>.',
        '      Use in BAT scripts before calling narrowRequestedData.js.',
        '',
        '  node emailChain.mjs --narrow             <file>',
        '      Classify chain segments and print combined body of dominant type.',
        '',
        '  node emailChain.mjs --narrow-by-task <outfile> <bodyPattern> <narrowTypeBy> <infile>',
        '      Task-aware narrowing: filter by bodyPattern, pick lowest-index segment',
        '      satisfying narrowTypeBy (date-range | file-name:<n> | raw-data:<type>),',
        '      write result to <outfile>.',
        '',
        '  node emailChain.mjs --is-chained         <file>',
        '      Exit 0 when chained, 1 when not chained.',
      ].join('\n') + '\n'
    );
    process.exit(2);
  }
}
