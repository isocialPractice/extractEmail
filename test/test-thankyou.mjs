#!/usr/bin/env node
/**
 * test-thankyou.mjs
 *
 * Tests for isThankYouSegment and isThankYouChain from helpers/emailChain.mjs.
 * Run with: node test/test-thankyou.mjs
 */

import { isThankYouSegment, isThankYouChain } from '../helpers/emailChain.mjs';

let passedTests = 0;
let failedTests = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failedTests++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

console.log('='.repeat(65));
console.log('  Thank-You Detection Tests');
console.log('='.repeat(65));
console.log('');

// ---------------------------------------------------------------------------
// isThankYouSegment — unit tests
// ---------------------------------------------------------------------------

console.log('[isThankYouSegment]');

test('Simple "Thank you" passes', () => {
  assert(isThankYouSegment('Thank you!') === true);
});

test('Simple "Thanks" passes', () => {
  assert(isThankYouSegment('Thanks') === true);
});

test('"Thank you so much, have a great day!" passes', () => {
  assert(isThankYouSegment('Thank you so much, have a great day!') === true);
});

test('"Received. Thanks" passes', () => {
  assert(isThankYouSegment('Received. Thanks') === true);
});

test('"Got it, thanks!" passes', () => {
  assert(isThankYouSegment('Got it, thanks!') === true);
});

test('"Much appreciated!" passes', () => {
  assert(isThankYouSegment('Much appreciated!') === true);
});

test('"Thanks for sending those. Can you also send the docs from last week." fails (has request)', () => {
  assert(
    isThankYouSegment(
      'Thanks for sending those documents earlier. Can you also send the docs from last week.'
    ) === false
  );
});

test('"Could you forward the reports?" fails (request, no pure thanks)', () => {
  assert(isThankYouSegment('Thanks, could you forward the reports?') === false);
});

test('Long paragraph with thanks fails (>3 sentences)', () => {
  assert(
    isThankYouSegment(
      'Thanks for the update. I wanted to mention that the numbers look off. ' +
      'We should review them. Also the formatting needs work.'
    ) === false
  );
});

test('Empty string returns false', () => {
  assert(isThankYouSegment('') === false);
});

test('null returns false', () => {
  assert(isThankYouSegment(null) === false);
});

test('Body with signature — "Thank you" plus contact block passes', () => {
  const body = [
    'Thank you so much, have a great day!',
    '',
    '',
    '[cid:db5dc948-0f30-4766-ae91-7ee736087f3f]',
    '',
    'Jane Doe',
    '',
    '123 Main Street',
    '',
    'Springfield, IL 62701',
    '',
    '(555) 123-4567 office',
  ].join('\n');
  assert(isThankYouSegment(body) === true);
});

test('"Please send me the report" without thanks fails', () => {
  assert(isThankYouSegment('Please send me the report for last month.') === false);
});

// ---------------------------------------------------------------------------
// isThankYouChain — integration tests
// ---------------------------------------------------------------------------

console.log('\n[isThankYouChain]');

const THANK_YOU_CHAIN = [
  // Index 0 — empty forward wrapper
  ' ',
  '',
  '',
  '----------------------------------------',
  'From: Acme Corp <jane.doe@example.com>',
  'Sent: Wednesday, March 25, 2026 8:20:53 AM',
  'To: Northwind Traders <admin@example.org>',
  'Subject: Re: Contoso Ltd - 02/01/2026 to 03/23/2026',
  '',
  'Thank you so much, have a great day!',
  '',
  '',
  '[cid:db5dc948-0f30-4766-ae91-7ee736087f3f]',
  '',
  'Jane Doe',
  '',
  '123 Main Street',
  '',
  'Springfield, IL 62701',
  '',
  '(555) 123-4567 office',
  '',
  '----------------------------------------',
  'From: admin@example.org <admin@example.org>',
  'Sent: Tuesday, March 24, 2026 8:53 PM',
  'To: jane.doe@example.com',
  'Subject: Contoso Ltd - 02/01/2026 to 03/23/2026',
  '',
  'Hello,',
  '',
  'Attached are the separate statements from 02/01/2026 to 03/23/2026',
  '',
  'Take Care,',
].join('\n');

test('Chain with thank-you at index 1 (index 0 empty) returns true', () => {
  assert(isThankYouChain(THANK_YOU_CHAIN) === true);
});

const REQUEST_CHAIN = [
  ' ',
  '',
  '----------------------------------------',
  'From: admin@example.org <admin@example.org>',
  'Sent: Tuesday, March 24, 2026 8:53 PM',
  'To: jane.doe@example.com',
  'Subject: Contoso Ltd - 02/01/2026 to 03/23/2026',
  '',
  'Hello,',
  '',
  'Thanks for sending those documents earlier. Can you also send the docs from last week.',
  '',
  'Take Care,',
].join('\n');

test('Chain with request after thanks returns false', () => {
  assert(isThankYouChain(REQUEST_CHAIN) === false);
});

const NON_CHAIN_THANKYOU = 'Thanks!';

test('Non-chain single "Thanks!" returns true', () => {
  assert(isThankYouChain(NON_CHAIN_THANKYOU) === true);
});

const NON_CHAIN_REQUEST = 'Please send me the billing statements for last month.';

test('Non-chain request body returns false', () => {
  assert(isThankYouChain(NON_CHAIN_REQUEST) === false);
});

test('null body returns false', () => {
  assert(isThankYouChain(null) === false);
});

test('Empty body returns false', () => {
  assert(isThankYouChain('') === false);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(65));
console.log(`  Results: ${passedTests} passed, ${failedTests} failed`);
console.log('='.repeat(65));

process.exit(failedTests > 0 ? 1 : 0);
