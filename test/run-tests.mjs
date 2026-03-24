#!/usr/bin/env node
// test/run-tests.mjs
// Test runner for extractEmail - validates functionality without real email credentials.

import fs from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mainScript = path.resolve(__dirname, '..', 'extractEmail.mjs');
const tasksDir = path.resolve(__dirname, '..', 'extractEmailTasks');

/**
 * Create temp stop.js from template so stop task tests can run.
 */
function setupStopTask() {
  const templatePath = path.join(tasksDir, 'stop.js.template');
  const tempPath = path.join(tasksDir, 'stop.js');
  fs.copyFileSync(templatePath, tempPath);
}

/**
 * Remove temp stop.js after tests.
 */
function teardownStopTask() {
  const tempPath = path.join(tasksDir, 'stop.js');
  try { fs.unlinkSync(tempPath); } catch (_) { /* already removed */ }
}

/**
 * Create temp verbose.js from template so verbose task tests can run.
 */
function setupVerboseTask() {
  const templatePath = path.join(tasksDir, 'verbose.js.template');
  const tempPath = path.join(tasksDir, 'verbose.js');
  fs.copyFileSync(templatePath, tempPath);
}

/**
 * Remove temp verbose.js after tests.
 */
function teardownVerboseTask() {
  const tempPath = path.join(tasksDir, 'verbose.js');
  try { fs.unlinkSync(tempPath); } catch (_) { /* already removed */ }
}

// Test results tracking
let passed = 0;
let failed = 0;

/**
 * Run extractEmail with given arguments and return output.
 */
