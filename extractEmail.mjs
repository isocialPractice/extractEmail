#!/usr/bin/env node
// extractEmail
// Extract the last specified (defaults to 100) emails from an IMAP account.

// Import dependencies.
import fs from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import { simpleParser } from 'mailparser';
import { convert as htmlToText } from 'html-to-text';
import { parseDocument } from 'htmlparser2';
import { resolveFilterPattern, testPattern } from './helpers/filterHelper.mjs';
import { start as startMonitor, ping, stop } from './helpers/activityMonitor.mjs';
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


// --- Ignore option (-i/--ignore) helpers ---

// Normalize field aliases for -i option.
function normalizeIgnoreField(field) {
  field = field.trim().toLowerCase();
  if (field === 'attachments' || field === 'att') return 'attachment';
  return field;
}

// Convert a raw ignore value to a resolved pattern.
// Supports {{ }} template/regex syntax, glob wildcards (* ?), and plain substring.
function parseIgnoreValue(raw) {
  raw = raw.replace(/^["']|["']$/g, '');
  if (raw.includes('{{')) {
    return resolveFilterPattern(raw);
  }
  if (raw.includes('*') || raw.includes('?')) {
    // Escape regex special chars, then convert glob wildcards
    const specials = '.+^${}()|[]\\';
    let pat = '';
    for (const ch of raw) {
      if (ch === '*') pat += '.*';
      else if (ch === '?') pat += '.';
      else if (specials.includes(ch)) pat += '\\' + ch;
      else pat += ch;
    }
    return { type: 'regex', value: new RegExp('^' + pat + '$', 'i') };
  }
  return resolveFilterPattern(raw);
}

// Parse a single -i argument value into an array of { field, patterns } rules.
function parseIgnoreArg(val) {
  const rules = [];

  // Bracket notation: -i [attachment="*.jpg", from="spam"]
  const bracketMatch = val.match(/^\s*\[(.+)\]\s*$/);
  if (bracketMatch) {
    const ruleRegex = /(\w+)\s*=\s*(\[[^\]]*\]|"[^"]*"|'[^']*'|\S+)/g;
    let m;
    while ((m = ruleRegex.exec(bracketMatch[1])) !== null) {
      const field = normalizeIgnoreField(m[1]);
      let rawVal = m[2].replace(/^["']|["']$/g, '');
      const arrMatch = rawVal.match(/^\[(.+)\]$/);
      if (arrMatch) {
        const patterns = arrMatch[1].split(',').map(s => parseIgnoreValue(s.trim()));
        rules.push({ field, patterns });
      } else {
        rules.push({ field, patterns: [parseIgnoreValue(rawVal)] });
      }
    }
    return rules;
  }

  // Simple: field="pattern" or field=["p1","p2"]
  const eqIdx = val.indexOf('=');
  if (eqIdx > 0) {
    const field = normalizeIgnoreField(val.substring(0, eqIdx));
    let rawVal = val.substring(eqIdx + 1).replace(/^["']|["']$/g, '');
    const arrMatch = rawVal.match(/^\[(.+)\]$/);
    if (arrMatch) {
      const patterns = arrMatch[1].split(',').map(s => parseIgnoreValue(s.trim()));
      rules.push({ field, patterns });
    } else {
      rules.push({ field, patterns: [parseIgnoreValue(rawVal)] });
    }
    return rules;
  }

  return rules;
}

/**
 * Parse a range string into { start, end }.
 * Supports:
 *   "5-10"    → emails 5 through 10
 *   "50-"     → emails 50 through last
 *   "50-last" → emails 50 through last
 * @param {string} rangeStr
 * @returns {{ start: number, end: number|null }}  end is null for open-ended ranges
 */
function parseRangeArg(rangeStr) {
  // Open-ended: "50-" or "50-last" (case-insensitive)
  const openMatch = rangeStr.match(/^(\d+)-(?:last)?$/i);
  if (openMatch) {
    const start = parseInt(openMatch[1], 10);
    if (start < 1) throw new Error('--range start must be >= 1');
    return { start, end: null };
  }
  // Bounded: "5-10"
  const boundedMatch = rangeStr.match(/^(\d+)-(\d+)$/);
  if (!boundedMatch) throw new Error(`Invalid --range format: "${rangeStr}". Expected format: 5-10, 50-, or 50-last`);
  const start = parseInt(boundedMatch[1], 10);
  const end = parseInt(boundedMatch[2], 10);
  if (start < 1) throw new Error('--range start must be >= 1');
  if (end < start) throw new Error('--range end must be >= start (e.g. 5-10)');
  return { start, end };
}

/**
 * Parse special flags (--config, --test, --task, --output-folder, --number, --range, --full-body, --html, --json, --attachment-download, --filter, --filter:bool, --move, --stop, --count, --match, --index) from arguments.
 * @returns {{ configName: string|null, testMode: boolean, taskName: string|null, outputPath: string|null, emailNumber: number|null, emailRange: {start:number,end:number}|null, fullBody: boolean, htmlMode: boolean, jsonMode: string|null, attachmentDownload: boolean, filterMode: boolean, filterBoolMode: boolean, fromFilter: string|null, subjectFilter: string|null, bodyFilter: string|null, attachmentFilter: boolean, moveFolder: string|null, checkFolder: string|null, stopAfter: number|null, countMode: boolean, matchMode: boolean, matchAfter: number|null, indexMode: boolean, filteredArgs: string[] }}
 */
function parseSpecialArgs() {
  const args = process.argv.slice(2);
  let configName = null;
  let testMode = false;
  let taskName = null;
  let outputPath = null;
  let emailNumber = null;
  let emailRange = null;
  let fullBody = false;
  let htmlMode = false;
  let jsonMode = null;
  let attachmentDownload = false;
  let filterMode = false;
  let filterBoolMode = false;
  let fromFilter = null;
  let senderFilter = null;
  let subjectFilter = null;
  let bodyFilter = null;
  let attachmentFilter = false;
  let moveFolder = null;
  let checkFolder = null;
  let stopAfter = null;
  let countMode = false;
  let matchMode = false;
  let matchAfter = null;
  let indexMode = false;
  const ignoreRules = [];
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
    } else if (arg.startsWith('--range=')) {
      emailRange = parseRangeArg(arg.substring('--range='.length));
    } else if (arg === '--range') {
      if (i + 1 >= args.length) throw new Error('Missing value for --range');
      emailRange = parseRangeArg(args[++i]);
    } else if (arg === '--full-body' || arg === '-f') {
      fullBody = true;
    } else if (arg === '--html') {
      htmlMode = true;
    } else if (arg.startsWith('--json')) {
      if (arg === '--json') {
        jsonMode = 'default';
      } else if (arg.startsWith('--json:')) {
        const jsonArg = arg.substring('--json:'.length).toLowerCase();
        if (jsonArg === 'html' || jsonArg === 'table') {
          jsonMode = jsonArg;
        } else {
          throw new Error(`Invalid --json argument: ${jsonArg}. Use --json, --json:html, or --json:table`);
        }
      }
    } else if (arg === '--attachment-download' || arg === '-a') {
      attachmentDownload = true;
    } else if (arg.startsWith('from=')) {
      fromFilter = arg.substring('from='.length).replace(/^["']|["']$/g, '');
    } else if (arg.startsWith('sender=')) {
      senderFilter = arg.substring('sender='.length).replace(/^["']|["']$/g, '');
    } else if (arg.startsWith('subject=')) {
      subjectFilter = arg.substring('subject='.length).replace(/^["']|["']$/g, '');
    } else if (arg.startsWith('attachment=')) {
      const val = arg.substring('attachment='.length).toLowerCase();
      attachmentFilter = val === 'true';
    } else if (arg.startsWith('body=')) {
      bodyFilter = arg.substring('body='.length).replace(/^["']|["']$/g, '');
    } else if (arg === '--filter:bool') {
      filterMode = true;
      filterBoolMode = true;
    } else if (arg === '--filter') {
      filterMode = true;
    } else if (arg === '--move') {
      if (i + 1 >= args.length) throw new Error('Missing folder name for --move');
      moveFolder = args[++i];
    } else if (arg.startsWith('--move=')) {
      moveFolder = arg.substring('--move='.length);
    } else if (arg === '--check') {
      if (i + 1 >= args.length) throw new Error('Missing folder name for --check');
      checkFolder = args[++i];
    } else if (arg.startsWith('--check=')) {
      checkFolder = arg.substring('--check='.length);
    } else if (arg === '--test') {
      testMode = true;
    } else if (arg === '--count') {
      countMode = true;
    } else if (arg === '--stop') {
      // Optional numeric argument: --stop 3 or --stop (defaults to 1)
      if (i + 1 < args.length && /^\d+$/.test(args[i + 1])) {
        stopAfter = parseInt(args[++i], 10);
        if (stopAfter < 1) throw new Error('--stop value must be >= 1');
      } else {
        stopAfter = 1;
      }
    } else if (arg.startsWith('--stop=')) {
      const stopVal = arg.substring('--stop='.length);
      if (!/^\d+$/.test(stopVal)) throw new Error(`Invalid --stop value: "${stopVal}". Expected a positive integer.`);
      stopAfter = parseInt(stopVal, 10);
      if (stopAfter < 1) throw new Error('--stop value must be >= 1');
    } else if (arg === '--match') {
      matchMode = true;
      // Optional numeric argument: --match 3 or --match (defaults to 1)
      if (i + 1 < args.length && /^\d+$/.test(args[i + 1])) {
        matchAfter = parseInt(args[++i], 10);
        if (matchAfter < 1) throw new Error('--match value must be >= 1');
      } else {
        matchAfter = 1;
      }
    } else if (arg.startsWith('--match=')) {
      const matchVal = arg.substring('--match='.length);
      if (!/^\d+$/.test(matchVal)) throw new Error(`Invalid --match value: "${matchVal}". Expected a positive integer.`);
      matchMode = true;
      matchAfter = parseInt(matchVal, 10);
      if (matchAfter < 1) throw new Error('--match value must be >= 1');
    } else if (arg === '--index') {
      indexMode = true;
    } else if (arg === '--ignore' || arg === '-i') {
      if (i + 1 >= args.length) throw new Error('Missing value for -i/--ignore');
      const ignoreVal = args[++i];
      ignoreRules.push(...parseIgnoreArg(ignoreVal));
    } else {
      filteredArgs.push(arg);
    }
  }

  return { configName, testMode, taskName, outputPath, emailNumber, emailRange, fullBody, htmlMode, jsonMode, attachmentDownload, filterMode, filterBoolMode, fromFilter, senderFilter, subjectFilter, bodyFilter, attachmentFilter, moveFolder, checkFolder, stopAfter, countMode, matchMode, matchAfter, indexMode, ignoreRules, filteredArgs };
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
 "downloadAttachments": "Download attachments from emails matching filter criteria.",
 "verbose": "Flexible multi-task template for common email-response actions (log, download, run scripts)."
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

  --range <start-end>   Extract a specific range of emails (e.g., 5-10)
                        Outputs emails #5 through #10 with full body
                        Email #1 is the most recent
                        Use 50- or 50-last to extract from #50 to the very last email
                        Example: extractEmail --range 5-10
                        Example: extractEmail --range=5-10
                        Example: extractEmail --range 50-
                        Example: extractEmail --range 50-last

  -f, --full-body       Output the full body message (sanitized to text, not truncated)
                        HTML elements are removed and formatted for readability
                        Tables are converted to pipe-delimited format (| cell | cell |)
                        Reduces default count to improve performance
                        Example: extractEmail -f subject 10

  --html                Output the full body with raw HTML elements preserved
                        Use when you need original HTML content (e.g., for parsing)
                        Reduces default count to improve performance
                        Example: extractEmail --html subject 10

  --json                Output results in JSON format instead of text
                        Reduces default count to 20 for performance
                        Useful for programmatic parsing and data integration
                        Example: extractEmail --json all 10

  --json:html           Output JSON with hierarchical structure from HTML DOM
                        Reduces default count to 25 for performance
                        Preserves element nesting (div, span, p, h1-h6, etc.)
                        Tables extracted as arrays of row arrays
                        Single-child wrappers collapsed to deepest tag
                        Inline text appears in 'tag-data' properties
                        Example: extractEmail --json:html -n 1

  --json:table          Output JSON with columnar format from HTML tables
                        Reduces default count to 25 for performance
                        Extracts ONLY table data, removes all other content
                        Uses table headers (th) or first row (td) as property names
                        Column values stored as arrays
                        Example: extractEmail --json:table -n 1

  -i, --ignore <rule>  Ignore emails or attachments matching a pattern
                        Supports glob wildcards (*.jpg), {{ regex }}, {{ dates.* }}
                        Fields: from, subject, body, attachment
                        Examples:
                          -i attachment="*.jpg"
                          -i from="noreply@spam.com"
                          -i subject="{{ [Ss]pam.* }}"
                          -i attachment="*.jpg" -i from="ads@"
                          -i [attachment="*.jpg", from="ads@"]
                          -i attachment=["*.jpg","*.png"]

  -a, --attachment-download
                        Download attachment(s) from email(s)
                        Requires one of: -n <num>, from="email@site.com",
                        subject="pattern", body="text", or attachment=true
                        Example: extractEmail -a -n 5
                        Example: extractEmail -a from="sender@example.com"
                        Example: extractEmail -a subject="Invoice"
                        Example: extractEmail -a body="important meeting"
                        Example: extractEmail -a attachment=true

  --filter              Find and display emails matching filter criteria
                        Uses the same filter arguments as -a (from=, subject=, body=, attachment=)
                        Does NOT download attachments (use -a for that)
                        Example: extractEmail --filter from="boss@work.com"
                        Example: extractEmail --filter subject="Report"
                        Example: extractEmail --filter body="urgent"
                        Example: extractEmail --filter body="meeting" subject="Project"

  --move <folder>       Move emails matching filter criteria to a specified IMAP folder
                        Requires filter criteria (from=, sender=, subject=, body=, attachment=)
                        Verifies the folder exists before processing; throws if it does not
                        Supports count and --range to limit which emails are checked
                        Example: extractEmail --move invoices body="invoice"
                        Example: extractEmail --move invoices body="invoice" 20
                        Example: extractEmail --move "invoiced bills" body="invoice" --range 5-10
                        Error: Folder <name> does not exist (when folder is not found)

  --check <folder>      Search emails in a named IMAP folder instead of INBOX
                        Validates the folder exists before processing; throws if it does not
                        Works with all other options: --range, --filter, --filter:bool, -a, --task, etc.
                        Example: extractEmail --check "Sent" subject 20
                        Example: extractEmail --check "Sent" --range 10-20
                        Example: extractEmail --check "Archive" --filter body="invoice"
                        Error: Folder <name> does not exist (when folder is not found)

  --filter:bool         Check if any email matches filter criteria, output true/false
                        Outputs "true" and stops immediately when a match is found
                        Outputs "false" after checking all emails (default: 100) if no match
                        Useful for conditional logic in scripts
                        Example: extractEmail --filter:bool from="boss@"
                        Example: extractEmail --filter:bool body="urgent" 50
                        Example: extractEmail --filter:bool subject="Invoice" from="billing@"

  --stop [N]            Stop processing after N emails (standard mode) or N matching emails
                        (filter mode: -a, --filter, --move, --range with filters)
                        N is optional — when omitted, defaults to 1 (stop at first email/match)
                        Example: extractEmail --stop subject 50
                        Example: extractEmail --stop 3 subject 50
                        Example: extractEmail --filter subject="Invoice" --stop 2
                        Example: extractEmail --stop=5 all 100

  --match [N]           Find and output first N emails matching filter criteria in normal format
                        Like --filter but outputs in full email block format (not summary)
                        N is optional — when omitted, defaults to 1 (output first matching email)
                        Without filter criteria, outputs first N emails (same as --stop N)
                        Append "all" to search across every email (not just the default 100)
                        Example: extractEmail --match
                        Example: extractEmail --filter body="pattern" --match 3
                        Example: extractEmail --filter body="pattern" --match 2 all
                        Example: extractEmail --filter body="pattern" --match 3 --range 100-200
                        Example: extractEmail --filter body="pattern" --match 3 20 --task=taskName

  --count               Count the number of emails in the checked set or matching filters
                        Outputs a single integer; no other output is produced
                        Works with filter arguments (from=, subject=, body=, attachment=)
                        Works with --range to count within a specific range of emails
                        Append "all" to count across every email (not just the default 100)
                        Example: extractEmail --count
                        Example: extractEmail --count subject="Invoice"
                        Example: extractEmail --count from="boss@" all
                        Example: extractEmail --count body="urgent" --range 100-200

  --index               Output position numbers of emails in the checked set or matching filters
                        Useful to identify which -n number to pass in a follow-up call
                        Without filters: outputs all positions (e.g. 1,2,3,...,100)
                        With filters: outputs only positions of matching emails
                        Works with filter arguments (from=, subject=, body=, attachment=)
                        Works with --range to list positions within a specific range
                        Append "all" to index across every email (not just the default 100)
                        Example: extractEmail --index
                        Example: extractEmail --index subject="Invoice"
                        Example: extractEmail --index from="boss@" all
                        Example: extractEmail --index body="urgent" --range 100-200

 Filter Arguments (used with -a or --filter):
  from="email@domain"   Filter by sender email (partial match, case-insensitive)
  sender="email@domain" Filter by actual sender via Return-Path header (partial match, case-insensitive)
                        Checks the Return-Path (envelope sender), which may differ from
                        From when the sending address is not the author address
  subject="pattern"     Filter by subject text (partial match, case-insensitive)
  body="text"           Filter by email body/message content (partial match, case-insensitive)
  attachment=true       Match first email with any attachment

 Options:
  -h, --help            Show this help message
  from                  Extract sender addresses
  to                    Extract recipient addresses
  date                  Extract email dates
  subject               Extract email subjects
  body                  Extract email body text (sanitized, truncated to 200 chars)
  attachment            Extract attachment name(s) or false
  all                   Extract all fields (default, body is sanitized and truncated)

 Examples:
  extractEmail                           Extract all fields from last 100 emails
  extractEmail --config=work subject 50  Extract subjects from last 50 emails using work account
  extractEmail from 25                   Extract sender from last 25 emails
  extractEmail attachment 10             Extract attachment names from last 10 emails
  extractEmail --task=myTask 50          Run myTask on last 50 emails
  extractEmail --config=work --task=myTask  Run task with specific account
  extractEmail -o ./output body 10        Write output to a file in ./output
  extractEmail -n 10                      Get email #10 with full body
  extractEmail --range 5-10               Get emails #5 through #10 with full body
  extractEmail --range 50-                Get emails #50 through the last email
  extractEmail --range 50-last            Get emails #50 through the last email
  extractEmail -f all 20                  Get last 20 emails with full body (sanitized text)
  extractEmail --html all 20              Get last 20 emails with raw HTML preserved
  extractEmail --json all 10              Get last 10 emails in JSON format
  extractEmail --json:html -n 1           Get email #1 with hierarchical JSON structure
  extractEmail --json:table -n 1          Get email #1 with columnar table JSON format
  extractEmail -a -n 5                    Download attachments from email #5
  extractEmail -a from="boss@work.com"    Download attachments from boss's emails
  extractEmail -a body="invoice attached" Download attachments from emails containing text
  extractEmail --filter from="boss@"      Find emails from boss (no download)
  extractEmail --filter body="urgent"     Find emails with "urgent" in body
  extractEmail --filter body="meeting" subject="Project"  Find emails matching multiple filters
  extractEmail --filter:bool from="boss@" Check if boss email exists (outputs true/false)
  extractEmail --filter:bool body="urgent" 50  Check last 50 emails for "urgent" in body
  extractEmail -i attachment="*.jpg" -a -n 5  Download non-.jpg attachments from email #5
  extractEmail -i from="ads@co.com" subject 50  Ignore emails from ads when listing subjects
  extractEmail --move invoices body="invoice" 50  Move last 50 emails with "invoice" in body to invoices
  extractEmail --move invoices body="invoice" --range 5-10  Move range 5-10 matching body filter to invoices
  extractEmail --check "Sent" subject 20          Extract subjects from last 20 emails in Sent folder
  extractEmail --check "Sent" --range 10-20       Get emails #10-20 from Sent folder with full body
  extractEmail --check "Archive" --filter body="invoice"  Find invoice emails in Archive folder
  extractEmail --stop subject 50              Stop after first email processed
  extractEmail --stop 3 subject 50            Stop after processing 3 emails
  extractEmail --filter subject="Invoice" --stop 2  Find first 2 matching Invoice emails
  extractEmail --count                               Count emails in default set (100)
  extractEmail --count subject="Invoice"             Count emails with "Invoice" in subject
  extractEmail --count from="boss@" all              Count all matching emails across entire inbox
  extractEmail --count body="urgent" --range 100-200 Count matching emails within range 100-200
  extractEmail --index                               List positions of all emails in default set
  extractEmail --index subject="Invoice"             List positions of emails with "Invoice" in subject
  extractEmail --index from="boss@" all              List positions of matching emails across entire inbox
  extractEmail --index body="urgent" --range 100-200 List positions of matching emails in range 100-200
  extractEmail --match                               Output first matching email (normal format)
  extractEmail --filter body="pattern" --match 3     Output first 3 matching emails (normal format)
  extractEmail --filter body="pattern" --match 2 all Search all emails, output first 2 matches
  extractEmail --filter body="pattern" --match 3 --range 100-200  Match within range, output 3

 Task Sets:`;

// Parse special arguments (--config, --test, --task, --number, --full-body, --html, --json, --attachment-download, --filter, --filter:bool, --stop, --match) and get remaining args.
const { configName, testMode, taskName, outputPath, emailNumber, emailRange, fullBody, htmlMode, jsonMode, attachmentDownload, filterMode, filterBoolMode, fromFilter, senderFilter, subjectFilter, bodyFilter, attachmentFilter, moveFolder, checkFolder, stopAfter, countMode, matchMode, matchAfter, indexMode, ignoreRules, filteredArgs } = parseSpecialArgs();

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
function collectAllFolders(boxes, prefix = '', delimiter = '/') {
  const result = [];
  for (const [boxName, box] of Object.entries(boxes || {})) {
    const sep = (box && box.delimiter) || delimiter;
    const fullPath = prefix ? `${prefix}${sep}${boxName}` : boxName;
    result.push({ name: boxName, fullPath, attribs: (box && box.attribs) || [] });
    if (box && box.children) {
      result.push(...collectAllFolders(box.children, fullPath, sep));
    }
  }
  return result;
}

// Maps common shorthand folder names to their RFC 6154 IMAP special-use flag.
const FOLDER_SPECIAL_USE = {
  'sent':      '\\Sent',
  'drafts':    '\\Drafts',
  'draft':     '\\Drafts',
  'trash':     '\\Trash',
  'deleted':   '\\Trash',
  'junk':      '\\Junk',
  'spam':      '\\Junk',
  'archive':   '\\Archive',
  'flagged':   '\\Flagged',
  'starred':   '\\Flagged',
  'all':       '\\All',
  'allmail':   '\\All',
  'important': '\\Important',
};

/**
 * Search IMAP boxes for a folder matching targetName using three-pass priority:
 *   1. Exact name match (case-insensitive).
 *   2. IMAP special-use attribute match (e.g. "Sent" → \Sent flag, finds "[Gmail]/Sent Mail").
 *   3. Partial contains match (e.g. "Sent" matches "Sent Items", "Sent Mail").
 * Returns the full IMAP path needed for openBox / moveMessage, or null if not found.
 * @param {object} boxes - boxes object returned by connection.getBoxes()
 * @param {string} targetName - folder name to search for
 * @returns {string|null}
 */
function findFolderPath(boxes, targetName) {
  const folders = collectAllFolders(boxes);
  const nameLower = targetName.toLowerCase();

  // Pass 1: exact name match
  const exact = folders.find(f => f.name.toLowerCase() === nameLower);
  if (exact) return exact.fullPath;

  // Pass 2: IMAP special-use attribute match (RFC 6154)
  const specialFlag = FOLDER_SPECIAL_USE[nameLower];
  if (specialFlag) {
    const byAttr = folders.find(f =>
      f.attribs.some(a => a.toLowerCase() === specialFlag.toLowerCase())
    );
    if (byAttr) return byAttr.fullPath;
  }

  // Pass 3: partial contains match (case-insensitive)
  const partial = folders.find(f => f.name.toLowerCase().includes(nameLower));
  if (partial) return partial.fullPath;

  return null;
}

/**
 * Move an email (by UID) to a destination folder using the IMAP connection.
 * Supports both imap-simple's moveMessage() and raw node-imap connection.imap.move().
 * @param {object} connection - imap-simple connection object
 * @param {number|string} uid - email UID
 * @param {string} folderPath - destination folder path
 * @returns {Promise<void>}
 */
async function moveEmailToFolder(connection, uid, folderPath) {
  if (typeof connection.moveMessage === 'function') {
    return connection.moveMessage(uid, folderPath);
  }
  if (connection.imap && typeof connection.imap.move === 'function') {
    return new Promise((resolve, reject) => {
      connection.imap.move(uid, folderPath, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
  throw new Error('Move operation not supported by current IMAP connection');
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
      const wrappedConn = wrapConnectionForIgnore(connection);
      const context = { connection: wrappedConn, msg, __dirname, outputOptions, ignoreRules, downloadAttachments };
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

// JSON mode accumulator
let jsonOutput = {};
let currentEmailKey = null;

// Sanitize HTML to text with presentable formatting (respects block elements like p, div, br)
const sanitizeHtml = (htmlContent) => {
  if (!htmlContent) return htmlContent;
  const text = String(htmlContent);

  // Use html-to-text with options that respect basic HTML formatting
  const sanitized = htmlToText(text, {
    wordwrap: false,
    preserveNewlines: true,
    selectors: [
      { selector: 'p', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
      { selector: 'div', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
      { selector: 'br', options: { leadingLineBreaks: 1 } },
      { selector: 'h1', options: { uppercase: false, leadingLineBreaks: 2, trailingLineBreaks: 2 } },
      { selector: 'h2', options: { uppercase: false, leadingLineBreaks: 2, trailingLineBreaks: 2 } },
      { selector: 'h3', options: { uppercase: false, leadingLineBreaks: 2, trailingLineBreaks: 1 } },
      {
        selector: 'table',
        format: 'dataTable'
      },
      { selector: 'a', options: { ignoreHref: true } }
    ],
    formatters: {
      // Custom table formatter with pipe delimiters
      // Converts HTML tables to pipe-delimited format: | cell | cell |
      // Example output:
      // | Field | Response |
      // | Name | John Doe |
      'dataTable': function (elem, walk, builder, formatOptions) {
        builder.openBlock({ leadingLineBreaks: 1 });

        const rows = [];

        // Helper to extract text from a cell
        const getCellText = (cell) => {
          let text = '';
          const extractText = (node) => {
            if (!node) return;
            if (node.type === 'text') {
              text += node.data;
            } else if (node.children) {
              node.children.forEach(extractText);
            }
          };
          if (cell.children) {
            cell.children.forEach(extractText);
          }
          return text.replace(/\s+/g, ' ').trim();
        };

        // Process all rows
        const processRows = (node) => {
          if (!node) return;

          if (node.name === 'tr') {
            const cells = [];
            if (node.children) {
              node.children.forEach(child => {
                if (child.name === 'td' || child.name === 'th') {
                  cells.push(getCellText(child));
                }
              });
            }
            if (cells.length > 0) {
              rows.push('| ' + cells.join(' | ') + ' |');
            }
          } else if (node.children) {
            node.children.forEach(processRows);
          }
        };

        processRows(elem);

        if (rows.length > 0) {
          builder.addInline(rows.join('\n'));
        }

        builder.closeBlock({ trailingLineBreaks: 1 });
      }
    }
  });

  return sanitized;
};

// Parse HTML to hierarchical JSON preserving DOM structure.
// Uses htmlparser2 for proper DOM parsing instead of regex.
const parseHtmlToHierarchicalJson = (htmlContent) => {
  if (!htmlContent) return {};

  const doc = parseDocument(htmlContent);

  const SKIP_TAGS = new Set(['style', 'script', 'head', 'meta', 'link', 'noscript']);
  const TRANSPARENT_TAGS = new Set(['html', 'body', 'tbody', 'thead', 'tfoot']);
  const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'wbr', 'col', 'area', 'base', 'embed', 'source', 'track']);

  /** Get all text content recursively from a node. */
  function getTextContent(node) {
    if (node.type === 'text') return (node.data || '').replace(/\u00a0/g, ' ');
    if (!node.children) return '';
    return node.children.map(getTextContent).join('');
  }

  /** Extract table as array of row arrays. */
  function processTable(tableNode) {
    const rows = [];
    function findRows(node) {
      if (!node.children) return;
      for (const child of node.children) {
        if (child.type === 'tag' && child.name === 'tr') {
          const cells = [];
          for (const cell of (child.children || [])) {
            if (cell.type === 'tag' && (cell.name === 'td' || cell.name === 'th')) {
              cells.push(getTextContent(cell).trim());
            }
          }
          if (cells.length > 0) rows.push(cells);
        } else if (child.type === 'tag') {
          findRows(child);
        }
      }
    }
    findRows(tableNode);
    return rows;
  }

  /** Add value to result object, converting to array for duplicate keys. */
  function addToResult(obj, key, value) {
    if (key in obj) {
      if (Array.isArray(obj[key]) && !Array.isArray(value)) {
        obj[key].push(value);
      } else {
        obj[key] = [obj[key], value];
      }
    } else {
      obj[key] = value;
    }
  }

  /** Get meaningful children (non-empty text or non-skip/void tags). */
  function getMeaningfulChildren(node) {
    return (node.children || []).filter(c => {
      if (c.type === 'text') return (c.data || '').trim().length > 0;
      if (c.type === 'tag') return !SKIP_TAGS.has(c.name) && !VOID_TAGS.has(c.name);
      return false;
    });
  }

  /**
   * Collapse single-child wrappers to the deepest meaningful tag.
   * e.g. <div><p><span>text</span></p></div> → { tag: 'span', node: spanNode }
   */
  function collapseWrappers(node) {
    const meaningful = getMeaningfulChildren(node);
    if (meaningful.length === 1 && meaningful[0].type === 'tag') {
      const child = meaningful[0];
      if (child.name === 'table') return { tag: 'table', node: child };
      if (TRANSPARENT_TAGS.has(child.name)) return collapseWrappers(child);
      // If this child also has a single element child, keep collapsing
      const grandchildren = getMeaningfulChildren(child);
      if (grandchildren.length === 1 && grandchildren[0].type === 'tag') {
        return collapseWrappers(child);
      }
      return { tag: child.name, node: child };
    }
    return { tag: node.name || 'root', node };
  }

  /** Process children of a node into a result object. */
  function processChildren(children) {
    const result = {};
    let pendingText = '';

    for (const child of children) {
      if (child.type === 'text') {
        const text = (child.data || '').replace(/\u00a0/g, ' ').trim();
        if (text) {
          pendingText += (pendingText ? ' ' : '') + text;
        }
        continue;
      }

      if (child.type !== 'tag') continue;
      if (SKIP_TAGS.has(child.name)) continue;
      if (VOID_TAGS.has(child.name)) continue;

      // Flush pending text before a tag element
      if (pendingText) {
        addToResult(result, 'tag-data', pendingText);
        pendingText = '';
      }

      // Table → extract as row arrays
      if (child.name === 'table') {
        addToResult(result, 'table', processTable(child));
        continue;
      }

      // Transparent containers → merge children into current level
      if (TRANSPARENT_TAGS.has(child.name)) {
        const inner = processChildren(child.children || []);
        for (const [k, v] of Object.entries(inner)) {
          addToResult(result, k, v);
        }
        continue;
      }

      // Regular element → collapse single-child wrappers then process
      const { tag, node: deepNode } = collapseWrappers(child);

      if (tag === 'table') {
        addToResult(result, 'table', processTable(deepNode));
        continue;
      }

      const childResult = processElement(deepNode);
      if (childResult !== null) {
        addToResult(result, tag, childResult);
      }
    }

    // Flush remaining text
    if (pendingText) {
      addToResult(result, 'tag-data', pendingText);
    }

    return result;
  }

  /** Process a single element node, returning its value. */
  function processElement(node) {
    const meaningful = getMeaningfulChildren(node);

    // Leaf node or all-text children → return text content
    if (meaningful.length === 0 || meaningful.every(c => c.type === 'text')) {
      const text = getTextContent(node).trim();
      return text || null;
    }

    // Mixed or element children → recurse
    return processChildren(node.children || []);
  }

  // Process from document root
  const result = processChildren(doc.children || []);

  // Unwrap single top-level key that maps to an object (e.g. lone <html> wrapper)
  const keys = Object.keys(result);
  if (keys.length === 1 && typeof result[keys[0]] === 'object' && !Array.isArray(result[keys[0]])) {
    return result[keys[0]];
  }

  return result;
};

// Parse HTML tables to columnar JSON format
const parseHtmlTablesToColumnarJson = (htmlContent) => {
  if (!htmlContent) return {};

  // Find all tables in the HTML
  const tableRegex = /<table[^>]*>(.*?)<\/table>/gis;
  const tables = [];
  let match;

  while ((match = tableRegex.exec(htmlContent)) !== null) {
    tables.push(match[1]);
  }

  if (tables.length === 0) {
    // No tables found, return empty object
    return {};
  }

  const result = {};

  // Process each table (if multiple tables, merge columns)
  tables.forEach((tableHtml, tableIndex) => {
    const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
    const rows = [];
    let rowMatch;

    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      rows.push(rowMatch[1]);
    }

    if (rows.length === 0) return;

    // Extract cells from each row
    const cellRegex = /<(th|td)[^>]*>(.*?)<\/\1>/gis;
    const parsedRows = rows.map(row => {
      const cells = [];
      let cellMatch;
      // Reset regex for each row
      const rowCellRegex = /<(th|td)[^>]*>(.*?)<\/\1>/gis;
      while ((cellMatch = rowCellRegex.exec(row)) !== null) {
        // Remove HTML tags and decode entities
        let cellText = cellMatch[2]
          .replace(/<[^>]+>/g, '') // Remove HTML tags
          .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
          .replace(/&amp;/g, '&')  // Replace &amp; with &
          .replace(/&lt;/g, '<')   // Replace &lt; with <
          .replace(/&gt;/g, '>')   // Replace &gt; with >
          .replace(/&quot;/g, '"') // Replace &quot; with "
          .replace(/&#39;/g, "'")  // Replace &#39; with '
          .replace(/\r\n/g, ' ')   // Replace CRLF with space
          .replace(/\n/g, ' ')     // Replace LF with space
          .replace(/\s+/g, ' ')    // Collapse multiple spaces
          .trim();
        cells.push(cellText);
      }
      return cells;
    });

    if (parsedRows.length === 0) return;

    // Use first row as headers (whether th or td)
    const headers = parsedRows[0];
    if (!headers || headers.length === 0) return;

    // Initialize columns if not already present (for multiple tables)
    headers.forEach(header => {
      if (!result[header]) {
        result[header] = [];
      }
    });

    // Add data rows (skip first row which contains headers)
    for (let i = 1; i < parsedRows.length; i++) {
      const row = parsedRows[i];
      headers.forEach((header, colIndex) => {
        result[header].push(row[colIndex] || '');
      });
    }
  });

  return result;
};

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
const hasBodyContent = (body) => {
  if (!body) return false;
  if (typeof body === 'string') return body.trim().length > 0;
  if (typeof body === 'object') return Object.keys(body).length > 0;
  return true;
};

// Truncate body text to preview length (unless fullBody or htmlMode is enabled)
const truncateBody = (bodyText) => {
  if (fullBody || htmlMode || emailNumber !== null || emailRange !== null) return bodyText; // Don't truncate in full-body, html, specific email, or range mode
  if (!bodyText) return bodyText;
  if (typeof bodyText === 'object') return bodyText; // Preserve parsed JSON objects (json:html, json:table)
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
        const mockPath = path.resolve(__dirname, 'test', 'mockImap.mjs');
        const mockModule = await import(pathToFileURL(mockPath).href);
        imapModule = mockModule.mockImaps;
        configEmail = { imap: { test: true } }; // Dummy config for mock
      } else {
        const imaps = await import('imap-simple');
        imapModule = imaps.default || imaps;
        configEmail = await loadConfig(configName);
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
      messages.sort((a, b) => new Date(b.attributes.date || 0) - new Date(a.attributes.date || 0));

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
