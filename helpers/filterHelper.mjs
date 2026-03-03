// extractEmailTasks/helpers/filterHelper.mjs
// Resolves {{ template }} syntax in task filter patterns.
// Supports regular expressions and {{ dates.* }} placeholders via @jhauga/getDate.

import { getDateValues } from './dateHelper.mjs';

// resolveFilterPattern(pattern)
//
// Resolve a filter pattern string that may contain {{ template }} syntax.
//
// --- Syntax ---
//
// Plain strings (no {{ }}):
//   Case-insensitive substring match -- existing behavior, unchanged.
//   Example: "Invoice"  =>  matches any text containing "invoice"
//
// Regular expression segments  {{ expr }}:
//   Content inside {{ }} is treated as a raw regex expression.
//   Literal text surrounding {{ }} is automatically escaped.
//   Examples:
//     "{{ .+ }}"              =>  case-insensitive regex matching one or more chars
//     "{{ [0-9]+ }}"          =>  case-insensitive regex matching digits
//     "{{ .{3,} }}"           =>  case-insensitive regex matching 3+ chars
//     "Invoice {{ #[0-9]+ }}" =>  literal "Invoice " then digit sequence
//
// Date helper placeholders  {{ dates.* }}:
//   Resolved to their current string values (escaped literals, not regex).
//   Supported placeholders (see dateHelper.mjs for the full list):
//     {{ dates.year }}           e.g. "2026"
//     {{ dates.lastYear }}       e.g. "2025"
//     {{ dates.nextYear }}       e.g. "2027"
//     {{ dates.month }}          e.g. "March"
//     {{ dates.lastMonth }}      e.g. "February"
//     {{ dates.month.abbr }}     e.g. "Mar"
//     {{ dates.lastMonth.abbr }} e.g. "Feb"
//     {{ dates.day }}            e.g. "03"
//     {{ dates.quarter }}        e.g. "1"
//     {{ dates.lastQuarter }}    e.g. "4"
//     {{ dates.year.short }}     e.g. "26"
//
// Mixed usage:
//   "Report - {{ dates.month }} {{ dates.year }}"
//     =>  matches "Report - March 2026" (literal, escaped)
//   "{{ dates.month }} {{ [0-9]{4} }}"
//     =>  matches "March 2026" (month literal + any 4-digit number)
//
// --- Return value ---
// Returns a resolved pattern object:
//   { type: 'string', value: string }  -- use testPattern() for case-insensitive includes
//   { type: 'regex',  value: RegExp }  -- use testPattern() for regex.test()
// Returns null when pattern is null/empty.
//
// @param {string|null} pattern
// @returns {{ type: 'string'|'regex', value: string|RegExp }|null}
export function resolveFilterPattern(pattern) {
  if (!pattern) return null;
  if (!pattern.includes('{{')) {
    const result = { type: 'string', value: pattern };
    // Backwards compat: allow old-style resolvedPattern.toLowerCase()
    result.toString = () => pattern;
    result.toLowerCase = () => pattern.toLowerCase();
    return result;
  }

  const dateValues = getDateValues();

  // Tokenize the pattern into literal text, date helpers, and raw regex segments.
  const tokens = [];
  const tokenRegex = /\{\{([\s\S]*?)\}\}/g;
  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(pattern)) !== null) {
    // Capture any literal text before this token.
    if (match.index > lastIndex) {
      tokens.push({ kind: 'literal', value: pattern.slice(lastIndex, match.index) });
    }

    const expr = match[1].trim();

    if (Object.prototype.hasOwnProperty.call(dateValues, expr)) {
      // Known date helper -> resolved literal (escaped in regex).
      tokens.push({ kind: 'date-literal', value: dateValues[expr] });
    } else {
      // Unknown -> treat as a raw regex expression.
      tokens.push({ kind: 'regex', value: expr });
    }

    lastIndex = match.index + match[0].length;
  }

  // Capture any trailing literal text.
  if (lastIndex < pattern.length) {
    tokens.push({ kind: 'literal', value: pattern.slice(lastIndex) });
  }

  // Build the final regex string from all tokens.
  let regexStr = '';
  for (const token of tokens) {
    if (token.kind === 'regex') {
      regexStr += token.value;
    } else {
      // Both 'literal' and 'date-literal' are escaped for use in a regex.
      regexStr += escapeRegexLiteral(token.value);
    }
  }

  let regex;
  try {
    regex = new RegExp(regexStr, 'i');
  } catch (e) {
    // Invalid regex -> fall back to case-insensitive string match on joined literal text.
    const plainText = tokens.map(t => t.value).join('');
    console.warn('[filterHelper] Invalid regex "' + regexStr + '", using string fallback: ' + e.message);
    const fb = { type: 'string', value: plainText };
    fb.toString = () => plainText;
    fb.toLowerCase = () => plainText.toLowerCase();
    return fb;
  }

  // Resolved plain string: token values joined (date helpers substituted, regex exprs as-is).
  // Used by backwards-compat .toLowerCase() so old task code still works.
  const resolvedString = tokens.map(t => t.value).join('');
  const result = { type: 'regex', value: regex };
  result.toString = () => resolvedString;
  result.toLowerCase = () => resolvedString.toLowerCase();
  return result;
}

/**
 * Test whether a text string matches a resolved filter pattern.
 *
 * @param {string} text
 * @param {{ type: 'string'|'regex', value: string|RegExp }|null} resolvedPattern
 * @returns {boolean}
 */
export function testPattern(text, resolvedPattern) {
  if (!resolvedPattern) return true;
  const str = String(text || '');
  if (resolvedPattern.type === 'regex') {
    return resolvedPattern.value.test(str);
  }
  return str.toLowerCase().includes(resolvedPattern.value.toLowerCase());
}

/**
 * Escape a string so every character is treated as a literal in a RegExp.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeRegexLiteral(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
