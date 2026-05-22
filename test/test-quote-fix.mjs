// Quick parser test: simulate Windows cmd.exe splitting a single-quoted
// subject filter across multiple argv tokens, and confirm the parser
// reassembles it (and does not leak tokens into filteredArgs).
import { parseSpecialArgs } from '../dist/cli.js';

// What cmd.exe actually delivers when the user types:
//   extractEmail --filter:bool subject='Tank Test - 2568 GA HIGHWAY 49, OGELTHORPE' --config=frfc 20
process.argv = [
  'node',
  'extractEmail',
  '--filter:bool',
  "subject='Tank",
  'Test',
  '-',
  '2568',
  'GA',
  'HIGHWAY',
  '49,',
  "OGELTHORPE'",
  '--config=frfc',
  '20',
];

const r = parseSpecialArgs();
console.log('subjectFilter:', JSON.stringify(r.subjectFilter));
console.log('filterBoolMode:', r.filterBoolMode);
console.log('configName:', r.configName);
console.log('filteredArgs:', r.filteredArgs);

const expected = 'Tank Test - 2568 GA HIGHWAY 49, OGELTHORPE';
if (r.subjectFilter !== expected) {
  console.error('FAIL: expected', JSON.stringify(expected));
  process.exit(1);
}
if (r.filteredArgs.length !== 1 || r.filteredArgs[0] !== '20') {
  console.error('FAIL: filteredArgs should be ["20"], got', r.filteredArgs);
  process.exit(1);
}
console.log('OK');

// Also confirm an unterminated quote throws a clear error.
process.argv = ['node', 'extractEmail', "subject='unterminated", 'value'];
try {
  parseSpecialArgs();
  console.error('FAIL: expected throw for unterminated quote');
  process.exit(1);
} catch (e) {
  if (!/Unterminated quoted value for subject=/.test(e.message)) {
    console.error('FAIL: wrong error:', e.message);
    process.exit(1);
  }
  console.log('OK (unterminated quote error)');
}
