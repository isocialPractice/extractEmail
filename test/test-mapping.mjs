#!/usr/bin/env node
/**
 * test-mapping.mjs
 * 
 * Tests for narrowRequestedData.js mapping functionality
 * Run with: node test/test-mapping.mjs
 */

import { parseEmailTask, parseDateSyntax, loadMapConfig } from '../helpers/narrowRequestedData.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

let passedTests = 0;
let failedTests = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(`  ${err.message}`);
    failedTests++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Values not equal'}: expected "${expected}", got "${actual}"`);
  }
}

console.log('='.repeat(65));
console.log('  narrowRequestedData.js - Mapping Tests');
console.log('='.repeat(65));
console.log('');

// Test 1: Basic parsing without mapping
test('Basic message parsing', () => {
  const result = parseEmailTask('send me reports for last 3 months', new Date('2026-03-12'));
  assertEquals(result.documentType, 'report', 'Document type');
  assert(result.dateRange !== null, 'Date range should be detected');
  assertEquals(result.recipient.type, 'sender', 'Recipient type');
});

// Test 2: Load map configuration
test('Load map configuration', () => {
  const mapConfig = loadMapConfig('example.json.template', projectRoot);
  assert(mapConfig !== null, 'Map config should load');
  assert(mapConfig.documents.length > 0, 'Should have documents');
  assert(mapConfig.recipients.length > 0, 'Should have recipients');
});

// Test 3: Parse date syntax
test('Parse date syntax - mm-dd-yy format', () => {
  const pattern = 'File-{% date(<mm>-<dd>-<yy>) %}.pdf';
  const result = parseDateSyntax(pattern);
  assert(result.includes('\\d{2}'), 'Should contain digit patterns');
  assertEquals(result, 'File-\\d{2}-\\d{2}-\\d{2}.pdf', 'Regex pattern');
});

// Test 4: Parse date syntax - yyyy format
test('Parse date syntax - yyyy format', () => {
  const pattern = 'Report-{% date(<yyyy>) %}.pdf';
  const result = parseDateSyntax(pattern);
  assertEquals(result, 'Report-\\d{4}.pdf', 'Regex pattern');
});

// Test 5: Parse date syntax - full month name
test('Parse date syntax - full month name', () => {
  const pattern = 'Statement-{% date(<MONTH>-<yyyy>) %}.pdf';
  const result = parseDateSyntax(pattern);
  assert(result.includes('January|February'), 'Should contain month names');
});

// Test 6: Parsing with map resolution
test('Parse with map resolution', () => {
  const options = {
    mapConfig: 'example.json.template',
    projectRoot: projectRoot
  };
  const result = parseEmailTask(
    'send me invoice reports for last 3 months',
    new Date('2026-03-12'),
    options
  );
  assert(result.document !== null, 'Document should be resolved');
  assert(result.document.folder !== null, 'Folder should be resolved');
});

// Test 7: Recipient resolution with %requestor%
test('Recipient resolution with %requestor%', () => {
  const taskMapData = {
    resolve: true,
    email: 'test@example.com',
    file: 'Test-File.pdf'
  };
  const options = {
    mapConfig: 'example.json.template',
    taskMapData: taskMapData,
    projectRoot: projectRoot
  };
  const result = parseEmailTask(
    'send me reports back to me',
    new Date('2026-03-12'),
    options
  );
  assertEquals(result.recipient.email, 'test@example.com', 'Email should be resolved from taskMapData');
});

// Test 8: Date range extraction - relative
test('Date range extraction - relative months', () => {
  const result = parseEmailTask('send reports for last 3 months', new Date('2026-03-12'));
  assert(result.dateRange !== null, 'Date range should exist');
  assert(result.dateRange.start !== null, 'Start date should exist');
  assert(result.dateRange.end !== null, 'End date should exist');
});

// Test 9: Date range extraction - year to date
test('Date range extraction - year to date', () => {
  const result = parseEmailTask('send reports year to date', new Date('2026-03-12'));
  assert(result.dateRange !== null, 'Date range should exist');
  assert(result.dateRange.description === 'year to date', 'Description should match');
});

// Test 10: Document type detection with typos
test('Document type detection with typos', () => {
  const result = parseEmailTask('send me fule reprot for last month', new Date('2026-03-12'));
  // "fule reprot" has typos but "reprot" should still match "report" 
  assert(result.documentType !== null, 'Should detect document type despite typos');
});

// Test 11: Recipient detection - by name
test('Recipient detection - by name', () => {
  const result = parseEmailTask('send John Smith the reports', new Date('2026-03-12'));
  assertEquals(result.recipient.type, 'named', 'Recipient type should be named');
  assert(result.recipient.display.includes('John Smith'), 'Should include name');
});

// Test 12: Recipient detection - by department
test('Recipient detection - by department', () => {
  const result = parseEmailTask('send accounting the reports', new Date('2026-03-12'));
  assertEquals(result.recipient.type, 'department', 'Recipient type should be department');
  assert(result.recipient.display.includes('accounting'), 'Should include department');
});

console.log('');
console.log('='.repeat(65));
console.log(`Test Results: ${passedTests} passed, ${failedTests} failed`);
console.log('='.repeat(65));

process.exit(failedTests > 0 ? 1 : 0);
