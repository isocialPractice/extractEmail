// extractEmailTasks/helpers/filterHelper.mjs
// Resolves {{ template }} syntax in task filter patterns.
// Supports regular expressions and {{ dates.* }} placeholders via @jhauga/getDate.
// Also provides date-range extraction from natural language text (e.g. "after 2/01").

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

// ---------------------------------------------------------------------------
// Date-range extraction from natural language body text
// ---------------------------------------------------------------------------

/**
 * Parse a date string fragment into a Date object.
 * Handles numeric (M/D, MM/DD, MM/DD/YY, MM/DD/YYYY) and named-month
 * ("Feb 1", "February 1st", "February 1, 2026") formats.
 * When no year is provided the current year is inferred; if the resulting
 * date would be in the future relative to today, the previous year is used.
 *
 * @param {string} fragment
 * @returns {Date|null}
 */
function parseDateFragment(fragment) {
  if (!fragment) return null;
  const s = fragment.trim();
  const today = new Date();

  // MM/DD/YYYY or M/D/YYYY or MM/DD/YY or M/D/YY
  const fullNumeric = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (fullNumeric) {
    let year = parseInt(fullNumeric[3], 10);
    if (year < 100) year += 2000;
    const d = new Date(year, parseInt(fullNumeric[1], 10) - 1, parseInt(fullNumeric[2], 10));
    return isNaN(d.getTime()) ? null : d;
  }

  // M/D or MM/DD (no year — infer)
  const shortNumeric = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (shortNumeric) {
    const year = today.getFullYear();
    const d = new Date(year, parseInt(shortNumeric[1], 10) - 1, parseInt(shortNumeric[2], 10));
    if (isNaN(d.getTime())) return null;
    if (d > today) d.setFullYear(year - 1);
    return d;
  }

  // "Month D[suffix][, YYYY]"  e.g. "Feb 1", "February 1st", "February 1, 2026"
  const MONTH_INDEX = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
    nov: 10, november: 10, dec: 11, december: 11,
  };
  const namedMatch = s.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/);
  if (namedMatch) {
    const monthIndex = MONTH_INDEX[namedMatch[1].toLowerCase()];
    if (monthIndex !== undefined) {
      const day  = parseInt(namedMatch[2], 10);
      const year = namedMatch[3] ? parseInt(namedMatch[3], 10) : today.getFullYear();
      const d = new Date(year, monthIndex, day);
      if (isNaN(d.getTime())) return null;
      if (!namedMatch[3] && d > today) d.setFullYear(year - 1);
      return d;
    }
  }

  return null;
}

/**
 * Extract a date range from natural language body text.
 * Detects temporal keywords followed by a date or date fragment.
 *
 * Supported keyword patterns:
 *   "after 2/01"              =>  { start: Feb 1 (year inferred), end: today }
 *   "since 02/01/2026"        =>  { start: Feb 1 2026,            end: today }
 *   "before 3/15"             =>  { start: null, end: Mar 15 (year inferred) }
 *   "from 2/01 to 3/23"       =>  { start: Feb 1, end: Mar 23 (year inferred) }
 *   "between 2/01 and 3/23"   =>  { start: Feb 1, end: Mar 23 (year inferred) }
 *
 * Supported date formats (M/D, MM/DD, MM/DD/YY, MM/DD/YYYY, named month):
 *   "after Feb 1"             =>  { start: Feb 1 (year inferred), end: today }
 *   "since January 15, 2026"  =>  { start: Jan 15 2026,           end: today }
 *
 * @param {string} text - Body text or any natural language string
 * @returns {{ start: Date|null, end: Date|null, description: string }|null}
 *          Returns null when no recognizable date pattern is found.
 */
export function extractDateRangeFromText(text) {
  if (!text) return null;
  const str = String(text);

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  // Sub-pattern fragments (used to build full regexes).
  const numDate   = '\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?';
  const monthPat  = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
  const namedDate = '(?:' + monthPat + ')\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{4})?';
  const dateFrag  = '(?:' + numDate + '|' + namedDate + ')';

  const candidates = [
    // "from <date> to <date>"
    {
      re: new RegExp('\\bfrom\\s+(' + dateFrag + ')\\s+to\\s+(' + dateFrag + ')', 'i'),
      build(m) {
        const start = parseDateFragment(m[1]);
        const end   = parseDateFragment(m[2]);
        if (start && end) return { start, end, description: m[1].trim() + ' to ' + m[2].trim() };
        return null;
      }
    },
    // "between <date> and <date>"
    {
      re: new RegExp('\\bbetween\\s+(' + dateFrag + ')\\s+and\\s+(' + dateFrag + ')', 'i'),
      build(m) {
        const start = parseDateFragment(m[1]);
        const end   = parseDateFragment(m[2]);
        if (start && end) return { start, end, description: m[1].trim() + ' to ' + m[2].trim() };
        return null;
      }
    },
    // "after <date>" or "since <date>"
    {
      re: new RegExp('\\b(?:after|since)\\s+(' + dateFrag + ')', 'i'),
      build(m) {
        const start = parseDateFragment(m[1]);
        if (start) return { start, end: new Date(today), description: 'after ' + m[1].trim() };
        return null;
      }
    },
    // "before <date>"
    {
      re: new RegExp('\\bbefore\\s+(' + dateFrag + ')', 'i'),
      build(m) {
        const end = parseDateFragment(m[1]);
        if (end) return { start: null, end, description: 'before ' + m[1].trim() };
        return null;
      }
    },
  ];

  for (const { re, build } of candidates) {
    const m = str.match(re);
    if (m) {
      const result = build(m);
      if (result) return result;
    }
  }

  return null;
}

/**
 * Test whether a date falls within a resolved date range.
 * A null boundary is treated as open-ended (no lower / upper limit).
 *
 * @param {Date|string|number} date - The date to test
 * @param {{ start: Date|null, end: Date|null }|null} range
 * @returns {boolean}
 */
export function testDateRange(date, range) {
  if (!range) return true;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return false;
  if (range.start && d < range.start) return false;
  if (range.end   && d > range.end)   return false;
  return true;
}
