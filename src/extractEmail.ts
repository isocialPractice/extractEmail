#!/usr/bin/env node
// extractEmail
// Extract the last specified (defaults to 100) emails from an IMAP account.

// Import dependencies.
import fs from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import { simpleParser } from 'mailparser';
import { resolveFilterPattern, testPattern } from './helpers/filterHelper.js';
import { start as startMonitor, ping, stop } from './helpers/activityMonitor.js';
import { collectAllFolders, FOLDER_SPECIAL_USE, findFolderPath, moveEmailToFolder } from './imap.js';
import { loadConfig, loadMainConfig, parseSpecialArgs, optSet, taskSets, help } from './cli.js';
import { sanitizeHtml, parseHtmlToHierarchicalJson, parseHtmlTablesToColumnarJson, hasBodyContent, findTextPart, findHtmlPart, findAttachmentsInStruct, getAttachmentFilename, getAttachmentSummary, getRawMessagePart, getAttachmentSummaryFromMessage, normalizePartBody, getPlainTextBody } from './parse.js';
import { outputWriter, resolveOutputOption, prepareOutputWriter, writeOutputLine, DEFAULT_RESPONSE_FILENAME } from './output.js';
// imap-simple is loaded dynamically to support --test mode without dependencies

// Get directory of this script for resolving relative paths.
// After TS compilation this file lives in <packageRoot>/dist/, so resolve all
// package-relative paths (config.json, accounts/, extractEmailTasks/, helpers/,
// configEmailExtraction.mjs, test/mockImap.mjs) against packageRoot.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');

