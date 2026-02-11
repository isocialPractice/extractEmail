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

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('========================================');
  console.log('  extractEmail Test Suite');
  console.log('========================================');

  setupStopTask();

  try {
    await testHelpOutput();
    await testBasicExtraction();
    await testStopTask();
    await testUnknownOption();
    await testTaskOption();
    await testJsonModes();
  } catch (err) {
    console.error('\nTest runner error:', err);
    process.exit(1);
  } finally {
    teardownStopTask();
  }

  console.log('\n========================================');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('========================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

main();