function runCommand(args, includeTestFlag = true) {
  return new Promise((resolve, reject) => {
    const cmdArgs = includeTestFlag ? ['--test', ...args] : args;
    const proc = spawn(process.execPath, [mainScript, ...cmdArgs], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    proc.on('error', reject);
  });
}

/**
 * Assert that output contains expected string.
 */
function assertContains(output, expected, testName) {
  if (output.includes(expected)) {
    console.log(`  ✓ ${testName}`);
    passed++;
    return true;
  } else {
    console.log(`  ✗ ${testName}`);
    console.log(`    Expected to contain: "${expected}"`);
    console.log(`    Actual output: "${output.substring(0, 200)}..."`);
    failed++;
    return false;
  }
}

/**
 * Assert that output does NOT contain a string.
 */
function assertNotContains(output, unexpected, testName) {
  if (!output.includes(unexpected)) {
    console.log(`  ✓ ${testName}`);
    passed++;
    return true;
  } else {
    console.log(`  ✗ ${testName}`);
    console.log(`    Should NOT contain: "${unexpected}"`);
    failed++;
    return false;
  }
}

// ============================================================================
// TEST SUITES
// ============================================================================

async function testFilterHelper() {
  console.log('\n[Test Suite] Filter Helper (Regex & Date Templates)\n');

  const { resolveFilterPattern, testPattern } =
    await import('../helpers/filterHelper.mjs');

  // --- resolveFilterPattern type detection ---

  const plain = resolveFilterPattern('invoice');
  if (plain && plain.type === 'string') {
    console.log('  ✓ Plain string pattern resolves to type "string"');
    passed++;
  } else {
    console.log('  ✗ Plain string pattern resolves to type "string"');
    failed++;
  }

  const regexPat = resolveFilterPattern('{{ [0-9]+ }}');
  if (regexPat && regexPat.type === 'regex') {
    console.log('  ✓ {{ regex }} pattern resolves to type "regex"');
    passed++;
  } else {
    console.log('  ✗ {{ regex }} pattern resolves to type "regex"');
    failed++;
  }

  const datePat = resolveFilterPattern('{{ dates.year }}');
  if (datePat && datePat.type === 'regex') {
    console.log('  ✓ {{ dates.year }} resolves to type "regex"');
    passed++;
  } else {
    console.log('  ✗ {{ dates.year }} resolves to type "regex"');
    failed++;
  }

  const nullPat = resolveFilterPattern(null);
  if (nullPat === null) {
    console.log('  ✓ null pattern resolves to null');
    passed++;
  } else {
    console.log('  ✗ null pattern resolves to null');
    failed++;
  }

  // --- testPattern: plain string ---

  assertContains(
    testPattern('Invoice #12345', resolveFilterPattern('invoice')) ? 'match' : '',
    'match',
    'Plain string: case-insensitive match succeeds'
  );
  assertNotContains(
    testPattern('Monthly Report', resolveFilterPattern('invoice')) ? 'match' : '',
    'match',
    'Plain string: non-matching text returns false'
  );

  // --- testPattern: null pattern always passes ---

  assertContains(
    testPattern('anything at all', null) ? 'pass' : '',
    'pass',
    'Null pattern always passes (skip filter)'
  );

  // --- testPattern: regex patterns ---

  assertContains(
    testPattern('Invoice #12345', resolveFilterPattern('{{ Invoice.*#[0-9]+ }}')) ? 'match' : '',
    'match',
    'Regex pattern: matches Invoice #12345'
  );
  assertNotContains(
    testPattern('Monthly Report', resolveFilterPattern('{{ Invoice.*#[0-9]+ }}')) ? 'match' : '',
    'match',
    'Regex pattern: non-matching subject returns false'
  );

  // Regex from subject in mock data
  assertContains(
    testPattern('Re: Your support ticket #789', resolveFilterPattern('{{ .*ticket #[0-9]+ }}')) ? 'match' : '',
    'match',
    'Regex pattern: matches support ticket subject'
  );

  // --- testPattern: date helpers ---

  // Get current year using the same getDate the helper uses
  const { getDateValues } = await import('../helpers/dateHelper.mjs');
  const dateVals = getDateValues();
  const currentYear  = dateVals['dates.year'];
  const currentMonth = dateVals['dates.month'];
  const lastYear     = dateVals['dates.lastYear'];

  assertContains(
    testPattern(`Report ${currentYear}`, resolveFilterPattern('{{ dates.year }}')) ? 'match' : '',
    'match',
    `{{ dates.year }} matches "Report ${currentYear}"`
  );
  assertNotContains(
    testPattern(`Report ${lastYear}`, resolveFilterPattern('{{ dates.year }}')) ? 'match' : '',
    'match',
    `{{ dates.year }} does not match "Report ${lastYear}" (last year)`
  );
  assertContains(
    testPattern(`${currentMonth} newsletter`, resolveFilterPattern('{{ dates.month }}')) ? 'match' : '',
    'match',
    `{{ dates.month }} matches "${currentMonth} newsletter"`
  );

  // --- testPattern: mixed literal + date ---

  const mixedPat = resolveFilterPattern(`Report - {{ dates.month }}`);
  assertContains(
    testPattern(`Report - ${currentMonth} 2024`, mixedPat) ? 'match' : '',
    'match',
    `Mixed literal+date matches "Report - ${currentMonth} 2024"`
  );
  assertNotContains(
    testPattern('Report - April 1900', mixedPat) ? 'match' : '',
    'match',
    'Mixed literal+date: wrong month returns false'
  );

  // --- testPattern: mixed literal + regex ---

  const litRegex = resolveFilterPattern('Invoice {{ #[0-9]+ }}');
  assertContains(
    testPattern('Invoice #12345', litRegex) ? 'match' : '',
    'match',
    'Literal+regex: "Invoice #12345" matched'
  );
  assertNotContains(
    testPattern('Invoice ABC', litRegex) ? 'match' : '',
    'match',
    'Literal+regex: "Invoice ABC" not matched (no digits)'
  );
}

async function testBasicExtraction() {
  console.log('\n[Test Suite] Basic Field Extraction\n');

  // Test: Extract all fields
  const allResult = await runCommand([]);
  assertContains(allResult.stdout, '[TEST MODE]', 'Test mode indicator shown');
  assertContains(allResult.stdout, 'Email #1', 'Processes emails');
  assertContains(allResult.stdout, 'From:', 'Shows From field');
  assertContains(allResult.stdout, 'Subject:', 'Shows Subject field');

  // Test: Extract only subject
  const subjectResult = await runCommand(['subject']);
  assertContains(subjectResult.stdout, 'Subject:', 'Subject extraction works');
  assertNotContains(subjectResult.stdout, 'Body:', 'Does not show other fields');

  // Test: Extract only from
  const fromResult = await runCommand(['from']);
  assertContains(fromResult.stdout, 'From:', 'From extraction works');
  assertContains(fromResult.stdout, '@', 'Shows email addresses');

  // Test: Extract attachments
  const attachmentResult = await runCommand(['attachment']);
  assertContains(attachmentResult.stdout, 'Attachment:', 'Attachment extraction works');
  assertContains(attachmentResult.stdout, 'invoice.pdf', 'Shows attachment filename');

  // Test: Limit count
  const limitResult = await runCommand(['subject', '2']);
  const emailMatches = limitResult.stdout.match(/Email #/g) || [];
  if (emailMatches.length <= 2) {
    console.log('  ✓ Count limit works');
    passed++;
  } else {
    console.log('  ✗ Count limit works');
    failed++;
  }
}

async function testStopTask() {
  console.log('\n[Test Suite] Stop Task\n');

  const result = await runCommand(['stop']);
  // The mock data has one email with subject "STOP"
  assertContains(result.stdout, 'user@messaging.com', 'Stop task finds STOP email');
}

async function testVerboseTask() {
  console.log('\n[Test Suite] Verbose Task\n');

  // Test: Run verbose task with default configuration (log-email + download-attachments)
  const result = await runCommand(['--task=verbose']);
  assertContains(result.stdout, '[TEST MODE]', 'Verbose task runs in test mode');
  assertContains(result.stdout, 'Processing Email', 'Verbose task processes emails');
  
  // Test: Verbose task shows log output
  assertContains(result.stdout, 'From', 'Verbose task logs From field');
  assertContains(result.stdout, 'Subject', 'Verbose task logs Subject field');

  // Test: Verbose task attempts to download attachments or reports no attachments
  // (in test mode, mock IMAP may not support full parsing, so either message is valid)
  const hasDownloadOutput = result.stdout.includes('Downloaded') || 
                           result.stdout.includes('No attachments') ||
                           result.stdout.includes('Download');
  if (hasDownloadOutput) {
    console.log('  ✓ Verbose task processes download-attachments task');
    passed++;
  } else {
    console.log('  ✗ Verbose task processes download-attachments task');
    console.log(`    Expected "Downloaded", "No attachments", or "Download" in output`);
    failed++;
  }
  
  // Test: Help shows verbose task
  const helpResult = await runCommand(['--help'], false);
  assertContains(helpResult.stdout, 'verbose', 'Help lists verbose task');
}

async function testHelpOutput() {
  console.log('\n[Test Suite] Help Output\n');

  // Help doesn't need --test flag
  const result = await runCommand(['--help'], false);
  assertContains(result.stdout, 'extractEmail', 'Shows app name');
  assertContains(result.stdout, '--config', 'Documents --config option');
  assertContains(result.stdout, '--test', 'Documents --test option');
  assertContains(result.stdout, '--output-folder', 'Documents --output-folder option');
  assertContains(result.stdout, 'attachment', 'Documents attachment option');
  assertContains(result.stdout, 'stop', 'Lists stop task');
  assertContains(result.stdout, 'downloadAttachments', 'Lists downloadAttachments task');
}

async function testUnknownOption() {
  console.log('\n[Test Suite] Unknown Option Handling\n');

  // Unknown options are treated as "all" (extract all fields) - this is intentional behavior
  const result = await runCommand(['unknown-option']);
  assertContains(result.stdout, 'From:', 'Unknown option defaults to extracting all fields');
  assertContains(result.stdout, 'Subject:', 'Unknown option extracts subject');
}

async function testTaskOption() {
  console.log('\n[Test Suite] --task Option\n');

  // Test: --task option runs a task from configured tasksFolder
  const result = await runCommand(['--task=stop']);
  assertContains(result.stdout, '[TEST MODE]', '--task mode shows test mode indicator');
  // The mock data has one email with subject "STOP" - stop task should find it
  assertContains(result.stdout, 'user@messaging.com', '--task=stop finds STOP email');

  // Test: --task option with count parameter
  const resultWithCount = await runCommand(['--task=stop', '2']);
  assertContains(resultWithCount.stdout, '[TEST MODE]', '--task with count shows test mode');

  // Test: Help output shows --task documentation
  const helpResult = await runCommand(['--help'], false);
  assertContains(helpResult.stdout, '--task', 'Help documents --task option');
  assertContains(helpResult.stdout, 'tasksFolder', 'Help mentions tasksFolder');
}

async function testJsonModes() {
  console.log('\n[Test Suite] JSON Output Modes\n');

  // Test: Basic JSON mode
  const jsonResult = await runCommand(['--json', 'all', '2']);
  assertContains(jsonResult.stdout, '"Email #', 'JSON mode outputs email keys');
  assertContains(jsonResult.stdout, '"From":', 'JSON mode outputs From field');
  assertContains(jsonResult.stdout, '"Subject":', 'JSON mode outputs Subject field');
  assertContains(jsonResult.stdout, '"Body":', 'JSON mode outputs Body field');

  // Verify JSON is valid
  try {
    const jsonData = JSON.parse(jsonResult.stdout.replace('[TEST MODE] Using mock email data\n\n', '').trim());
    if (jsonData['Email #2'] && jsonData['Email #1']) {
      console.log('  ✓ JSON mode produces valid JSON');
      passed++;
    } else {
      console.log('  ✗ JSON mode produces valid JSON');
      failed++;
    }
  } catch (err) {
    console.log('  ✗ JSON mode produces valid JSON');
    console.log(`    Parse error: ${err.message}`);
    failed++;
  }

  // Test: From and Date are strings, not arrays
  const jsonSingleResult = await runCommand(['--json', '-n', '1']);
  const jsonOutput = jsonSingleResult.stdout.replace('[TEST MODE] Using mock email data\n\n', '').trim();
  try {
    const jsonData = JSON.parse(jsonOutput);
    const firstEmail = Object.values(jsonData)[0];
    if (typeof firstEmail.From === 'string') {
      console.log('  ✓ From field is a string (not array)');
      passed++;
    } else {
      console.log('  ✗ From field is a string (not array)');
      failed++;
    }
    if (typeof firstEmail.Date === 'string') {
      console.log('  ✓ Date field is a string (not array)');
      passed++;
    } else {
      console.log('  ✗ Date field is a string (not array)');
      failed++;
    }
  } catch (err) {
    console.log('  ✗ Failed to validate From/Date types');
    console.log(`    Parse error: ${err.message}`);
    failed += 2;
  }

  // Test: JSON:html mode
  const jsonHtmlResult = await runCommand(['--json:html', '-n', '1']);
  assertContains(jsonHtmlResult.stdout, '"Email #', 'JSON:html mode outputs email keys');
  assertContains(jsonHtmlResult.stdout, '"Body":', 'JSON:html mode outputs Body field');

  // Test: JSON:table mode
  const jsonTableResult = await runCommand(['--json:table', '-n', '1']);
  assertContains(jsonTableResult.stdout, '"Email #', 'JSON:table mode outputs email keys');
  assertContains(jsonTableResult.stdout, '"Body":', 'JSON:table mode outputs Body field');

  // Verify JSON:table extracts table data correctly
  const jsonTableOutput = jsonTableResult.stdout.replace('[TEST MODE] Using mock email data\n\n', '').trim();
  try {
    const jsonData = JSON.parse(jsonTableOutput);
    const firstEmail = Object.values(jsonData)[0];
    if (firstEmail.Body && typeof firstEmail.Body === 'object') {
      // Check if Body has table column properties
      if (firstEmail.Body.Field && firstEmail.Body.Response) {
        console.log('  ✓ JSON:table extracts table columns as properties');
        passed++;

        // Verify column values are arrays
        if (Array.isArray(firstEmail.Body.Field) && Array.isArray(firstEmail.Body.Response)) {
          console.log('  ✓ JSON:table column values are arrays');
          passed++;
        } else {
          console.log('  ✗ JSON:table column values are arrays');
          failed++;
        }
      } else {
        console.log('  ✗ JSON:table extracts table columns as properties');
        failed++;
      }
    } else {
      console.log('  ✗ JSON:table Body is an object');
      failed++;
    }
  } catch (err) {
    console.log('  ✗ Failed to validate JSON:table structure');
    console.log(`    Parse error: ${err.message}`);
    failed += 2;
  }

  // Test: Help documents all JSON modes
  const helpResult = await runCommand(['--help'], false);
  assertContains(helpResult.stdout, '--json', 'Help documents --json option');
  assertContains(helpResult.stdout, '--json:html', 'Help documents --json:html option');
  assertContains(helpResult.stdout, '--json:table', 'Help documents --json:table option');
}

async function testFilterMode() {
  console.log('\n[Test Suite] --filter Mode\n');

  // Test: --filter with from= finds matching emails
  const fromResult = await runCommand(['--filter', 'from=example.com']);
  assertContains(fromResult.stdout, 'Found matching email', '--filter from= finds matching emails');
  assertContains(fromResult.stdout, 'sender1@example.com', '--filter from= shows matching sender');

  // Test: --filter with subject= finds matching emails
  const subjectResult = await runCommand(['--filter', 'subject=Invoice']);
  assertContains(subjectResult.stdout, 'Found matching email', '--filter subject= finds matching emails');
  assertContains(subjectResult.stdout, 'Invoice #12345', '--filter subject= shows matching subject');

  // Test: --filter with no matches reports appropriately
  const noMatchResult = await runCommand(['--filter', 'from=nonexistent@nowhere.com']);
  assertContains(noMatchResult.stdout, 'No emails found matching', '--filter reports no matches when none found');

  // Test: --filter is documented in help
  const helpResult = await runCommand(['--help'], false);
  assertContains(helpResult.stdout, '--filter', 'Help documents --filter option');
}

async function testBodyFilter() {
  console.log('\n[Test Suite] body= Filter Argument\n');

  // Test: body= filter finds emails by body content (with --filter)
  const bodyFilterResult = await runCommand(['--filter', 'body=invoice']);
  assertContains(bodyFilterResult.stdout, 'Found matching email', 'body= filter finds emails containing text');
  assertContains(bodyFilterResult.stdout, 'Invoice #12345', 'body= filter shows correct email subject');

  // Test: body= filter for "resolved" (support email)
  const resolvedResult = await runCommand(['--filter', 'body=resolved']);
  assertContains(resolvedResult.stdout, 'Found matching email', 'body= filter finds "resolved" text');
  assertContains(resolvedResult.stdout, 'support ticket', 'body= filter shows support ticket email');

  // Test: body= filter for "signing up" (welcome email)
  const signupResult = await runCommand(['--filter', 'body=signing up']);
  assertContains(signupResult.stdout, 'Found matching email', 'body= filter finds "signing up" text');
  assertContains(signupResult.stdout, 'Welcome', 'body= filter shows Welcome email');

  // Test: body= filter combined with from= filter
  const combinedResult = await runCommand(['--filter', 'body=attached', 'from=invoices.com']);
  assertContains(combinedResult.stdout, 'Found matching email', 'Combined body= and from= filters work');
  assertContains(combinedResult.stdout, 'Invoice #12345', 'Combined filters find correct email');

  // Test: body= filter with non-matching text
  const noMatchResult = await runCommand(['--filter', 'body=xyznonexistenttext123']);
  assertContains(noMatchResult.stdout, 'No emails found matching', 'body= filter reports no match for non-existent text');

  // Test: body= is documented in help
  const helpResult = await runCommand(['--help'], false);
  assertContains(helpResult.stdout, 'body=', 'Help documents body= filter argument');
}

async function testFilterBoolMode() {
  console.log('\n[Test Suite] --filter:bool Mode\n');

  // Test: --filter:bool outputs "true" when match is found
  const trueResult = await runCommand(['--filter:bool', 'from=example.com']);
  // Should output "true" (after test mode indicator)
  assertContains(trueResult.stdout, 'true', '--filter:bool outputs "true" when match found');
  // Should NOT output "Found matching email" details
  assertNotContains(trueResult.stdout, 'Found matching email', '--filter:bool does not show email details');

  // Test: --filter:bool with subject match outputs "true"
  const subjectTrueResult = await runCommand(['--filter:bool', 'subject=Invoice']);
  assertContains(subjectTrueResult.stdout, 'true', '--filter:bool subject= outputs "true" on match');

  // Test: --filter:bool with body match outputs "true"
  const bodyTrueResult = await runCommand(['--filter:bool', 'body=invoice']);
  assertContains(bodyTrueResult.stdout, 'true', '--filter:bool body= outputs "true" on match');

  // Test: --filter:bool outputs "false" when no match is found
  const falseResult = await runCommand(['--filter:bool', 'from=nonexistent@fakemail.xyz']);
  assertContains(falseResult.stdout, 'false', '--filter:bool outputs "false" when no match');
  assertNotContains(falseResult.stdout, 'No emails found matching', '--filter:bool does not show "No emails found" message');

  // Test: --filter:bool with count parameter
  const countResult = await runCommand(['--filter:bool', 'from=example.com', '2']);
  assertContains(countResult.stdout, 'true', '--filter:bool with count parameter works');

  // Test: --filter:bool combined filters
  const combinedResult = await runCommand(['--filter:bool', 'body=attached', 'from=invoices.com']);
  assertContains(combinedResult.stdout, 'true', '--filter:bool with combined filters finds match');

  // Test: --filter:bool combined filters no match
  const combinedNoMatchResult = await runCommand(['--filter:bool', 'body=foobar', 'from=nonexistent@']);
  assertContains(combinedNoMatchResult.stdout, 'false', '--filter:bool with combined filters returns false on no match');

  // Test: --filter:bool is documented in help
  const helpResult = await runCommand(['--help'], false);
  assertContains(helpResult.stdout, '--filter:bool', 'Help documents --filter:bool option');
  assertContains(helpResult.stdout, 'true/false', 'Help mentions true/false output');
}

async function testRangeOption() {
  console.log('\n[Test Suite] --range Option\n');

  // Test: --range extracts multiple emails with full body
  const rangeResult = await runCommand(['--range', '1-3']);
  assertContains(rangeResult.stdout, 'Email #1', '--range includes Email #1');
  assertContains(rangeResult.stdout, 'Email #2', '--range includes Email #2');
  assertContains(rangeResult.stdout, 'Email #3', '--range includes Email #3');
  assertContains(rangeResult.stdout, 'Body:', '--range outputs full body');

  // Test: --range= equals-sign syntax works
  const rangeEqResult = await runCommand(['--range=2-4']);
  assertContains(rangeEqResult.stdout, 'Email #2', '--range= syntax includes Email #2');
  assertContains(rangeEqResult.stdout, 'Email #4', '--range= syntax includes Email #4');
  assertNotContains(rangeEqResult.stdout, 'Email #1', '--range= syntax does not include Email #1');
  assertNotContains(rangeEqResult.stdout, 'Email #5', '--range= syntax does not include Email #5');

  // Test: open-ended range "50-" syntax goes to the last email (mock has 7 emails, so 5- = #5,#6,#7)
  const rangeOpenResult = await runCommand(['--range', '5-']);
  assertContains(rangeOpenResult.stdout, 'Email #5', '--range 5- includes Email #5');
  assertContains(rangeOpenResult.stdout, 'Email #6', '--range 5- includes Email #6');
  assertContains(rangeOpenResult.stdout, 'Email #7', '--range 5- includes Email #7');
  assertNotContains(rangeOpenResult.stdout, 'Email #4', '--range 5- does not include Email #4');

  // Test: "50-last" syntax is equivalent to "50-"
  const rangeOpenLastResult = await runCommand(['--range', '5-last']);
  assertContains(rangeOpenLastResult.stdout, 'Email #5', '--range 5-last includes Email #5');
  assertContains(rangeOpenLastResult.stdout, 'Email #7', '--range 5-last includes Email #7');
  assertNotContains(rangeOpenLastResult.stdout, 'Email #4', '--range 5-last does not include Email #4');

  // Test: open-ended help text is documented
  const helpResult2 = await runCommand(['--help'], false);
  assertContains(helpResult2.stdout, '50-', 'Help documents open-ended --range syntax');

  // Test: --range email numbers match actual positions (not 1-based within range)
  const rangeNumResult = await runCommand(['--range', '3-3']);
  assertContains(rangeNumResult.stdout, '=== Email #3 ===', '--range single email shows correct number');
  assertNotContains(rangeNumResult.stdout, '=== Email #1 ===', '--range single email does not show Email #1');

  // Test: --range with JSON output
  const rangeJsonResult = await runCommand(['--json', '--range', '1-2']);
  try {
    const json = JSON.parse(rangeJsonResult.stdout.replace(/^\[TEST MODE\].*\n/, '').trim());
    if (json['Email #1'] && json['Email #2']) {
      console.log('  ✓ --range JSON output has correct keys');
      passed++;
    } else {
      console.log('  ✗ --range JSON output has correct keys');
      failed++;
    }
  } catch (err) {
    console.log('  ✗ --range JSON output is valid JSON');
    failed++;
  }

  // Test: --range with criteria but no --filter flag shows full output for matching emails only
  // (implicit filter: --range 3-5 from=invoices.com should output full Email #4 details, not summary)
  const rangeImplicitFilterResult = await runCommand(['--range', '3-5', 'from=invoices.com']);
  assertContains(rangeImplicitFilterResult.stdout, '=== Email #4 ===', '--range implicit filter shows matching email with header');
  assertContains(rangeImplicitFilterResult.stdout, 'billing@invoices.com', '--range implicit filter shows matching email from field');
  assertNotContains(rangeImplicitFilterResult.stdout, '=== Email #3 ===', '--range implicit filter hides non-matching emails');
  assertNotContains(rangeImplicitFilterResult.stdout, 'Found matching email', '--range implicit filter shows full output (not summary)');

  // Test: --range with criteria, no --filter, no match reports appropriately
  const rangeImplicitNoMatchResult = await runCommand(['--range', '1-3', 'from=invoices.com']);
  assertContains(rangeImplicitNoMatchResult.stdout, 'No emails found matching', '--range implicit filter reports no match when target outside range');

  // Test: --range with --filter finds matching emails within range
  // Sorted newest-first: #4=billing@invoices.com (Invoice #12345), #5=user@messaging.com (STOP)
  const rangeFilterResult = await runCommand(['--range', '3-5', '--filter', 'from=invoices.com']);
  assertContains(rangeFilterResult.stdout, 'Found matching email #4', '--range --filter finds matching email at correct number');
  assertNotContains(rangeFilterResult.stdout, 'Found matching email #3', '--range --filter does not show non-matching email');

  // Test: --range --filter with match outside the range reports no match
  const rangeFilterNoMatchResult = await runCommand(['--range', '1-3', '--filter', 'from=invoices.com']);
  assertContains(rangeFilterNoMatchResult.stdout, 'No emails found matching', '--range --filter reports no match when match is outside range');

  // Test: --range --filter:bool outputs "true" when match is within range
  const rangeBoolTrueResult = await runCommand(['--range', '3-5', '--filter:bool', 'from=invoices.com']);
  assertContains(rangeBoolTrueResult.stdout, 'true', '--range --filter:bool outputs "true" on match');
  assertNotContains(rangeBoolTrueResult.stdout, 'false', '--range --filter:bool does not output "false" when match found');

  // Test: --range --filter:bool outputs "false" when match is outside range
  const rangeBoolFalseResult = await runCommand(['--range', '1-3', '--filter:bool', 'from=invoices.com']);
  assertContains(rangeBoolFalseResult.stdout, 'false', '--range --filter:bool outputs "false" when match is outside range');

  // Test: --range with -i ignore skips ignored emails within range
  const rangeIgnoreResult = await runCommand(['--range', '3-5', '-i', 'from=invoices.com']);
  assertNotContains(rangeIgnoreResult.stdout, 'billing@invoices.com', '--range -i ignores matching email');
  assertContains(rangeIgnoreResult.stdout, 'Email #3', '--range -i still shows non-ignored emails');

  // Test: --range is documented in help
  const helpResult = await runCommand(['--help'], false);
  assertContains(helpResult.stdout, '--range', 'Help documents --range option');
}

// ============================================================================
// MAIN
// ============================================================================

async function testCheckOption() {
  console.log('\n[Test Suite] --check Option\n');

  // Test: --check with a valid folder runs successfully
  const sentResult = await runCommand(['--check', 'Sent', 'subject', '5']);
  assertContains(sentResult.stdout, '[TEST MODE]', '--check with valid folder runs in test mode');
  assertContains(sentResult.stdout, 'Subject:', '--check with valid folder extracts subjects');

  // Test: --check with non-existent folder shows "does not exist" error
  const noFolderResult = await runCommand(['--check', 'NonExistentFolder999']);
  const noFolderOut = noFolderResult.stdout + noFolderResult.stderr;
  assertContains(noFolderOut, 'does not exist', '--check shows error for missing folder');

  // Test: --check with --range processes emails in specified folder
  const rangeResult = await runCommand(['--check', 'Sent', '--range', '1-3']);
  assertContains(rangeResult.stdout, 'Email #1', '--check with --range processes emails');

  // Test: --check with --filter does not error on valid folder
  const filterResult = await runCommand(['--check', 'Sent', '--filter', 'body=invoice']);
  const filterOut = filterResult.stdout + filterResult.stderr;
  assertNotContains(filterOut, 'does not exist', '--check with --filter does not error on valid folder');

  // Test: --check with --filter:bool works against the specified folder
  const boolResult = await runCommand(['--check', 'Sent', '--filter:bool', 'from=example.com']);
  const boolOut = boolResult.stdout;
  const hasBoolOutput = boolOut.includes('true') || boolOut.includes('false');
  if (hasBoolOutput) {
    console.log('  ✓ --check with --filter:bool outputs true or false');
    passed++;
  } else {
    console.log('  ✗ --check with --filter:bool outputs true or false');
    failed++;
  }

  // Test: --check is documented in help
  const helpResult = await runCommand(['--help'], false);
  assertContains(helpResult.stdout, '--check', 'Help documents --check option');
}

async function testStopOption() {
  console.log('\n[Test Suite] --stop Option\n');

  // Test: --stop alone limits standard extraction to 1 email
  const stopAloneResult = await runCommand(['--stop', 'subject', '5']);
  assertContains(stopAloneResult.stdout, 'Email #1', '--stop alone processes Email #1');
  assertNotContains(stopAloneResult.stdout, 'Email #2', '--stop alone stops after 1 email');

  // Test: --stop 2 limits standard extraction to 2 emails
  const stop2Result = await runCommand(['--stop', '2', 'subject', '7']);
  assertContains(stop2Result.stdout, 'Email #1', '--stop 2 processes Email #1');
  assertContains(stop2Result.stdout, 'Email #2', '--stop 2 processes Email #2');
  assertNotContains(stop2Result.stdout, 'Email #3', '--stop 2 stops before Email #3');

  // Test: --stop=N equals-sign syntax
  const stopEqResult = await runCommand(['--stop=1', 'subject', '7']);
  assertContains(stopEqResult.stdout, 'Email #1', '--stop=1 processes Email #1');
  assertNotContains(stopEqResult.stdout, 'Email #2', '--stop=1 stops after 1 email');

  // Test: count BEFORE --stop (the canonical real-world usage)
  // e.g. extractEmail --task=stop 7 --stop  (count=7, stopAfter=1)
  const countBeforeStopResult = await runCommand(['subject', '7', '--stop']);
  assertContains(countBeforeStopResult.stdout, 'Email #1', 'count before --stop: processes Email #1');
  assertNotContains(countBeforeStopResult.stdout, 'Email #2', 'count before --stop: stops after 1 email');

  // Test: --task + --stop — task runs on at most 1 email when --stop (N=1) is used
  // mock emails sorted newest-first: Email #5 = uid=3 from user@messaging.com, subject "STOP"
  // with --stop 1, we only reach Email #1 (not STOP email at #5)
  const taskStop1Result = await runCommand(['--task=stop', '7', '--stop']);
  // stop task only outputs when subject === "stop"; Email #1 subject is "Survey Response"
  assertNotContains(taskStop1Result.stdout, 'user@messaging.com', '--task --stop 1 stops before STOP email');

  // Test: --task + --stop 5 — reaches email #5 which IS the STOP email
  const taskStop5Result = await runCommand(['--task=stop', '7', '--stop', '5']);
  assertContains(taskStop5Result.stdout, 'user@messaging.com', '--task --stop 5 processes through STOP email at #5');

  // Test: --task + --stop 4 — stops before email #5 (the STOP email)
  const taskStop4Result = await runCommand(['--task=stop', '7', '--stop', '4']);
  assertNotContains(taskStop4Result.stdout, 'user@messaging.com', '--task --stop 4 stops before STOP email at #5');

  // Test: count BEFORE --stop N with task (real-world usage pattern)
  // extractEmail --task=stop 7 --stop 5  → same as above
  const taskCountBeforeStopResult = await runCommand(['--task=stop', '7', '--stop', '5']);
  assertContains(taskCountBeforeStopResult.stdout, 'user@messaging.com', '--task count before --stop 5 finds STOP email');

  // Test: --filter --stop 1 stops after first matching email
  // from=example.com matches Email #1 (marketing@example.com) and Email #7 (sender1@example.com)
  const filterStop1Result = await runCommand(['--filter', 'from=example.com', '--stop', '1']);
  assertContains(filterStop1Result.stdout, 'Found matching email', '--filter --stop 1 finds a match');
  // Should only find ONE match, not both
  const matchCount1 = (filterStop1Result.stdout.match(/Found matching email/g) || []).length;
  if (matchCount1 === 1) {
    console.log('  ✓ --filter --stop 1 stops after first match');
    passed++;
  } else {
    console.log('  ✗ --filter --stop 1 stops after first match');
    console.log(`    Expected 1 match, got ${matchCount1}`);
    failed++;
  }

  // Test: --filter --stop 2 finds both example.com matches
  const filterStop2Result = await runCommand(['--filter', 'from=example.com', '--stop', '2']);
  const matchCount2 = (filterStop2Result.stdout.match(/Found matching email/g) || []).length;
  if (matchCount2 === 2) {
    console.log('  ✓ --filter --stop 2 finds both matching emails');
    passed++;
  } else {
    console.log('  ✗ --filter --stop 2 finds both matching emails');
    console.log(`    Expected 2 matches, got ${matchCount2}`);
    failed++;
  }

  // Test: --stop is documented in help
  const helpResult = await runCommand(['--help'], false);
  assertContains(helpResult.stdout, '--stop', 'Help documents --stop option');
}

async function testMoveOption() {
  console.log('\n[Test Suite] --move Option\n');

  // Test: --move with body= filter moves matching emails and confirms the move
  const moveResult = await runCommand(['--move', 'invoices', 'body=invoice']);
  assertContains(moveResult.stdout, 'Moved email', '--move moves matching emails');
  assertContains(moveResult.stdout, 'invoices', '--move shows destination folder name');

  // Test: --move with subject= filter
  const moveSubjectResult = await runCommand(['--move', 'invoices', 'subject=Invoice']);
  assertContains(moveSubjectResult.stdout, 'Moved email', '--move subject= filter moves matching emails');

  // Test: --move with non-existent folder shows "does not exist" error
  const noFolderResult = await runCommand(['--move', 'nonexistentfolder777', 'body=invoice']);
  const noFolderOut = noFolderResult.stdout + noFolderResult.stderr;
  assertContains(noFolderOut, 'does not exist', '--move shows error for missing folder');

  // Test: --move with --range moves matching emails within range
  const rangeResult = await runCommand(['--move', 'invoices', 'body=invoice', '--range', '1-7']);
  assertContains(rangeResult.stdout, 'Moved email', '--move with --range moves matching emails');

  // Test: --move with count limit
  const countResult = await runCommand(['--move', 'invoices', 'body=invoice', '5']);
  assertContains(countResult.stdout, 'Moved email', '--move with count parameter works');

  // Test: --move without filter criteria shows informative error
  const noFilterResult = await runCommand(['--move', 'invoices']);
  const noFilterOut = noFilterResult.stdout + noFilterResult.stderr;
  assertContains(noFilterOut, 'requires filter', '--move without filter criteria shows error');

  // Test: --move no matches shows expected message
  const noMatchResult = await runCommand(['--move', 'invoices', 'body=xyznonexistenttext999']);
  assertContains(noMatchResult.stdout, 'No emails found matching', '--move reports no match when none found');

  // Test: --move is documented in help
  const helpResult = await runCommand(['--help'], false);
  assertContains(helpResult.stdout, '--move', 'Help documents --move option');
}

async function testCountOption() {
  console.log('\n[Test Suite] --count Option\n');

  // Test: --count alone outputs total email count (7 in mock)
  const countResult = await runCommand(['--count']);
  assertContains(countResult.stdout, '7', '--count outputs total email count');

  // Test: --count with subject filter outputs matching count (1 email: "Invoice #12345")
  const countSubjectResult = await runCommand(['--count', 'subject=Invoice']);
  assertContains(countSubjectResult.stdout, '1', '--count with subject filter outputs matching count');

  // Test: --count with from filter outputs matching count (2 emails from @example.com)
  const countFromResult = await runCommand(['--count', 'from=example.com']);
  assertContains(countFromResult.stdout, '2', '--count with from filter outputs matching count');

  // Test: --count with no match outputs 0
  const countNoMatchResult = await runCommand(['--count', 'subject=nonexistentxyz999']);
  assertContains(countNoMatchResult.stdout, '0', '--count with no match outputs 0');

  // Test: --count with explicit --filter flag also works
  const countFilterResult = await runCommand(['--count', '--filter', 'subject=Invoice']);
  assertContains(countFilterResult.stdout, '1', '--count with --filter flag and subject filter outputs count');

  // Test: --count all scans full inbox (same as default when mock has 7 emails)
  const countAllResult = await runCommand(['--count', 'from=example.com', 'all']);
  assertContains(countAllResult.stdout, '2', '--count all outputs count across all emails');

  // Test: --count with --range outputs count in range (3 emails in range 1-3)
  const countRangeResult = await runCommand(['--count', '--range', '1-3']);
  assertContains(countRangeResult.stdout, '3', '--count with --range outputs count in range');

  // Test: --count with --range and filter counts only matching emails in range
  // Range 1-7, from=example.com → Email #1 (marketing@example.com) and Email #7 (sender1@example.com)
  const countRangeFilterResult = await runCommand(['--count', '--range', '1-7', 'from=example.com']);
  assertContains(countRangeFilterResult.stdout, '2', '--count with --range and filter counts matching in range');

  // Test: --count with --range start beyond total returns 0
  const countRangeOverResult = await runCommand(['--count', '--range', '100-200']);
  assertContains(countRangeOverResult.stdout, '0', '--count with out-of-bounds range outputs 0');

  // Test: output is purely numeric (no labels)
  const countOnlyResult = await runCommand(['--count']);
  const trimmed = countOnlyResult.stdout.replace('[TEST MODE] Using mock email data\n\n', '').trim();
  if (/^\d+$/.test(trimmed)) {
    console.log('  ✓ --count output is purely numeric');
    passed++;
  } else {
    console.log('  ✗ --count output is purely numeric');
    console.log(`    Got: "${trimmed}"`);
    failed++;
  }

  // Test: --count is documented in help
  const helpResult = await runCommand(['--help'], false);
  assertContains(helpResult.stdout, '--count', 'Help documents --count option');
}

async function testMatchOption() {
  console.log('\n[Test Suite] --match Option\n');

  // Mock emails sorted newest-first:
  // #1 marketing@example.com  "Survey Response"
  // #2 survey@forms.com       "Survey Response"
  // #3 support@helpdesk.com   "Re: Your support ticket #789"
  // #4 billing@invoices.com   "Invoice #12345"         body: "invoice for this month"
  // #5 user@messaging.com     "STOP"
  // #6 noreply@company.com    "Monthly Report..."
  // #7 sender1@example.com    "Welcome to the service"

  // Test: --match alone (no filter) outputs first 1 email in normal block format
  const matchAloneResult = await runCommand(['--match', 'all']);
  assertContains(matchAloneResult.stdout, '=== Email #1 ===', '--match alone outputs Email #1 in block format');
  assertNotContains(matchAloneResult.stdout, '=== Email #2 ===', '--match alone stops after 1 email');
  assertNotContains(matchAloneResult.stdout, 'Found matching email', '--match alone uses normal output (not filter summary)');

  // Test: --match=1 equals-sign syntax
  const matchEqResult = await runCommand(['--match=1', 'all']);
  assertContains(matchEqResult.stdout, '=== Email #1 ===', '--match=1 outputs Email #1');
  assertNotContains(matchEqResult.stdout, '=== Email #2 ===', '--match=1 stops after 1 email');

  // Test: --match 2 (no filter) outputs first 2 emails
  const match2Result = await runCommand(['--match', '2', 'all']);
  assertContains(match2Result.stdout, '=== Email #1 ===', '--match 2 outputs Email #1');
  assertContains(match2Result.stdout, '=== Email #2 ===', '--match 2 outputs Email #2');
  assertNotContains(match2Result.stdout, '=== Email #3 ===', '--match 2 stops after 2 emails');

  // Test: --filter body=invoice --match outputs first matching email in normal format
  // Email #4 has "invoice" in body → should appear as === Email #4 ===
  const matchFilterResult = await runCommand(['--filter', 'body=invoice', '--match']);
  assertContains(matchFilterResult.stdout, '=== Email #4 ===', '--match with body filter outputs matched email in block format');
  assertContains(matchFilterResult.stdout, 'From:', '--match with filter shows From field');
  assertContains(matchFilterResult.stdout, 'Subject:', '--match with filter shows Subject field');
  assertNotContains(matchFilterResult.stdout, 'Found matching email', '--match with filter uses normal output (not filter summary)');
  assertNotContains(matchFilterResult.stdout, '=== Email #1 ===', '--match with filter skips non-matching emails');

  // Test: --filter from=example.com --match 2 outputs both matching emails in normal format
  // Matching: #1 marketing@example.com, #7 sender1@example.com
  const matchFrom2Result = await runCommand(['--filter', 'from=example.com', '--match', '2']);
  assertContains(matchFrom2Result.stdout, '=== Email #1 ===', '--match 2 with from filter outputs first match (Email #1)');
  assertContains(matchFrom2Result.stdout, '=== Email #7 ===', '--match 2 with from filter outputs second match (Email #7)');
  assertNotContains(matchFrom2Result.stdout, 'Found matching email', '--match 2 with filter uses normal output');

  // Test: --filter from=example.com --match 1 stops after first match
  const matchFrom1Result = await runCommand(['--filter', 'from=example.com', '--match', '1']);
  assertContains(matchFrom1Result.stdout, '=== Email #1 ===', '--match 1 with from filter outputs first match');
  assertNotContains(matchFrom1Result.stdout, '=== Email #7 ===', '--match 1 with from filter stops after first match');

  // Test: --filter from=example.com --match (default 1) — same as above
  const matchFromDefaultResult = await runCommand(['--filter', 'from=example.com', '--match']);
  assertContains(matchFromDefaultResult.stdout, '=== Email #1 ===', '--match (default) with from filter outputs first match');
  assertNotContains(matchFromDefaultResult.stdout, '=== Email #7 ===', '--match (default) does not output second match');

  // Test: --match with a count argument limits the search pool
  // Get 3 emails, find first body=invoice match — Email #4 is outside first 3, so no match
  const matchCountLimitResult = await runCommand(['--filter', 'body=invoice', '--match', '1', '3']);
  assertNotContains(matchCountLimitResult.stdout, '=== Email #4 ===', '--match with count 3 does not find email outside pool');
  assertContains(matchCountLimitResult.stdout, 'No emails found matching', '--match with limited count reports no match');

  // Test: --filter body=invoice --match 1 with enough count finds the email
  const matchWithCountResult = await runCommand(['--filter', 'body=invoice', '--match', '1', '10']);
  assertContains(matchWithCountResult.stdout, '=== Email #4 ===', '--match 1 with count 10 finds Email #4');

  // Test: --match with --range
  // Range 3-5 includes #3(support), #4(invoice), #5(STOP) — first body=invoice match is #4
  const matchRangeResult = await runCommand(['--filter', 'body=invoice', '--match', '--range', '3-5']);
  assertContains(matchRangeResult.stdout, '=== Email #4 ===', '--match with --range finds matching email within range');
  assertNotContains(matchRangeResult.stdout, 'Found matching email', '--match with --range uses normal output format');

  // Test: --match is documented in help
  const helpResult = await runCommand(['--help'], false);
  assertContains(helpResult.stdout, '--match', 'Help documents --match option');
}

async function testIndexOption() {
  console.log('\n[Test Suite] --index Option\n');

  // Mock emails sorted newest-first:
  // #1 marketing@example.com  "Survey Response"
  // #2 survey@forms.com       "Survey Response"
  // #3 support@helpdesk.com   "Re: Your support ticket #789"
  // #4 billing@invoices.com   "Invoice #12345"  body: "invoice for this month"
  // #5 user@messaging.com     "STOP"
  // #6 noreply@company.com    "Monthly Report..."
  // #7 sender1@example.com    "Welcome to the service"

  // Test: --index alone outputs all positions in default set (7 mock emails → 1,2,3,4,5,6,7)
  const indexAllResult = await runCommand(['--index']);
  const indexAllOut = indexAllResult.stdout.replace('[TEST MODE] Using mock email data\n\n', '').trim();
  if (indexAllOut === '1,2,3,4,5,6,7') {
    console.log('  ✓ --index alone outputs all positions');
    passed++;
  } else {
    console.log('  ✗ --index alone outputs all positions');
    console.log(`    Expected: "1,2,3,4,5,6,7"  Got: "${indexAllOut}"`);
    failed++;
  }

  // Test: --index with from= filter outputs matching positions only
  // from=example.com matches #1 (marketing@example.com) and #7 (sender1@example.com)
  const indexFromResult = await runCommand(['--index', 'from=example.com']);
  const indexFromOut = indexFromResult.stdout.replace('[TEST MODE] Using mock email data\n\n', '').trim();
  if (indexFromOut === '1,7') {
    console.log('  ✓ --index from= outputs correct matching positions');
    passed++;
  } else {
    console.log('  ✗ --index from= outputs correct matching positions');
    console.log(`    Expected: "1,7"  Got: "${indexFromOut}"`);
    failed++;
  }

  // Test: --index with body= filter outputs position of matching email only
  // body=invoice matches #4 (billing@invoices.com, "invoice for this month")
  const indexBodyResult = await runCommand(['--index', 'body=invoice']);
  const indexBodyOut = indexBodyResult.stdout.replace('[TEST MODE] Using mock email data\n\n', '').trim();
  if (indexBodyOut === '4') {
    console.log('  ✓ --index body= outputs correct matching position');
    passed++;
  } else {
    console.log('  ✗ --index body= outputs correct matching position');
    console.log(`    Expected: "4"  Got: "${indexBodyOut}"`);
    failed++;
  }

  // Test: --index with "all" keyword scans full inbox (same result as default for 7-email mock)
  const indexAllKeyResult = await runCommand(['--index', 'from=example.com', 'all']);
  const indexAllKeyOut = indexAllKeyResult.stdout.replace('[TEST MODE] Using mock email data\n\n', '').trim();
  if (indexAllKeyOut === '1,7') {
    console.log('  ✓ --index with "all" keyword outputs correct positions');
    passed++;
  } else {
    console.log('  ✗ --index with "all" keyword outputs correct positions');
    console.log(`    Expected: "1,7"  Got: "${indexAllKeyOut}"`);
    failed++;
  }

  // Test: --index with --range (no filter) outputs positions in range
  // --range 3-5 → positions 3, 4, 5
  const indexRangeResult = await runCommand(['--index', '--range', '3-5']);
  const indexRangeOut = indexRangeResult.stdout.replace('[TEST MODE] Using mock email data\n\n', '').trim();
  if (indexRangeOut === '3,4,5') {
    console.log('  ✓ --index --range (no filter) outputs positions in range');
    passed++;
  } else {
    console.log('  ✗ --index --range (no filter) outputs positions in range');
    console.log(`    Expected: "3,4,5"  Got: "${indexRangeOut}"`);
    failed++;
  }

  // Test: --index with --range and from= filter outputs matching positions within range
  // Range 3-5 includes #3(support), #4(invoice/billing@invoices.com), #5(STOP)
  // from=invoices.com matches only #4
  const indexRangeFilterResult = await runCommand(['--index', '--range', '3-5', 'from=invoices.com']);
  const indexRangeFilterOut = indexRangeFilterResult.stdout.replace('[TEST MODE] Using mock email data\n\n', '').trim();
  if (indexRangeFilterOut === '4') {
    console.log('  ✓ --index --range with filter outputs matching positions within range');
    passed++;
  } else {
    console.log('  ✗ --index --range with filter outputs matching positions within range');
    console.log(`    Expected: "4"  Got: "${indexRangeFilterOut}"`);
    failed++;
  }

  // Test: --index with no-match filter outputs empty result
  const indexNoMatchResult = await runCommand(['--index', 'from=nonexistent@nowhere.xyz']);
  const indexNoMatchOut = indexNoMatchResult.stdout.replace('[TEST MODE] Using mock email data\n\n', '').trim();
  if (indexNoMatchOut === '') {
    console.log('  ✓ --index with no-match filter outputs empty result');
    passed++;
  } else {
    console.log('  ✗ --index with no-match filter outputs empty result');
    console.log(`    Expected: ""  Got: "${indexNoMatchOut}"`);
    failed++;
  }

  // Test: --index with count limit respects the count
  // --index 3 → only first 3 emails → positions 1,2,3
  const indexCountResult = await runCommand(['--index', '3']);
  const indexCountOut = indexCountResult.stdout.replace('[TEST MODE] Using mock email data\n\n', '').trim();
  if (indexCountOut === '1,2,3') {
    console.log('  ✓ --index with count limit outputs correct positions');
    passed++;
  } else {
    console.log('  ✗ --index with count limit outputs correct positions');
    console.log(`    Expected: "1,2,3"  Got: "${indexCountOut}"`);
    failed++;
  }

  // Test: --index is documented in help
  const helpResult = await runCommand(['--help'], false);
  assertContains(helpResult.stdout, '--index', 'Help documents --index option');
}

async function main() {
  console.log('========================================');
  console.log('  extractEmail Test Suite');
  console.log('========================================');

  setupStopTask();
  setupVerboseTask();

  try {
    await testFilterHelper();
    await testHelpOutput();
    await testBasicExtraction();
    await testStopTask();
    await testVerboseTask();
    await testUnknownOption();
    await testTaskOption();
    await testJsonModes();
    await testFilterMode();
    await testBodyFilter();
    await testFilterBoolMode();
    await testRangeOption();
    await testStopOption();
    await testMoveOption();
    await testCheckOption();
    await testCountOption();
    await testMatchOption();
    await testIndexOption();
  } catch (err) {
    console.error('\nTest runner error:', err);
    process.exit(1);
  } finally {
    teardownStopTask();
    teardownVerboseTask();
  }

  console.log('\n========================================');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('========================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

main();