// Handle --version / -v early, before any config loading or IMAP setup.
if (process.argv.slice(2).some(a => a === '--version' || a === '-v')) {
  try {
    const pkgPath = path.resolve(packageRoot, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    console.log(pkg.version);
  } catch (err: any) {
    console.error(`Unable to read package version: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// Config will be loaded dynamically based on --config option.
let configEmail: any = null;

// CLI utilities (arg parsing, help text, config loaders) moved to ./cli.ts


// Parse special arguments (--config, --test, --task, --number, --full-body, --html, --json, --attachment-download, --filter, --filter:bool, --stop, --match) and get remaining args.
const { configName, testMode, taskName, outputPath, emailNumber, emailRange, fullBody, htmlMode, jsonMode, attachmentDownload, filterMode, filterBoolMode, fromFilter, senderFilter, subjectFilter, bodyFilter, attachmentFilter, moveFolder, checkFolder, stopAfter, countMode, matchMode, matchAfter, indexMode, ignoreRules, filteredArgs } = parseSpecialArgs();

// Load main config for tasks folder resolution.
const mainConfig = loadMainConfig(packageRoot);

// Output options are set at runtime based on -o/--output-folder.
let outputOptions = null;

// Parameter variables.
var extract, count;

// Set parameter variables from filtered args (excludes --config, --task).
// Find any all-digit value to use as count, regardless of position.
const numericArgs = filteredArgs.filter(arg => /^\d+$/.test(arg));
const nonNumericArgs = filteredArgs.filter(arg => !/^\d+$/.test(arg));

// Calculate default count based on mode
const getDefaultCount = () => {
  if (jsonMode === 'html' || jsonMode === 'table') return 25;
  if (fullBody || htmlMode || jsonMode === 'default') return 20;
  return 100;
};

// If --task is provided, use it as the task name.
if (taskName) {
  extract = taskName;
  count = numericArgs.length > 0 ? parseInt(numericArgs[0], 10) : getDefaultCount();
} else if (nonNumericArgs.length === 0) {
  // No options specified, just count (or nothing)
  extract = "all";
  count = numericArgs.length > 0 ? parseInt(numericArgs[0], 10) : getDefaultCount();
} else {
  // Use first non-numeric arg as extract option
  extract = nonNumericArgs[0];
  count = numericArgs.length > 0 ? parseInt(numericArgs[0], 10) : getDefaultCount();
}


// Check if a value matches any ignore rule for the given field.
function checkIgnoreField(value, field) {
  const rules = ignoreRules.filter(r => r.field === field);
  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      if (testPattern(String(value || ''), pattern)) return true;
    }
  }
  return false;
}

// Get filename from an IMAP struct part or parsed attachment object.
function getPartFilenameForIgnore(part) {
  if (part.disposition && part.disposition.params && part.disposition.params.filename) {
    return part.disposition.params.filename;
  }
  if (part.params && part.params.name) return part.params.name;
  if (part.params && part.params.filename) return part.params.filename;
  if (part.filename) return part.filename;
  if (part.subtype) return 'attachment.' + part.subtype.toLowerCase();
  return null;
}

// Wrap connection.getPartData to skip ignored attachments (returns null).
// This makes -i attachment work universally with all task files.
function wrapConnectionForIgnore(connection) {
  const attRules = ignoreRules.filter(r => r.field === 'attachment');
  if (attRules.length === 0) return connection;

  const origGetPartData = connection.getPartData.bind(connection);
  return new Proxy(connection, {
    get(target, prop) {
      if (prop === 'getPartData') {
        return async function(msg, part) {
          const filename = getPartFilenameForIgnore(part);
          if (filename && checkIgnoreField(filename, 'attachment')) {
            console.log('  Ignoring attachment: ' + filename);
            return null;
          }
          return origGetPartData(msg, part);
        };
      }
      const val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    }
  });
}

// Filter attachment summary to remove ignored attachment names.
function filterIgnoredAttachmentSummary(summary) {
  const attRules = ignoreRules.filter(r => r.field === 'attachment');
  if (attRules.length === 0 || !summary || summary === true) return summary;
  const names = String(summary).split(', ');
  const filtered = names.filter(name => !checkIgnoreField(name, 'attachment'));
  if (filtered.length === 0) return false;
  return filtered.length === 1 ? filtered[0] : filtered.join(', ');
}

/**
 * Flatten all IMAP boxes into an array of { name, fullPath, attribs }.
 * @param {object} boxes
 * @param {string} prefix
 * @param {string} delimiter
 * @returns {{ name: string, fullPath: string, attribs: string[] }[]}
 */
// IMAP folder helpers moved to ./imap.ts (collectAllFolders, FOLDER_SPECIAL_USE,
// findFolderPath, moveEmailToFolder).

/************************************* SUPPORT FUNCTIONS *************************************/
// Check if a task exists
function checkExtractTask(opt, useTaskFlag = false) {
  // Add .js extension if not provided
  const fileName = opt.endsWith('.js') ? opt : `${opt}.js`;

  // If --task flag was used, look in configured tasksFolder first
  if (useTaskFlag) {
    const configuredPath = path.resolve(packageRoot, mainConfig.tasksFolder, fileName);
    if (fs.existsSync(configuredPath)) return configuredPath;
  }

  // Fall back to default extractEmailTasks folder (relative to cwd for backward compat)
  const defaultPath = path.resolve('./extractEmailTasks', fileName);
  if (fs.existsSync(defaultPath)) return defaultPath;

  // Also check in configured tasksFolder even without --task flag
  const configuredPath = path.resolve(packageRoot, mainConfig.tasksFolder, fileName);
  if (fs.existsSync(configuredPath)) return configuredPath;

  return null;
}

// Dynamically import and call task
async function callExtractEmailTask(opt, headersPart, subject, body, connection = null, msg = null, useTaskFlag = false) {
  const taskPath = checkExtractTask(opt, useTaskFlag);
  if (!taskPath) return false;

  try {
    const fileUrl = pathToFileURL(taskPath).href;
    const taskModule = await import(fileUrl);

    if (taskModule.default && typeof taskModule.default === 'function') {
      // Pass extended context for advanced tasks (connection, msg for attachment access)
      const wrappedConn = wrapConnectionForIgnore(connection);
      const context = { connection: wrappedConn, msg, __dirname: packageRoot, outputOptions, ignoreRules, downloadAttachments };
      await taskModule.default(headersPart, subject, body, setVal, outputToTerminal, context);
      return true;
    }
  } catch (err) {
    console.error(`Error loading task ${opt}:`, err);
  }

  return false;
}


// Set the output value.
var val;
let currentAttachmentSummary = false;
// DEFAULT_RESPONSE_FILENAME moved to ./output.ts
const MAX_BODY_PREVIEW_LENGTH = 200;

// JSON mode accumulator
let jsonOutput = {};
let currentEmailKey = null;

// Sanitize HTML to text with presentable formatting (respects block elements like p, div, br)
// Pure HTML/parse helpers moved to ./parse.ts
// Process body based on mode: if htmlMode keep HTML, otherwise sanitize HTML to text
const processBody = (bodyContent, isHtml = false) => {
  if (!bodyContent) return bodyContent;

  // If JSON mode with special arguments, parse accordingly
  if (jsonMode === 'html' && isHtml) {
    return parseHtmlToHierarchicalJson(bodyContent);
  }

  if (jsonMode === 'table' && isHtml) {
    return parseHtmlTablesToColumnarJson(bodyContent);
  }

  // If it's HTML content and not in htmlMode, always sanitize to text
  if (isHtml && !htmlMode) {
    return sanitizeHtml(bodyContent);
  }

  // Otherwise return as-is (either it's plain text, or we're in htmlMode)
  return bodyContent;
};

// Check if body has content (handles strings, objects, and other types)
// hasBodyContent moved to ./parse.ts

// Truncate body text to preview length (unless fullBody or htmlMode is enabled)
const truncateBody = (bodyText) => {
  if (fullBody || htmlMode || emailNumber !== null || emailRange !== null) return bodyText; // Don't truncate in full-body, html, specific email, or range mode
  if (!bodyText) return bodyText;
  if (typeof bodyText === 'object') return bodyText; // Preserve parsed JSON objects (json:html, json:table)
  const text = String(bodyText);
  if (text.length <= MAX_BODY_PREVIEW_LENGTH) return text;
  return text.substring(0, MAX_BODY_PREVIEW_LENGTH) + '...';
};
// outputWriter / resolveOutputOption / prepareOutputWriter / writeOutputLine moved to ./output.ts

const setVal = (opt, headersPart, subject, body) => {
  if (opt == "subject") val = subject;
  else if (opt == "body") val = truncateBody(body);
  else if (opt == "attachment") val = currentAttachmentSummary;
  else val = headersPart[opt];
};

// Constant output to terminal.
var emailCount = 0;
const outputToTerminal = (opt, val, h) => {
  // If JSON mode, accumulate data instead of outputting
  if (jsonMode) {
    if (h == 0) {
      const reversedNumber = emailCount + 1;
      currentEmailKey = `Email #${reversedNumber}`;
      jsonOutput[currentEmailKey] = {};
      emailCount++;
    }
    if (currentEmailKey) {
      // Capitalize first letter of field name
      const fieldName = opt[0].toUpperCase() + opt.substring(1);

      // Handle field-specific formatting
      if (opt === 'to' && typeof val === 'string' && val.includes(',')) {
        // 'To' field as array if it contains commas
        jsonOutput[currentEmailKey][fieldName] = val.split(',').map(v => v.trim());
      } else if (opt === 'from' || opt === 'date') {
        // 'From' and 'Date' should always be strings (extract first element if array)
        jsonOutput[currentEmailKey][fieldName] = Array.isArray(val) ? val[0] : val;
      } else {
        jsonOutput[currentEmailKey][fieldName] = val;
      }
    }
    return;
  }

  // Normal line-by-line output
  if (h == 0) {
    const reversedNumber = emailCount + 1;
    writeOutputLine('');
    writeOutputLine(`=== Email #${reversedNumber} ===`);
    emailCount++;
  }
  writeOutputLine(opt[0].toUpperCase() + opt.substr(1,) + ": " + val);
};

// Part/attachment/body extractors moved to ./parse.ts

// Output task sets to help.
var optionCall = 0;
const handleTaskSets = (opt) => {
  // Handle --help: print all tasks
  if (opt == "--help") {
    for (let prop in taskSets) {
      console.log(`  ${prop}    -    ${taskSets[prop]}`);
    }
    optionCall = 3;
    return;
  }

  // Check if opt is a known task
  if (taskSets.hasOwnProperty(opt)) {
    optionCall = 2;
    return;
  }

  // Not a task, treat as option
  if (optionCall == 0) optionCall = 1;
};

// Handle options.
const handleOption = (opt, headersPart, subject, body) => {
  let allArr = [];
  let loopOptSet = (seq) => {
    for (let i = 0; i < optSet.length; i++) {
     if (seq == 1) {
       if (opt == optSet[i]) {
         setVal(opt, headersPart, subject, body);
         outputToTerminal(opt, val, 0);
       } else {
         allArr.push(optSet[i]);
       }
     } else {
        setVal(optSet[i], headersPart, subject, body);
        outputToTerminal(optSet[i], val, i);
     }
    }
  };
  loopOptSet(1);

  // all outputs
  if (allArr.length == optSet.length) {
    loopOptSet(2);
  }
};

const handleTask = async (opt, headersPart, subject, body, connection = null, msg = null, useTaskFlag = false) => {
  // Only one case now: dynamically call external task
  const executed = await callExtractEmailTask(opt, headersPart, subject, body, connection, msg, useTaskFlag);
  if (!executed) {
    console.log(`No task named "${opt}" exists or task file not found.`);
  }
};

// Resolve a unique file path for a numbered attachment prefix with collision handling.
// Single attachment (no prefix): returns path.join(outputDir, filename).
// Multiple attachments: returns path.join(outputDir, `${n}_${filename}`).
// If that path already exists, appends a letter: `${n}a_`, `${n}b_`, ...
function resolveAttachmentPath(outputDir, filename, n, usePrefix) {
  if (!usePrefix) {
    return path.join(outputDir, filename);
  }
  const base = `${n}_${filename}`;
  const candidate = path.join(outputDir, base);
  if (!fs.existsSync(candidate)) return candidate;
  for (let c = 0; c < 26; c++) {
    const suffix = String.fromCharCode('a'.charCodeAt(0) + c);
    const alt = path.join(outputDir, `${n}${suffix}_${filename}`);
    if (!fs.existsSync(alt)) return alt;
  }
  return null; // exhausted a-z
}

// Download attachments from a message
async function downloadAttachments(connection, msg, headersPart, outputDir) {
  const struct = msg.attributes.struct;
  const attachments = findAttachmentsInStruct(struct);

  if (!attachments || attachments.length === 0) {
    console.log('No attachments found in this email.');
    return;
  }

  // Pre-filter to determine downloadable (post-ignore) attachments.
  // Log ignored ones up-front so the count shown is accurate.
  const downloadable = [];
  for (const att of attachments) {
    const filename = getAttachmentFilename(att);
    if (checkIgnoreField(filename, 'attachment')) {
      console.log('  Ignoring attachment: ' + filename);
    } else {
      downloadable.push(att);
    }
  }

  if (downloadable.length === 0) {
    console.log('No attachments to download after filtering.');
    return;
  }

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`\nDownloading ${downloadable.length} attachment(s)...`);

  // Use digit prefix only when there are multiple downloadable attachments.
  const usePrefix = downloadable.length > 1;

  for (let idx = 0; idx < downloadable.length; idx++) {
    const attachment = downloadable[idx];
    try {
      const filename = getAttachmentFilename(attachment);
      const partData = await connection.getPartData(msg, attachment);
      const targetPath = resolveAttachmentPath(outputDir, filename, idx + 1, usePrefix);

      if (!targetPath) {
        console.error(`✗ Could not find unique filename for: ${filename}`);
        continue;
      }

      fs.writeFileSync(targetPath, partData);
      console.log(`✓ Downloaded: ${path.basename(targetPath)}`);
    } catch (err) {
      console.error(`✗ Error downloading attachment:`, err.message);
    }
  }
}

