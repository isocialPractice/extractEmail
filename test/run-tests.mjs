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

// ============================================================================
// MAIN
// ============================================================================

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
