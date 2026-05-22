// CLI utilities: argument parsing, help text, config loaders.
// All functions are pure except loadConfig / loadMainConfig, which take packageRoot
// as a parameter so they remain decoupled from extractEmail.ts's location.

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { resolveFilterPattern } from './helpers/filterHelper.js';
/**
 * Load account configuration from specified file or default.
 * @param {string|null} configName - Config file name (with or without .mjs extension)
 * @returns {Promise<object>} The configEmail object
 */
export async function loadConfig(configName: string | null, packageRoot: string) {
  let configPath;

  if (configName) {
    // Load from accounts folder specified in config.json
    const mainConfigPath = path.resolve(packageRoot, 'config.json');

    if (!fs.existsSync(mainConfigPath)) {
      throw new Error('config.json not found. Create it with "accountsFolder" property.');
    }

    const mainConfig = JSON.parse(fs.readFileSync(mainConfigPath, 'utf8'));
    const accountsFolder = path.resolve(packageRoot, mainConfig.accountsFolder);

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
    const scriptConfig = path.resolve(packageRoot, 'configEmailExtraction.mjs');

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
export function normalizeIgnoreField(field) {
  field = field.trim().toLowerCase();
  if (field === 'attachments' || field === 'att') return 'attachment';
  return field;
}

// Convert a raw ignore value to a resolved pattern.
// Supports {{ }} template/regex syntax, glob wildcards (* ?), and plain substring.
export function parseIgnoreValue(raw) {
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
export function parseIgnoreArg(val) {
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
export function parseRangeArg(rangeStr) {
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
 * Resolve a `key=value` filter value, joining subsequent argv tokens when the
 * value opens with a quote (single or double) that isn't closed in the same token.
 *
 * This is needed on Windows `cmd.exe`, which does not treat single quotes as
 * quote characters. A phrase like `subject='foo bar baz'` is delivered to the
 * process as multiple separate argv tokens (`subject='foo`, `bar`, `baz'`),
 * which previously leaked into `filteredArgs` and caused the CLI to hang on a
 * bogus extract/count combination.
 *
 * @param args      Full argv slice.
 * @param startIdx  Index of the token containing `key=...`.
 * @param rawValue  Substring after `key=`.
 * @param key       The key name (for error messages).
 * @returns         Resolved value plus the new loop index (last consumed token).
 */
function consumeQuotedFilterValue(
  args: string[],
  startIdx: number,
  rawValue: string,
  key: string
): { value: string; newIndex: number } {
  const quote = rawValue[0] === '"' || rawValue[0] === "'" ? rawValue[0] : null;
  if (!quote) {
    return { value: rawValue, newIndex: startIdx };
  }
  let acc = rawValue.slice(1);
  // Closed in the same token: `key='foo'`
  if (acc.endsWith(quote)) {
    return { value: acc.slice(0, -1), newIndex: startIdx };
  }
  // Walk forward joining tokens with a space until the closing quote is found.
  for (let j = startIdx + 1; j < args.length; j++) {
    const tok = args[j];
    if (tok.endsWith(quote)) {
      acc += ' ' + tok.slice(0, -1);
      return { value: acc, newIndex: j };
    }
    acc += ' ' + tok;
  }
  throw new Error(
    `Unterminated quoted value for ${key}=. On Windows cmd.exe, single quotes are not recognized as quote characters — use double quotes instead (e.g. ${key}="value with spaces").`
  );
}

/**
 * Parse special flags (--config, --test, --task, --output-folder, --number, --range, --full-body, --html, --json, --attachment-download, --filter, --filter:bool, --move, --stop, --count, --match, --index) from arguments.
 * @returns {{ configName: string|null, testMode: boolean, taskName: string|null, outputPath: string|null, emailNumber: number|null, emailRange: {start:number,end:number}|null, fullBody: boolean, htmlMode: boolean, jsonMode: string|null, attachmentDownload: boolean, filterMode: boolean, filterBoolMode: boolean, fromFilter: string|null, subjectFilter: string|null, bodyFilter: string|null, attachmentFilter: boolean, moveFolder: string|null, checkFolder: string|null, stopAfter: number|null, countMode: boolean, matchMode: boolean, matchAfter: number|null, indexMode: boolean, filteredArgs: string[] }}
 */
export function parseSpecialArgs() {
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
      const r = consumeQuotedFilterValue(args, i, arg.substring('from='.length), 'from');
      fromFilter = r.value;
      i = r.newIndex;
    } else if (arg.startsWith('sender=')) {
      const r = consumeQuotedFilterValue(args, i, arg.substring('sender='.length), 'sender');
      senderFilter = r.value;
      i = r.newIndex;
    } else if (arg.startsWith('subject=')) {
      const r = consumeQuotedFilterValue(args, i, arg.substring('subject='.length), 'subject');
      subjectFilter = r.value;
      i = r.newIndex;
    } else if (arg.startsWith('attachment=')) {
      const val = arg.substring('attachment='.length).toLowerCase();
      attachmentFilter = val === 'true';
    } else if (arg.startsWith('body=')) {
      const r = consumeQuotedFilterValue(args, i, arg.substring('body='.length), 'body');
      bodyFilter = r.value;
      i = r.newIndex;
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
export function loadMainConfig(packageRoot: string) {
  const mainConfigPath = path.resolve(packageRoot, 'config.json');
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
export const optSet   = ["from", "to", "date", "subject", "attachment", "body"];

// Task set object for specific functions, and help output.
export const taskSets = {
 "stop": "Get the number from STOP request, and remove from messaging.",
 "downloadAttachments": "Download attachments from emails matching filter criteria.",
 "verbose": "Flexible multi-task template for common email-response actions (log, download, run scripts)."
};

// Help message.
export const help = `
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
  -v, --version         Print the installed extractEmail version and exit
  from                  Extract sender addresses
  to                    Extract recipient addresses
  date                  Extract email dates
  subject               Extract email subjects
  body                  Extract email body text (sanitized, truncated to 200 chars)
  attachment            Extract attachment name(s) or false
  all                   Extract all fields (default, body is sanitized and truncated)

 Examples:
  extractEmail                           Extract all fields from last 100 emails
  extractEmail --config=work subject 50  Extract subjects using work account
  extractEmail -n 10                     Get email #10 with full body
  extractEmail --range 5-10              Get emails #5 through #10
  extractEmail --json all 10             Get last 10 emails in JSON format
  extractEmail -a from="boss@work.com"   Download attachments from boss's emails
  extractEmail --filter body="urgent"    Find emails with "urgent" in body
  extractEmail --filter:bool from="boss@"  Check if boss email exists (true/false)
  extractEmail --move invoices body="invoice" 50  Move matching emails to folder
  extractEmail --task=myTask 50          Run myTask on last 50 emails

 Task Sets:`;