// Check if email matches filter criteria
function matchesFilters(headersPart, subject, hasAttachment, body = null) {
  if (fromFilter) {
    const from = Array.isArray(headersPart.from) ? headersPart.from.join(' ') : (headersPart.from || '');
    if (!from.toLowerCase().includes(fromFilter.toLowerCase())) {
      return false;
    }
  }

  if (subjectFilter) {
    const subjectStr = String(subject || '');
    if (!subjectStr.toLowerCase().includes(subjectFilter.toLowerCase())) {
      return false;
    }
  }

  if (bodyFilter) {
    const bodyStr = typeof body === 'string' ? body : String(body || '');
    if (!bodyStr.toLowerCase().includes(bodyFilter.toLowerCase())) {
      return false;
    }
  }

  if (senderFilter) {
    const sender = Array.isArray(headersPart['return-path']) ? headersPart['return-path'].join(' ') : (headersPart['return-path'] || '');
    if (!sender.toLowerCase().includes(senderFilter.toLowerCase())) {
      return false;
    }
  }

  if (attachmentFilter && !hasAttachment) {
    return false;
  }

  return true;
}


/*********************************************************************************************
                                         MAIN FUNCTION
*********************************************************************************************/
async function extractEmail() {
  if (extract == "-h" || extract == "--help") {
    console.log(help);
    handleTaskSets("--help");
    process.exit();
  } else {
    try {
      const outputOption = resolveOutputOption(outputPath);
      prepareOutputWriter(outputOption, Boolean(taskName));
      outputOptions = outputOption || { type: 'directory', path: process.cwd() };

      // Use mock IMAP in test mode, otherwise load real config and imap-simple.
      let imapModule;
      if (testMode) {
        console.log('[TEST MODE] Using mock email data\n');
        const mockPath = path.resolve(packageRoot, 'test', 'mockImap.mjs');
        const mockModule = await import(pathToFileURL(mockPath).href);
        imapModule = mockModule.mockImaps;
        configEmail = { imap: { test: true } }; // Dummy config for mock
      } else {
        const imaps = await import('imap-simple');
        imapModule = imaps.default || imaps;
        configEmail = await loadConfig(configName, packageRoot);
      }
      // Retry connect — first attempt can fail with ConnectionTimeoutError on idle/NAT reset.
      let connection;
      {
        const MAX_RETRIES = 3;
        for (let _attempt = 1; _attempt <= MAX_RETRIES; _attempt++) {
          try {
            connection = await imapModule.connect(configEmail);
            break;
          } catch (err) {
            const isRetryable = err.message && /timeout/i.test(err.message);
            if (!isRetryable || _attempt === MAX_RETRIES) throw err;
            process.stderr.write(`[extractEmail] connect attempt ${_attempt} timed out, retrying...\n`);
            await new Promise(r => setTimeout(r, 800 * _attempt));
          }
        }
      }
      if (!testMode) startMonitor();
      await connection.openBox('INBOX');

      // Validate and switch to --check folder if specified.
      if (checkFolder) {
        const boxes = await connection.getBoxes();
        const resolvedCheckFolder = findFolderPath(boxes, checkFolder);
        if (!resolvedCheckFolder) {
          console.error(`Folder "${checkFolder}" does not exist`);
          stop();
          await connection.end();
          return;
        }
        await connection.openBox(resolvedCheckFolder);
      }

      // Validate --move folder existence before processing any emails.
      let resolvedMoveFolder = null;
      if (moveFolder) {
        const hasFilter = fromFilter || senderFilter || subjectFilter || bodyFilter || attachmentFilter;
        if (!hasFilter && emailNumber === null) {
          console.error('--move requires filter criteria (from=, sender=, subject=, body=, or attachment=) to specify which emails to move.');
          stop();
          await connection.end();
          return;
        }
        const boxes = await connection.getBoxes();
        resolvedMoveFolder = findFolderPath(boxes, moveFolder);
        if (!resolvedMoveFolder) {
          console.error(`Folder "${moveFolder}" does not exist`);
          stop();
          await connection.end();
          return;
        }
      }

      const searchCriteria = ['ALL'];
      const fetchOptions = {
        bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE RETURN-PATH)'],
        struct: true
      };

      let messages = await connection.search(searchCriteria, fetchOptions);

      // Sort newest-received first by INTERNALDATE.
      messages.sort((a: any, b: any) => new Date(b.attributes.date || 0).getTime() - new Date(a.attributes.date || 0).getTime());

      // Default: exclude emails flagged \Sent or $Sent (sent-folder emails surfaced in INBOX).
      messages = messages.filter(msg => {
        const flags = msg.attributes.flags || [];
        return !flags.some(f => /^[\\$]sent$/i.test(f));
      });

      // Handle --count mode: output integer count of emails in set or matching filters.
      if (countMode) {
        const hasFilterCriteria = fromFilter || senderFilter || subjectFilter || bodyFilter || attachmentFilter;
        const countAll = nonNumericArgs.length > 0 && nonNumericArgs[0] === 'all';
        let countMessages;

        if (emailRange !== null) {
          const { start } = emailRange;
          const end = emailRange.end !== null ? emailRange.end : messages.length;
          if (start > messages.length) {
            console.log('0');
            stop();
            await connection.end();
            return;
          }
          const clampedEnd = Math.min(end, messages.length);
          countMessages = messages.slice(start - 1, clampedEnd);
        } else {
          const effectiveCount = countAll ? messages.length : count;
          countMessages = messages.slice(0, effectiveCount);
        }

        if (!hasFilterCriteria) {
          console.log(String(countMessages.length));
        } else {
          let matchCount = 0;
          for (const msg of countMessages) {
            ping();
            const headersPart = msg.parts.find(p => p.which.includes('HEADER'))?.body || {};
            let subject = headersPart.subject || '';
            if (Array.isArray(subject)) subject = subject.join(' ');

            let emailBody = null;
            if (bodyFilter) {
              const struct = msg.attributes.struct;
              const textPart = findTextPart(struct);
              const htmlPart = findHtmlPart(struct);
              if (htmlPart) {
                try {
                  const partData = await connection.getPartData(msg, htmlPart);
                  const htmlContent = Buffer.isBuffer(partData) ? partData.toString('utf8') : String(partData || '');
                  emailBody = sanitizeHtml(htmlContent);
                } catch (err) { /* fall through to text part */ }
              }
              if (!emailBody && textPart) {
                try {
                  const partData = await connection.getPartData(msg, textPart);
                  emailBody = Buffer.isBuffer(partData) ? partData.toString('utf8') : String(partData || '');
                } catch (err) { /* fall through */ }
              }
            }

            const hasAttachment = attachmentFilter ? await getAttachmentSummaryFromMessage(msg, connection) : false;
            if (matchesFilters(headersPart, subject, hasAttachment, emailBody)) matchCount++;
          }
          console.log(String(matchCount));
        }

        stop();
        await connection.end();
        return;
      }

      // Handle --index mode: output position numbers of emails in set or matching filters.
      if (indexMode) {
        const hasFilterCriteria = fromFilter || senderFilter || subjectFilter || bodyFilter || attachmentFilter;
        const indexAll = nonNumericArgs.length > 0 && nonNumericArgs[0] === 'all';
        let indexMessages;

        if (emailRange !== null) {
          const { start } = emailRange;
          const end = emailRange.end !== null ? emailRange.end : messages.length;
          if (start > messages.length) {
            console.log('');
            stop();
            await connection.end();
            return;
          }
          const clampedEnd = Math.min(end, messages.length);
          indexMessages = messages.slice(start - 1, clampedEnd).map((msg, i) => ({ msg, pos: start + i }));
        } else {
          const effectiveCount = indexAll ? messages.length : count;
          indexMessages = messages.slice(0, effectiveCount).map((msg, i) => ({ msg, pos: i + 1 }));
        }

        if (!hasFilterCriteria) {
          console.log(indexMessages.map(({ pos }) => pos).join(','));
        } else {
          const matchPositions = [];
          for (const { msg, pos } of indexMessages) {
            ping();
            const headersPart = msg.parts.find(p => p.which.includes('HEADER'))?.body || {};
            let subject = headersPart.subject || '';
            if (Array.isArray(subject)) subject = subject.join(' ');

            let emailBody = null;
            if (bodyFilter) {
              const struct = msg.attributes.struct;
              const textPart = findTextPart(struct);
              const htmlPart = findHtmlPart(struct);
              if (htmlPart) {
                try {
                  const partData = await connection.getPartData(msg, htmlPart);
                  const htmlContent = Buffer.isBuffer(partData) ? partData.toString('utf8') : String(partData || '');
                  emailBody = sanitizeHtml(htmlContent);
                } catch (err) { /* fall through to text part */ }
              }
              if (!emailBody && textPart) {
                try {
                  const partData = await connection.getPartData(msg, textPart);
                  emailBody = Buffer.isBuffer(partData) ? partData.toString('utf8') : String(partData || '');
                } catch (err) { /* fall through */ }
              }
            }

            const hasAttachment = attachmentFilter ? await getAttachmentSummaryFromMessage(msg, connection) : false;
            if (matchesFilters(headersPart, subject, hasAttachment, emailBody)) {
              matchPositions.push(pos);
            }
          }
          console.log(matchPositions.join(','));
        }

        stop();
        await connection.end();
        return;
      }

      // Handle specific email number request
      if (emailNumber !== null) {
        if (emailNumber < 1 || emailNumber > messages.length) {
          console.error(`Error: Email #${emailNumber} does not exist. Total emails: ${messages.length}`);
          stop();
          await connection.end();
          return;
        }
        // Get the specific email (1-indexed from newest, so #1 = most recent)
        const specificMsg = messages[emailNumber - 1];
        const lastMessages = [specificMsg];
        
        for (const [i, msg] of lastMessages.entries()) {
          const headersPart = msg.parts.find(p => p.which.includes('HEADER'))?.body || {};
          let subject = headersPart.subject || '';
          if (Array.isArray(subject)) subject = subject.join(' ');

          const struct = msg.attributes.struct;
          let body = '';

          // json:html and json:table need HTML structure for parsing
          const needsHtmlStructure = (jsonMode === 'html' || jsonMode === 'table');

          const textPart = findTextPart(struct);
          const htmlPart = findHtmlPart(struct);

          // Prefer HTML part for better formatting (pipe-delimited tables, headings)
          if (htmlPart) {
            try {
              const partData = await connection.getPartData(msg, htmlPart);
              const htmlContent = Buffer.isBuffer(partData) ? partData.toString('utf8') : String(partData || '');
              if (htmlContent && htmlContent.trim()) {
                body = processBody(htmlContent, true);
              }
            } catch (err) {
              console.error('Error fetching HTML part:', err);
            }
          }

          // Fall back to text/plain if no HTML content
          if (!hasBodyContent(body) && textPart) {
            try {
              const partData = await connection.getPartData(msg, textPart);
              body = Buffer.isBuffer(partData) ? partData.toString('utf8') : String(partData || '');
            } catch (err) {
              console.error('Error fetching text part:', err);
            }
          }

          // Last resort: re-fetch message with TEXT body
          if (!hasBodyContent(body)) {
            try {
              const uid = msg.attributes.uid;
              const fullFetchOptions = { bodies: ['TEXT'], struct: false };
              const refetch = await connection.search([['UID', uid]], fullFetchOptions);
              if (refetch && refetch.length > 0) {
                const textPart = refetch[0].parts.find(p => p.which === 'TEXT');
                if (textPart) {
                  const rawBody = normalizePartBody(textPart.body);
                  const parsed = await simpleParser(rawBody);
                  body = parsed.text || parsed.html || '';
                }
              }
            } catch (err) {
              console.error('Error re-fetching message body:', err);
            }
          }

          // Ensure body is processed for structured modes (json:html, json:table)
          if (needsHtmlStructure && typeof body === 'string' && body.trim()) {
            body = processBody(body, /<[a-z][\s\S]*>/i.test(body));
          }

          currentAttachmentSummary = await getAttachmentSummaryFromMessage(msg, connection);
          currentAttachmentSummary = filterIgnoredAttachmentSummary(currentAttachmentSummary);

          // Output all fields for specific email number
          if (jsonMode) {
            // JSON output for specific email
            const emailData = {
              From: Array.isArray(headersPart.from) ? headersPart.from[0] : (headersPart.from || ''),
              To: (headersPart.to || '').includes(',')
                ? (headersPart.to || '').split(',').map(v => v.trim())
                : headersPart.to || '',
              Date: Array.isArray(headersPart.date) ? headersPart.date[0] : (headersPart.date || ''),
              Subject: subject,
              Attachment: currentAttachmentSummary || 'false',
              Body: body
            };
            jsonOutput[`Email #${emailNumber}`] = emailData;
          } else {
            // Normal text output
            writeOutputLine('');
            writeOutputLine(`=== Email #${emailNumber} ===`);
            writeOutputLine('From: ' + (headersPart.from || ''));
            writeOutputLine('To: ' + (headersPart.to || ''));
            writeOutputLine('Date: ' + (headersPart.date || ''));
            writeOutputLine('Subject: ' + subject);
            writeOutputLine('Attachment: ' + (currentAttachmentSummary || 'false'));
            writeOutputLine('Body: ' + body);
          }

          // Handle attachment download if requested
          if (attachmentDownload) {
            const downloadDir = outputOptions?.path || path.join(process.cwd(), 'attachments');
            await downloadAttachments(connection, msg, headersPart, downloadDir);
          }

          // Handle --move: move this specific email to the target folder (filter criteria optional).
          if (resolvedMoveFolder) {
            const hasFilter = fromFilter || senderFilter || subjectFilter || bodyFilter || attachmentFilter;
            const emailBodyForFilter = typeof body === 'string' ? body : '';
            if (!hasFilter || matchesFilters(headersPart, subject, currentAttachmentSummary, emailBodyForFilter)) {
              const uid = specificMsg.attributes.uid;
              await moveEmailToFolder(connection, uid, resolvedMoveFolder);
              console.log(`Moved email #${emailNumber} to "${moveFolder}"`);
            }
          }
        }

        // Output JSON if in JSON mode
        if (jsonMode) {
          const jsonString = JSON.stringify(jsonOutput, null, 2);
          writeOutputLine(jsonString);
        }

        stop();
        await connection.end();
        return;
      }

      // Handle --range: extract a specific range of emails (e.g. --range 5-10)
      if (emailRange !== null) {
        const { start } = emailRange;
        // Resolve null end (open-ended: 50- or 50-last) to the actual last email.
        const end = emailRange.end !== null ? emailRange.end : messages.length;
        if (start > messages.length) {
          console.error(`Error: Range start #${start} exceeds total emails: ${messages.length}`);
          stop();
          await connection.end();
          return;
        }
        const clampedEnd = Math.min(end, messages.length);
        const rangeMessages = messages.slice(start - 1, clampedEnd);

        const hasFilterCriteria = fromFilter || senderFilter || subjectFilter || bodyFilter || attachmentFilter;
        const useFilters = (attachmentDownload || filterMode || filterBoolMode || moveFolder) && hasFilterCriteria && !matchMode;
        let foundMatch = false;
        let rangeStopCount = 0;
        let rangeMatchCount = 0;

        for (const [i, msg] of rangeMessages.entries()) {
          ping();
          const emailNum = start + i;
          const headersPart = msg.parts.find(p => p.which.includes('HEADER'))?.body || {};
          let subject = headersPart.subject || '';
          if (Array.isArray(subject)) subject = subject.join(' ');

          // Apply email-level ignore rules (-i from/subject).
          if (ignoreRules.length > 0) {
            const fromStr = Array.isArray(headersPart.from) ? headersPart.from.join(' ') : (headersPart.from || '');
            if (checkIgnoreField(fromStr, 'from')) continue;
            if (checkIgnoreField(subject, 'subject')) continue;
          }

          const struct = msg.attributes.struct;
          let body = '';

          const needsHtmlStructure = (jsonMode === 'html' || jsonMode === 'table');
          const textPart = findTextPart(struct);
          const htmlPart = findHtmlPart(struct);

          if (htmlPart) {
            try {
              const partData = await connection.getPartData(msg, htmlPart);
              const htmlContent = Buffer.isBuffer(partData) ? partData.toString('utf8') : String(partData || '');
              if (htmlContent && htmlContent.trim()) {
                body = processBody(htmlContent, true);
              }
            } catch (err) {
              console.error('Error fetching HTML part:', err);
            }
          }

          if (!hasBodyContent(body) && textPart) {
            try {
              const partData = await connection.getPartData(msg, textPart);
              body = Buffer.isBuffer(partData) ? partData.toString('utf8') : String(partData || '');
            } catch (err) {
              console.error('Error fetching text part:', err);
            }
          }

          if (!hasBodyContent(body)) {
            try {
              const uid = msg.attributes.uid;
              const fullFetchOptions = { bodies: ['TEXT'], struct: false };
              const refetch = await connection.search([['UID', uid]], fullFetchOptions);
              if (refetch && refetch.length > 0) {
                const textPart2 = refetch[0].parts.find(p => p.which === 'TEXT');
                if (textPart2) {
                  const rawBody = normalizePartBody(textPart2.body);
                  const parsed = await simpleParser(rawBody);
                  body = parsed.text || parsed.html || '';
                }
              }
            } catch (err) {
              console.error('Error re-fetching message body:', err);
            }
          }

          if (needsHtmlStructure && typeof body === 'string' && body.trim()) {
            body = processBody(body, /<[a-z][\s\S]*>/i.test(body));
          }

          currentAttachmentSummary = await getAttachmentSummaryFromMessage(msg, connection);
          currentAttachmentSummary = filterIgnoredAttachmentSummary(currentAttachmentSummary);

          // Implicit filtering: criteria present but not in an explicit filter/download/move mode
          // (covers both bare filter criteria with --range, and --match mode with any filter criteria).
          if (hasFilterCriteria && !useFilters) {
            const emailBodyForFilter = typeof body === 'string' ? body : '';
            if (!matchesFilters(headersPart, subject, currentAttachmentSummary, emailBodyForFilter)) continue;
            foundMatch = true;
            // Falls through to standard output below.
          }

          // Apply filter criteria when --filter, --filter:bool, or -a mode is active.
          if (useFilters) {
            const emailBodyForFilter = typeof body === 'string' ? body : '';
            if (!matchesFilters(headersPart, subject, currentAttachmentSummary, emailBodyForFilter)) continue;
            foundMatch = true;

            // --filter:bool: output "true" and exit immediately on first match.
            if (filterBoolMode) {
              console.log('true');
              stop();
              await connection.end();
              return;
            }

            // --filter mode: show summary info only.
            if (filterMode) {
              console.log(`\nFound matching email #${emailNum}:`);
              console.log('From:', headersPart.from || '');
              console.log('Subject:', subject);
            }

            // -a: download attachments from matching email.
            if (attachmentDownload) {
              const downloadDir = outputOptions?.path || path.join(process.cwd(), 'attachments');
              await downloadAttachments(connection, msg, headersPart, downloadDir);
            }

            // --move: move matching email to target folder.
            if (resolvedMoveFolder) {
              const uid = msg.attributes.uid;
              await moveEmailToFolder(connection, uid, resolvedMoveFolder);
              console.log(`Moved email #${emailNum} to "${moveFolder}": "${subject}"`);
            }

            if (attachmentFilter || (stopAfter !== null && ++rangeStopCount >= stopAfter)) break;
            continue;
          }

          // Task or option output — mirrors the standard count-based loop.
          // emailCount is used by outputToTerminal for the "=== Email #N ===" header;
          // set it so the displayed number matches the actual range position.
          emailCount = emailNum - 1;
          handleTaskSets(extract);

          if (optionCall == 1 && !taskName) {
            handleOption(extract, headersPart, subject, body);
          } else {
            await handleTask(extract, headersPart, subject, body, connection, msg, !!taskName);
          }

          if (attachmentDownload) {
            const downloadDir = outputOptions?.path || path.join(process.cwd(), 'attachments');
            await downloadAttachments(connection, msg, headersPart, downloadDir);
          }

          // For attachment=true implicit filter or --stop limit, stop after match is output.
          ++rangeStopCount;
          if ((hasFilterCriteria && !filterMode && !filterBoolMode && !attachmentDownload && attachmentFilter) ||
              (stopAfter !== null && rangeStopCount >= stopAfter)) break;

          // --match: stop after N matching emails have been output.
          if (matchMode && ++rangeMatchCount >= matchAfter) break;
        }

        // End-of-range responses for filter modes.
        if (hasFilterCriteria) {
          if (filterBoolMode) {
            console.log('false');
          } else if (!attachmentDownload && !foundMatch) {
            console.log('No emails found matching the specified filters.');
          }
        }

        if (jsonMode) {
          const jsonString = JSON.stringify(jsonOutput, null, 2);
          writeOutputLine(jsonString);
        }

        stop();
        await connection.end();
        return;
      }

      // Handle --filter mode, attachment download, or --move with filters (no task).
      // --filter mode outputs matching emails without downloading attachments.
      // --filter:bool mode outputs "true" if match found, "false" otherwise.
      // -a/--attachment-download mode downloads attachments from matching emails.
      // --move mode moves matching emails to the specified IMAP folder.
      const hasFilterCriteria = fromFilter || senderFilter || subjectFilter || bodyFilter || attachmentFilter;
      if ((attachmentDownload || filterMode || moveFolder) && hasFilterCriteria && !emailNumber && !taskName && !matchMode) {
        let foundMatch = false;
        let filterStopCount = 0;
        for (const [i, msg] of messages.slice(0, count).entries()) {
          ping();
          const headersPart = msg.parts.find(p => p.which.includes('HEADER'))?.body || {};
          let subject = headersPart.subject || '';
          if (Array.isArray(subject)) subject = subject.join(' ');
          
          const hasAttachment = await getAttachmentSummaryFromMessage(msg, connection);
          
          // Fetch body content if bodyFilter is set
          let emailBody = null;
          if (bodyFilter) {
            const struct = msg.attributes.struct;
            const textPart = findTextPart(struct);
            const htmlPart = findHtmlPart(struct);
            
            // Prefer HTML part then text part
            if (htmlPart) {
              try {
                const partData = await connection.getPartData(msg, htmlPart);
                const htmlContent = Buffer.isBuffer(partData) ? partData.toString('utf8') : String(partData || '');
                emailBody = sanitizeHtml(htmlContent);
              } catch (err) { /* fall through to text part */ }
            }
            
            if (!emailBody && textPart) {
              try {
                const partData = await connection.getPartData(msg, textPart);
                emailBody = Buffer.isBuffer(partData) ? partData.toString('utf8') : String(partData || '');
              } catch (err) { /* continue with null body */ }
            }
          }
          
          if (matchesFilters(headersPart, subject, hasAttachment, emailBody)) {
            foundMatch = true;
            
            // --filter:bool mode: output "true" and exit immediately
            if (filterBoolMode) {
              console.log('true');
              stop();
              await connection.end();
              return;
            }
            
            // Normal --filter mode: show details
            if (filterMode || !moveFolder) {
              console.log(`\nFound matching email #${i + 1}:`);
              console.log('From:', headersPart.from || '');
              console.log('Subject:', subject);
            }
            
            // Only download attachments if -a/--attachment-download flag is set
            if (attachmentDownload) {
              const downloadDir = outputOptions?.path || path.join(process.cwd(), 'attachments');
              await downloadAttachments(connection, msg, headersPart, downloadDir);
            }

            // --move: move matching email to target folder.
            if (resolvedMoveFolder) {
              const uid = msg.attributes.uid;
              await moveEmailToFolder(connection, uid, resolvedMoveFolder);
              console.log(`Moved email #${i + 1} to "${moveFolder}": "${subject}"`);
            }
            
            filterStopCount++;
            // If attachment=true filter or --stop limit reached, stop after this match
            if (attachmentFilter || (stopAfter !== null && filterStopCount >= stopAfter)) break;
          }
        }
        
        // --filter:bool mode: output "false" if no match was found
        if (filterBoolMode) {
          console.log('false');
          stop();
          await connection.end();
          return;
        }
        
        if (!foundMatch) {
          console.log('No emails found matching the specified filters.');
        }
        
        stop();
        await connection.end();
        return;
      }

      // Take first N messages (already sorted newest-first).
      // --match with "all" keyword searches across every message.
      const matchAll = matchMode && nonNumericArgs.some(a => a === 'all');
      const lastMessages = matchAll ? messages : messages.slice(0, count);

      if (stopAfter !== null) process.stderr.write(`\n[DEBUG] general loop: messages=${messages.length}, count=${count}, lastMessages=${lastMessages.length}, stopAfter=${stopAfter}\n`);

      emailCount = 0;
      let generalStopCount = 0;
      let generalMatchCount = 0;

      for (const [i, msg] of lastMessages.entries()) {
        if (stopAfter !== null) process.stderr.write(`[DEBUG] loop iteration i=${i} (email #${i+1})\n`);
        ping();
        const headersPart = msg.parts.find(p => p.which.includes('HEADER'))?.body || {};
        let subject = headersPart.subject || '';
        if (Array.isArray(subject)) subject = subject.join(' ');

        // Apply email-level ignore rules (-i from/subject/body).
        if (ignoreRules.length > 0) {
          const fromStr = Array.isArray(headersPart.from) ? headersPart.from.join(' ') : (headersPart.from || '');
          if (checkIgnoreField(fromStr, 'from')) continue;
          if (checkIgnoreField(subject, 'subject')) continue;
        }

        // Check if task set or option.
        handleTaskSets(extract);

        const struct = msg.attributes.struct;
        let body = '';

        // json:html and json:table need HTML structure for parsing
        const needsHtmlStructure = (jsonMode === 'html' || jsonMode === 'table');

        const textPart = findTextPart(struct);
        const htmlPart = findHtmlPart(struct);

        // Prefer HTML part for better formatting (pipe-delimited tables, headings)
        if (htmlPart) {
          try {
            const partData = await connection.getPartData(msg, htmlPart);
            const htmlContent = Buffer.isBuffer(partData) ? partData.toString('utf8') : String(partData || '');
            if (htmlContent && htmlContent.trim()) {
              body = processBody(htmlContent, true);
            }
          } catch (err) {
            console.error('Error fetching HTML part:', err);
          }
        }

        // Fall back to text/plain if no HTML content
        if (!hasBodyContent(body) && textPart) {
          try {
            const partData = await connection.getPartData(msg, textPart);
            body = Buffer.isBuffer(partData) ? partData.toString('utf8') : String(partData || '');
          } catch (err) {
            console.error('Error fetching text part:', err);
          }
        }

        // Last resort: re-fetch message with TEXT body
        if (!hasBodyContent(body)) {
          try {
            const uid = msg.attributes.uid;
            const fullFetchOptions = { bodies: ['TEXT'], struct: false };
            const refetch = await connection.search([['UID', uid]], fullFetchOptions);
            if (refetch && refetch.length > 0) {
              const textPart = refetch[0].parts.find(p => p.which === 'TEXT');
              if (textPart) {
                const rawBody = normalizePartBody(textPart.body);
                const parsed = await simpleParser(rawBody);
                body = parsed.text || parsed.html || '';
              }
            }
          } catch (err) {
            console.error('Error re-fetching message body:', err);
          }
        }

        // Ensure body is processed for structured modes (json:html, json:table)
        if (needsHtmlStructure && typeof body === 'string' && body.trim()) {
          body = processBody(body, /<[a-z][\s\S]*>/i.test(body));
        }

        currentAttachmentSummary = await getAttachmentSummaryFromMessage(msg, connection);
        currentAttachmentSummary = filterIgnoredAttachmentSummary(currentAttachmentSummary);

        // --match: skip emails that do not satisfy filter criteria, then stop after N matches.
        if (matchMode && hasFilterCriteria) {
          const emailBodyForFilter = typeof body === 'string' ? body : '';
          if (!matchesFilters(headersPart, subject, currentAttachmentSummary, emailBodyForFilter)) continue;
        }

        // Sync emailCount to loop index so the "=== Email #N ===" header shows inbox position.
        emailCount = i;

        // If option, else handle task.
        if (optionCall == 1 && !taskName) {
          handleOption(extract, headersPart, subject, body);
        } else {
          if (stopAfter !== null) process.stderr.write(`[DEBUG] calling handleTask for email #${i+1}\n`);
          await handleTask(extract, headersPart, subject, body, connection, msg, !!taskName);
          if (stopAfter !== null) process.stderr.write(`[DEBUG] handleTask returned for email #${i+1}\n`);
        }

        // Stop after --stop N emails have been processed.
        generalStopCount++;
        if (stopAfter !== null) process.stderr.write(`[DEBUG] generalStopCount=${generalStopCount}, stopAfter=${stopAfter}, breaking=${generalStopCount >= stopAfter}\n`);
        if (stopAfter !== null && generalStopCount >= stopAfter) break;

        // Stop after --match N matching emails have been output.
        if (matchMode && ++generalMatchCount >= matchAfter) break;
      }

      // --match with filter criteria: report if nothing matched.
      if (matchMode && hasFilterCriteria && generalMatchCount === 0) {
        console.log('No emails found matching the specified filters.');
      }

      // Output JSON if in JSON mode
      if (jsonMode) {
        const jsonString = JSON.stringify(jsonOutput, null, 2);
        writeOutputLine(jsonString);
      }

      stop();
      await connection.end();
    } catch (err) {
      console.error('Error fetching emails:', err);
    }
  }
}

// Call main function.
process.on('SIGINT', () => { stop(); process.exit(130); });
extractEmail();