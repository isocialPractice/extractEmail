#!/usr/bin/env node
// extractEmail
// Extract the last specified (defaults to 100) emails from an IMAP account.

// Import dependencies.
import fs from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import { simpleParser } from 'mailparser';
// imap-simple is loaded dynamically to support --test mode without dependencies

// Get directory of this script for resolving relative paths.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Config will be loaded dynamically based on --config option.
let configEmail = null;

/**
 * Load account configuration from specified file or default.
 * @param {string|null} configName - Config file name (with or without .mjs extension)
 * @returns {Promise<object>} The configEmail object
 */
async function loadConfig(configName) {
  let configPath;

  if (configName) {
    // Load from accounts folder specified in config.json
    const mainConfigPath = path.resolve(__dirname, 'config.json');

    if (!fs.existsSync(mainConfigPath)) {
      throw new Error('config.json not found. Create it with "accountsFolder" property.');
    }

    const mainConfig = JSON.parse(fs.readFileSync(mainConfigPath, 'utf8'));
    const accountsFolder = path.resolve(__dirname, mainConfig.accountsFolder);

    // Add .mjs extension if not provided
    const fileName = configName.endsWith('.mjs') ? configName : `${configName}.mjs`;
    configPath = path.join(accountsFolder, fileName);

    // Validate filename (no illegal characters)
    const baseFileName = path.basename(fileName, '.mjs');
    if (/[\/\\:*?"<>|\s]/.test(baseFileName)) {
      throw new Error(`Invalid config filename. Avoid spaces and special characters: / \\ : * ? " < > |`);
    }

    if (!fs.existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }
  } else {
    // Use default config in current working directory or script directory
    const cwdConfig = path.resolve(process.cwd(), 'configEmailExtraction.mjs');
    const scriptConfig = path.resolve(__dirname, 'configEmailExtraction.mjs');

    if (fs.existsSync(cwdConfig)) {
      configPath = cwdConfig;
    } else if (fs.existsSync(scriptConfig)) {
      configPath = scriptConfig;
    } else {
      throw new Error('No default configEmailExtraction.mjs found. Use --config=<name> to specify an account.');
    }
  }

  const fileUrl = pathToFileURL(configPath).href;
  const configModule = await import(fileUrl);
  return configModule.configEmail;
}

/**
 * Parse special flags (--config, --test, --task, --output-folder, --number, --full-body, --attachment-download) from arguments.
 * @returns {{ configName: string|null, testMode: boolean, taskName: string|null, outputPath: string|null, emailNumber: number|null, fullBody: boolean, attachmentDownload: boolean, fromFilter: string|null, subjectFilter: string|null, attachmentFilter: boolean, filteredArgs: string[] }}
 */
function parseSpecialArgs() {
  const args = process.argv.slice(2);
  let configName = null;
  let testMode = false;
  let taskName = null;
  let outputPath = null;
  let emailNumber = null;
  let fullBody = false;
  let attachmentDownload = false;
  let fromFilter = null;
  let subjectFilter = null;
  let attachmentFilter = false;
  const filteredArgs = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--config=')) {
      configName = arg.substring('--config='.length);
    } else if (arg === '--config') {
      if (i + 1 >= args.length) throw new Error('Missing value for --config');
      configName = args[++i];
    } else if (arg.startsWith('--task=')) {
      taskName = arg.substring('--task='.length);
    } else if (arg === '--task') {
      if (i + 1 >= args.length) throw new Error('Missing value for --task');
      taskName = args[++i];
    } else if (arg.startsWith('--output-folder=')) {
      outputPath = arg.substring('--output-folder='.length);
    } else if (arg === '--output-folder' || arg === '-o') {
      if (i + 1 >= args.length) throw new Error('Missing value for -o/--output-folder');
      outputPath = args[++i];
    } else if (arg.startsWith('--number=')) {
      emailNumber = parseInt(arg.substring('--number='.length), 10);
    } else if (arg === '--number' || arg === '-n') {
      if (i + 1 >= args.length) throw new Error('Missing value for -n/--number');
      emailNumber = parseInt(args[++i], 10);
    } else if (arg === '--full-body' || arg === '-f') {
      fullBody = true;
    } else if (arg === '--attachment-download' || arg === '-a') {
      attachmentDownload = true;
    } else if (arg.startsWith('from=')) {
      fromFilter = arg.substring('from='.length).replace(/^["']|["']$/g, '');
    } else if (arg.startsWith('subject=')) {
      subjectFilter = arg.substring('subject='.length).replace(/^["']|["']$/g, '');
    } else if (arg.startsWith('attachment=')) {
      const val = arg.substring('attachment='.length).toLowerCase();
      attachmentFilter = val === 'true';
    } else if (arg === '--test') {
      testMode = true;
    } else {
      filteredArgs.push(arg);
    }
  }

  return { configName, testMode, taskName, outputPath, emailNumber, fullBody, attachmentDownload, fromFilter, subjectFilter, attachmentFilter, filteredArgs };
}

/**
 * Load the main config.json and return the configuration object.
 * @returns {object} The main config object
 */
function loadMainConfig() {
  const mainConfigPath = path.resolve(__dirname, 'config.json');
  if (!fs.existsSync(mainConfigPath)) {
    return { accountsFolder: './accounts', tasksFolder: './extractEmailTasks' };
  }
  const mainConfig = JSON.parse(fs.readFileSync(mainConfigPath, 'utf8'));
  return {
    accountsFolder: mainConfig.accountsFolder || './accounts',
    tasksFolder: mainConfig.tasksFolder || './extractEmailTasks'
  };
}


// Define options to be used in array.
const optSet   = ["from", "to", "date", "subject", "attachment", "body"];

// Task set object for specific functions, and help output.
const taskSets = {
 "stop": "Get the number from STOP request, and remove from messaging.",
 "downloadAttachments": "Download attachments from emails matching filter criteria."
};

// Help message.
const help = `
 extractEmail
 Extract the last specified (defaults to 100) emails from an IMAP account.

 Usage: extractEmail [--config=<account>] [--task=<task>] [-o <path>] [option|task] [count]

 Account Selection:
  --config=<name>       Use account config from accounts folder (with or without .mjs)
                        Example: --config=work or --config=work.mjs
                        If omitted, uses ./configEmailExtraction.mjs

 Task Selection:
  --task=<name>         Run a task from the configured tasksFolder (with or without .js)
                        Example: --task=downloadAudit or --task=downloadAudit.js
                        Looks in tasksFolder from config.json (default: ./extractEmailTasks)

 Output:
  -o, --output-folder   Write output to a folder or file instead of stdout
                        Example: -o ./output or --output-folder=./output/result.txt

 Testing:
  --test                Use mock email data (no real IMAP connection required)

 Email Selection:
  -n, --number <num>    Get a specific email by number (e.g., Email #5)
                        Always outputs the full body message
                        Example: extractEmail -n 5

  -f, --full-body       Output the full body message (not truncated)
                        Reduces default count to improve performance
                        Example: extractEmail -f subject 10

  -a, --attachment-download
                        Download attachment(s) from email(s)
                        Requires one of: -n <num>, from="email@site.com",
                        subject="pattern", or attachment=true (first with attachment)
                        Example: extractEmail -a -n 5
                        Example: extractEmail -a from="sender@example.com"
                        Example: extractEmail -a subject="Invoice" 
                        Example: extractEmail -a attachment=true

 Options:
  -h, --help            Show this help message
  from                  Extract sender addresses
  to                    Extract recipient addresses
  date                  Extract email dates
  subject               Extract email subjects
  body                  Extract email body text
  attachment            Extract attachment name(s) or false
  all                   Extract all fields (default)

 Examples:
  extractEmail                           Extract all fields from last 100 emails
  extractEmail --config=work subject 50  Extract subjects from last 50 emails using work account
  extractEmail from 25                   Extract sender from last 25 emails
  extractEmail attachment 10             Extract attachment names from last 10 emails
  extractEmail --task=myTask 50          Run myTask on last 50 emails
  extractEmail --config=work --task=myTask  Run task with specific account
  extractEmail -o ./output body 10        Write output to a file in ./output
  extractEmail -n 10                      Get email #10 with full body
  extractEmail -f all 20                  Get last 20 emails with full body
  extractEmail -a -n 5                    Download attachments from email #5
  extractEmail -a from="boss@work.com"    Download attachments from boss's emails

 Task Sets:`;

// Parse special arguments (--config, --test, --task, --number, --full-body, --attachment-download) and get remaining args.
const { configName, testMode, taskName, outputPath, emailNumber, fullBody, attachmentDownload, fromFilter, subjectFilter, attachmentFilter, filteredArgs } = parseSpecialArgs();

// Load main config for tasks folder resolution.
const mainConfig = loadMainConfig();

// Output options are set at runtime based on -o/--output-folder.
let outputOptions = null;

// Parameter variables.
var extract, count;

// Set parameter variables from filtered args (excludes --config, --task).
// Find any all-digit value to use as count, regardless of position.
const numericArgs = filteredArgs.filter(arg => /^\d+$/.test(arg));
const nonNumericArgs = filteredArgs.filter(arg => !/^\d+$/.test(arg));

// If --task is provided, use it as the task name.
if (taskName) {
  extract = taskName;
  count = numericArgs.length > 0 ? parseInt(numericArgs[0], 10) : (fullBody ? 20 : 100);
} else if (nonNumericArgs.length === 0) {
  // No options specified, just count (or nothing)
  extract = "all";
  count = numericArgs.length > 0 ? parseInt(numericArgs[0], 10) : (fullBody ? 20 : 100);
} else {
  // Use first non-numeric arg as extract option
  extract = nonNumericArgs[0];
  count = numericArgs.length > 0 ? parseInt(numericArgs[0], 10) : (fullBody ? 20 : 100);
}

/************************************* SUPPORT FUNCTIONS *************************************/
// Check if a task exists
function checkExtractTask(opt, useTaskFlag = false) {
  // Add .js extension if not provided
  const fileName = opt.endsWith('.js') ? opt : `${opt}.js`;

  // If --task flag was used, look in configured tasksFolder first
  if (useTaskFlag) {
    const configuredPath = path.resolve(__dirname, mainConfig.tasksFolder, fileName);
    if (fs.existsSync(configuredPath)) return configuredPath;
  }

  // Fall back to default extractEmailTasks folder (relative to cwd for backward compat)
  const defaultPath = path.resolve('./extractEmailTasks', fileName);
  if (fs.existsSync(defaultPath)) return defaultPath;

  // Also check in configured tasksFolder even without --task flag
  const configuredPath = path.resolve(__dirname, mainConfig.tasksFolder, fileName);
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
      const context = { connection, msg, __dirname, outputOptions };
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
const DEFAULT_RESPONSE_FILENAME = 'extractEmal.response.txt';
const MAX_BODY_PREVIEW_LENGTH = 200;

// Truncate body text to preview length (unless fullBody mode is enabled)
const truncateBody = (bodyText) => {
  if (fullBody || emailNumber !== null) return bodyText; // Don't truncate in full-body or specific email mode
  if (!bodyText) return bodyText;
  const text = String(bodyText);
  if (text.length <= MAX_BODY_PREVIEW_LENGTH) return text;
  return text.substring(0, MAX_BODY_PREVIEW_LENGTH) + '...';
};
const outputWriter = {
  enabled: false,
  filePath: null,
  initialized: false
};

const resolveOutputOption = (rawPath) => {
  if (!rawPath) return null;
  const resolvedPath = path.resolve(process.cwd(), rawPath);
  const hasTrailingSep = rawPath.endsWith(path.sep) || rawPath.endsWith('/') || rawPath.endsWith('\\');

  if (fs.existsSync(resolvedPath)) {
    const stat = fs.statSync(resolvedPath);
    return {
      type: stat.isDirectory() ? 'directory' : 'file',
      path: resolvedPath
    };
  }

  if (hasTrailingSep) {
    return { type: 'directory', path: resolvedPath };
  }

  if (path.extname(resolvedPath)) {
    return { type: 'file', path: resolvedPath };
  }

  return { type: 'directory', path: resolvedPath };
};

const prepareOutputWriter = (outputOption, isTaskMode) => {
  if (!outputOption || isTaskMode) return;

  if (outputOption.type === 'file' && fs.existsSync(outputOption.path)) {
    throw new Error(`Output file already exists: ${outputOption.path}`);
  }

  const targetFilePath = outputOption.type === 'file'
    ? outputOption.path
    : path.join(outputOption.path, DEFAULT_RESPONSE_FILENAME);

  outputWriter.enabled = true;
  outputWriter.filePath = targetFilePath;
  outputWriter.initialized = false;
};

const writeOutputLine = (line) => {
  if (!outputWriter.enabled) {
    console.log(line);
    return;
  }

  if (!outputWriter.initialized) {
    const dir = path.dirname(outputWriter.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputWriter.filePath, '');
    outputWriter.initialized = true;
  }

  fs.appendFileSync(outputWriter.filePath, `${line}\n`);
};

const setVal = (opt, headersPart, subject, body) => {
  if (opt == "subject") val = subject;
  else if (opt == "body") val = truncateBody(body);
  else if (opt == "attachment") val = currentAttachmentSummary;
  else val = headersPart[opt];
};

// Constant output to terminal.
var emailCount = 0;
var totalEmailsToDisplay = 0;
const outputToTerminal = (opt, val, h) => {
  if (h == 0) {
    const reversedNumber = totalEmailsToDisplay - emailCount;
    writeOutputLine('');
    writeOutputLine(`=== Email #${reversedNumber} ===`);
    emailCount++;
  }
  writeOutputLine(opt[0].toUpperCase() + opt.substr(1,) + ": " + val);
};

const findTextPart = (parts) => {
  for (const part of parts) {
    if (Array.isArray(part)) {
      const nested = findTextPart(part);
      if (nested) return nested;
      continue;
    }
    if (part.type === 'text' && part.subtype === 'plain') {
      return part;
    }
    if (part.parts) {
      const nested = findTextPart(part.parts);
      if (nested) return nested;
    }
  }
  return null;
};

const findHtmlPart = (parts) => {
  for (const part of parts) {
    if (Array.isArray(part)) {
      const nested = findHtmlPart(part);
      if (nested) return nested;
      continue;
    }
    if (part.type === 'text' && part.subtype === 'html') {
      return part;
    }
    if (part.parts) {
      const nested = findHtmlPart(part.parts);
      if (nested) return nested;
    }
  }
  return null;
};

const findAttachmentsInStruct = (parts, attachments = []) => {
  if (!parts) return attachments;

  const partList = Array.isArray(parts) ? parts : [parts];
  for (const part of partList) {
    if (Array.isArray(part)) {
      findAttachmentsInStruct(part, attachments);
      continue;
    }

    const disposition = part.disposition;
    const dispositionType = disposition && disposition.type
      ? disposition.type.toLowerCase()
      : '';
    const hasDispositionFilename = Boolean(
      disposition && disposition.params && disposition.params.filename
    );
    const hasPartName = Boolean(part.params && (part.params.name || part.params.filename));
    const isApplication = part.type && part.type.toLowerCase() === 'application';

    if (dispositionType === 'attachment') {
      attachments.push(part);
    } else if (hasDispositionFilename || hasPartName) {
      attachments.push(part);
    } else if (dispositionType === 'inline' && (hasDispositionFilename || isApplication)) {
      attachments.push(part);
    } else if (isApplication && part.subtype) {
      attachments.push(part);
    }

    if (part.parts) {
      findAttachmentsInStruct(part.parts, attachments);
    }
  }

  return attachments;
};

const getAttachmentFilename = (attachment) => {
  if (attachment.disposition && attachment.disposition.params && attachment.disposition.params.filename) {
    return attachment.disposition.params.filename;
  }
  if (attachment.params && attachment.params.name) {
    return attachment.params.name;
  }
  if (attachment.params && attachment.params.filename) {
    return attachment.params.filename;
  }
  if (attachment.subtype) {
    return `attachment.${attachment.subtype.toLowerCase()}`;
  }
  return 'attachment';
};

const getAttachmentSummary = (struct) => {
  const attachments = findAttachmentsInStruct(struct);
  if (!attachments.length) return false;
  const names = attachments.map(getAttachmentFilename).filter(Boolean);
  if (!names.length) return true;
  return names.length === 1 ? names[0] : names.join(', ');
};

const getRawMessagePart = (msg) => {
  if (!msg || !Array.isArray(msg.parts)) return null;
  return msg.parts.find(part => part.which === '' || part.which === 'RFC822' || part.which === 'BODY[]') || null;
};

const getAttachmentSummaryFromMessage = async (msg, connection = null) => {
  const struct = msg && msg.attributes ? msg.attributes.struct : null;
  const structSummary = getAttachmentSummary(struct);
  if (structSummary) return structSummary;

  // Try pre-fetched raw message part first
  let rawPart = getRawMessagePart(msg);

  // If no raw part available and we have a connection, re-fetch the full message
  if (!rawPart && connection && msg.attributes && msg.attributes.uid) {
    try {
      const uid = msg.attributes.uid;
      const refetch = await connection.search([['UID', uid]], { bodies: [''], struct: false });
      if (refetch && refetch.length > 0) {
        rawPart = getRawMessagePart(refetch[0]);
      }
    } catch (err) {
      // Silently fall through — struct-based detection is the primary method
    }
  }

  if (!rawPart) return false;

  try {
    const rawText = normalizePartBody(rawPart.body);
    if (!rawText.trim()) return false;
    const parsed = await simpleParser(rawText);
    if (!parsed.attachments || parsed.attachments.length === 0) return false;
    const names = parsed.attachments
      .map(attachment => attachment.filename)
      .filter(Boolean);
    if (!names.length) return true;
    return names.length === 1 ? names[0] : names.join(', ');
  } catch (err) {
    console.error('Error parsing message attachments:', err);
    return false;
  }
};

const normalizePartBody = (partBody) => {
  if (Buffer.isBuffer(partBody)) return partBody.toString('utf8');
  if (typeof partBody === 'string') return partBody;
  if (Array.isArray(partBody)) return partBody.join('\n');
  return String(partBody || '');
};

// Recursively find plain text body from message parts
const getPlainTextBody = async (message) => {
  try {
    const rawText = message.parts
      .filter(part => typeof part.which === 'string')
      .filter(part => part.which === 'TEXT' || part.which === 'BODY[]' || part.which.startsWith('TEXT') || part.which.startsWith('BODY'))
      .map(part => normalizePartBody(part.body))
      .filter(text => text && text.trim())
      .join('\n');

    if (!rawText.trim()) return '';

    const parsed = await simpleParser(rawText);
    return parsed.text || parsed.html || '';
  } catch (err) {
    console.error('Error parsing message body:', err);
    return '';
  }
};

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

// Download attachments from a message
async function downloadAttachments(connection, msg, headersPart, outputDir) {
  const struct = msg.attributes.struct;
  const attachments = findAttachmentsInStruct(struct);
  
  if (!attachments || attachments.length === 0) {
    console.log('No attachments found in this email.');
    return;
  }

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`\nDownloading ${attachments.length} attachment(s)...`);

  for (const attachment of attachments) {
    try {
      const filename = getAttachmentFilename(attachment);
      const partData = await connection.getPartData(msg, attachment);
      const filePath = path.join(outputDir, filename);
      
      // Write the attachment to disk
      fs.writeFileSync(filePath, partData);
      console.log(`✓ Downloaded: ${filename}`);
    } catch (err) {
      console.error(`✗ Error downloading attachment:`, err.message);
    }
  }
}

// Check if email matches filter criteria
function matchesFilters(headersPart, subject, hasAttachment) {
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
        const mockPath = path.resolve(__dirname, 'test', 'mockImap.mjs');
        const mockModule = await import(pathToFileURL(mockPath).href);
        imapModule = mockModule.mockImaps;
        configEmail = { imap: { test: true } }; // Dummy config for mock
      } else {
        const imaps = await import('imap-simple');
        imapModule = imaps.default || imaps;
        configEmail = await loadConfig(configName);
      }
      const connection = await imapModule.connect(configEmail);
      await connection.openBox('INBOX');

      const searchCriteria = ['ALL'];
      const fetchOptions = {
        bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'],
        struct: true
      };

      const messages = await connection.search(searchCriteria, fetchOptions);

      // Handle specific email number request
      if (emailNumber !== null) {
        if (emailNumber < 1 || emailNumber > messages.length) {
          console.error(`Error: Email #${emailNumber} does not exist. Total emails: ${messages.length}`);
          await connection.end();
          return;
        }
        // Get the specific email (1-indexed from newest, so #1 = most recent)
        const specificMsg = messages[messages.length - emailNumber];
        const lastMessages = [specificMsg];
        
        for (const [i, msg] of lastMessages.entries()) {
          const headersPart = msg.parts.find(p => p.which.includes('HEADER'))?.body || {};
          let subject = headersPart.subject || '';
          if (Array.isArray(subject)) subject = subject.join(' ');

          writeOutputLine('');
          writeOutputLine(`=== Email #${emailNumber} ===`);
          
          const struct = msg.attributes.struct;
          let body = '';
          
          // Try to find and fetch text/plain part first
          const textPart = findTextPart(struct);
          if (textPart) {
            try {
              const partData = await connection.getPartData(msg, textPart);
              body = Buffer.isBuffer(partData) ? partData.toString('utf8') : String(partData || '');
            } catch (err) {
              console.error('Error fetching text part:', err);
            }
          }
          
          // If no text/plain, try HTML part
          if (!body || !body.trim()) {
            const htmlPart = findHtmlPart(struct);
            if (htmlPart) {
              try {
                const partData = await connection.getPartData(msg, htmlPart);
                const htmlContent = Buffer.isBuffer(partData) ? partData.toString('utf8') : String(partData || '');
                if (htmlContent && htmlContent.trim()) {
                  const parsed = await simpleParser(htmlContent);
                  body = parsed.text || parsed.html || '';
                }
              } catch (err) {
                console.error('Error fetching HTML part:', err);
              }
            }
          }
          
          // Last resort: re-fetch message with TEXT body
          if (!body || !body.trim()) {
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

          currentAttachmentSummary = await getAttachmentSummaryFromMessage(msg, connection);

          // Output all fields for specific email number
          writeOutputLine('From: ' + (headersPart.from || ''));
          writeOutputLine('To: ' + (headersPart.to || ''));
          writeOutputLine('Date: ' + (headersPart.date || ''));
          writeOutputLine('Subject: ' + subject);
          writeOutputLine('Attachment: ' + (currentAttachmentSummary || 'false'));
          writeOutputLine('Body: ' + body);

          // Handle attachment download if requested
          if (attachmentDownload) {
            const downloadDir = outputOptions?.path || path.join(process.cwd(), 'attachments');
            await downloadAttachments(connection, msg, headersPart, downloadDir);
          }
        }
        await connection.end();
        return;
      }

      // Handle attachment download with filters
      if (attachmentDownload && !emailNumber) {
        let foundMatch = false;
        for (const [i, msg] of messages.entries()) {
          const headersPart = msg.parts.find(p => p.which.includes('HEADER'))?.body || {};
          let subject = headersPart.subject || '';
          if (Array.isArray(subject)) subject = subject.join(' ');
          
          const hasAttachment = await getAttachmentSummaryFromMessage(msg, connection);
          
          if (matchesFilters(headersPart, subject, hasAttachment)) {
            foundMatch = true;
            console.log(`\nFound matching email #${i + 1}:`);
            console.log('From:', headersPart.from || '');
            console.log('Subject:', subject);
            
            const downloadDir = outputOptions?.path || path.join(process.cwd(), 'attachments');
            await downloadAttachments(connection, msg, headersPart, downloadDir);
            
            // If attachment=true filter, only download from first match
            if (attachmentFilter) break;
          }
        }
        
        if (!foundMatch) {
          console.log('No emails found matching the specified filters.');
        }
        
        await connection.end();
        return;
      }

      // Look at the last N messages
      const lastMessages = messages.slice(-count);
      
      // Set total count for reversed numbering (newest = #1)
      totalEmailsToDisplay = lastMessages.length;
      emailCount = 0;

      for (const [i, msg] of lastMessages.entries()) {
        const headersPart = msg.parts.find(p => p.which.includes('HEADER'))?.body || {};
        let subject = headersPart.subject || '';
        if (Array.isArray(subject)) subject = subject.join(' ');

        // Check if task set or option.
        handleTaskSets(extract);

        const struct = msg.attributes.struct;
        let body = '';
        
        // Try to find and fetch text/plain part first
        const textPart = findTextPart(struct);
        if (textPart) {
          try {
            const partData = await connection.getPartData(msg, textPart);
            body = Buffer.isBuffer(partData) ? partData.toString('utf8') : String(partData || '');
          } catch (err) {
            console.error('Error fetching text part:', err);
          }
        }
        
        // If no text/plain, try HTML part
        if (!body || !body.trim()) {
          const htmlPart = findHtmlPart(struct);
          if (htmlPart) {
            try {
              const partData = await connection.getPartData(msg, htmlPart);
              const htmlContent = Buffer.isBuffer(partData) ? partData.toString('utf8') : String(partData || '');
              if (htmlContent && htmlContent.trim()) {
                const parsed = await simpleParser(htmlContent);
                body = parsed.text || parsed.html || '';
              }
            } catch (err) {
              console.error('Error fetching HTML part:', err);
            }
          }
        }
        
        // Last resort: re-fetch message with TEXT body
        if (!body || !body.trim()) {
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

        currentAttachmentSummary = await getAttachmentSummaryFromMessage(msg, connection);

        // If option, else handle task.
        if (optionCall == 1 && !taskName) {
          handleOption(extract, headersPart, subject, body);
        } else {
          await handleTask(extract, headersPart, subject, body, connection, msg, !!taskName);
        }
      }
      await connection.end();
    } catch (err) {
      console.error('Error fetching emails:', err);
    }
  }
}

// Call main function.
extractEmail();
