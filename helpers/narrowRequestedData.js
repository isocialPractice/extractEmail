/**
 * narrowRequestedData.js [1]
 * [1] = Message data
 * 
 * Parses natural language email messages to extract:
 *   I.   Document / data type to send
 *   II.  Date range (relative or absolute)
 *   III. Recipient
 *
 * Supports mapping configuration for document/recipient resolution and file matching.
 * 
 * Today's reference date: current date as Month/date/year, 
 * formatted as [0-9]{2}-[0-9]{2}-[0-9]{4}
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join as pathJoin, resolve as pathResolve, isAbsolute as pathIsAbsolute, dirname, resolve, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { classifyAndNarrowChain } from './emailChain.mjs';

// ---------------------------------------------
// A. WORD-TO-NUMBER MAP
// ---------------------------------------------
const WORD_TO_NUM = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, ninety: 90,
  // common typos / alternate spellings
  tow: 2, tre: 3, fore: 4, foor: 4, fiv: 5, sic: 6,
  nein: 9, elevin: 11, twelv: 12, tweleve: 12,
};

/**
 * Replace spelled-out numbers (and minor typos) with digits.
 * Handles compound forms like "twenty four" = 24.
 */
function wordsToDigits(text) {
  // Normalise
  let s = text.toLowerCase();

  // Compound tens+units: "twenty four" = 24
  s = s.replace(
    /\b(twenty|thirty|forty|fifty|sixty|ninety)\s+(one|two|three|four|five|six|seven|eight|nine|tow|tre|fore|foor|fiv|sic)\b/g,
    (_, tens, units) => (WORD_TO_NUM[tens] || 0) + (WORD_TO_NUM[units] || 0)
  );

  // Single words
  s = s.replace(
    /\b(zero|one|two|tow|three|tre|four|fore|foor|five|fiv|six|sic|seven|eight|nine|nein|ten|eleven|elevin|twelve|twelv|tweleve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|ninety)\b/g,
    (w) => WORD_TO_NUM[w] ?? w
  );

  return s;
}

// ---------------------------------------------
// I. DOCUMENT TYPE DICTIONARY
// ---------------------------------------------
const DOCUMENT_TYPES = [
  // -- Financial --
  { canonical: 'invoice',            aliases: ['invoice', 'invoices', 'inv', 'invioce', 'invoce'] },
  { canonical: 'receipt',            aliases: ['receipt', 'receipts', 'reciept', 'recipt'] },
  { canonical: 'balance sheet',      aliases: ['balance sheet', 'balance sheets', 'balancesheet'] },
  { canonical: 'income statement',   aliases: ['income statement', 'profit and loss', 'p&l', 'pnl'] },
  { canonical: 'expense report',     aliases: ['expense report', 'expense reports', 'expenses'] },
  { canonical: 'budget report',      aliases: ['budget report', 'budget', 'budgets', 'budgit'] },
  { canonical: 'financial report',   aliases: ['financial report', 'financial reports', 'finance report', 'financials'] },
  { canonical: 'payroll report',     aliases: ['payroll', 'payroll report', 'payrol', 'pay roll'] },
  { canonical: 'tax report',         aliases: ['tax report', 'tax returns', 'tax filing', 'taxes'] },

  // -- / Industrial --
  { canonical: 'report',             aliases: ['report', 'reports', 'log', 'logs', 'fule report', 'feul report', 'usage', 'consumption', 'petrol report', 'diesel report'] },
  { canonical: 'maintenance report', aliases: ['maintenance report', 'maintenance reports', 'service report', 'repair report', 'maintenence report'] },
  { canonical: 'production report',  aliases: ['production report', 'production reports', 'output report', 'yield report'] },
  { canonical: 'inventory report',   aliases: ['inventory report', 'inventory', 'stock report', 'invetory', 'inventoy'] },
  { canonical: 'safety report',      aliases: ['safety report', 'incident report', 'hazard report', 'safty report'] },
  { canonical: 'equipment report',   aliases: ['equipment report', 'equipment log', 'asset report', 'equipement report'] },

  // -- Farming / Agricultural --
  { canonical: 'harvest report',     aliases: ['harvest report', 'crop report', 'yield report', 'harvist report'] },
  { canonical: 'field report',       aliases: ['field report', 'field reports', 'feild report'] },
  { canonical: 'livestock report',   aliases: ['livestock report', 'animal report', 'herd report', 'livstock report'] },

  // -- Business / Marketing --
  { canonical: 'sales report',       aliases: ['sales report', 'sales reports', 'sales data', 'revenue report', 'slaes report'] },
  { canonical: 'marketing report',   aliases: ['marketing report', 'campaign report', 'marketing data', 'markting report'] },
  { canonical: 'performance report', aliases: ['performance report', 'kpi report', 'metrics report', 'preformance report'] },
  { canonical: 'audit report',       aliases: ['audit report', 'audit', 'auidt report', 'compliance report'] },
  { canonical: 'quarterly report',   aliases: ['quarterly report', 'quarterly reports', 'q1', 'q2', 'q3', 'q4', 'quarter report'] },
  { canonical: 'annual report',      aliases: ['annual report', 'yearly report', 'year end report', 'anual report'] },

  // -- Media / Creative --
  { canonical: 'media report',       aliases: ['media report', 'press report', 'coverage report'] },
  { canonical: 'analytics report',   aliases: ['analytics report', 'analytics', 'web report', 'traffic report', 'analytic report'] },

  // -- Generic --
  { canonical: 'report',             aliases: ['report', 'reports', 'reprot', 'reort', 'document', 'documents', 'doc', 'docs', 'summary', 'summaries', 'data', 'file', 'files', 'records', 'record', 'log', 'logs'] },
  { canonical: 'statement',          aliases: ['statement', 'statements', 'statment'] },
  { canonical: 'contract',           aliases: ['contract', 'contracts', 'agreement', 'agreements'] },
  { canonical: 'proposal',           aliases: ['proposal', 'proposals', 'proposel'] },
  { canonical: 'spreadsheet',        aliases: ['spreadsheet', 'spreadsheets', 'excel', 'sheet', 'sheets'] },
];

function detectDocumentType(text) {
  const lower = text.toLowerCase();
  // Longer / more specific matches first
  const sorted = [...DOCUMENT_TYPES].sort((a, b) => b.canonical.length - a.canonical.length);
  for (const { canonical, aliases } of sorted) {
    for (const alias of aliases) {
      if (lower.includes(alias)) return canonical;
    }
  }
  return null;
}

// ---------------------------------------------
// B & C. DATE RANGE EXTRACTION
// ---------------------------------------------

/**
 * Parse relative date language and return { start, end } as MM-MM-YYYY strings.
 * Reference point: TODAY (example 03-12-2026).
 */
function extractDateRange(rawText, today = new Date()) {
  // First replace word-numbers with digits
  const text = wordsToDigits(rawText);

  const endDate = new Date(today);

  // Patterns: "last N months/weeks/days/years"
  // Also handles: "past", "previous", "prior" as synonyms for "last"
  const relativePattern = /\b(?:last|past|previous|prior|prev|lsat|passt)\s+(\d+)\s*(month|months|mnth|mnths|week|weeks|wk|wks|day|days|dy|dys|year|years|yr|yrs)\b/i;
  const match = text.match(relativePattern);

  if (match) {
    const n        = parseInt(match[1], 10);
    const unitRaw  = match[2].toLowerCase();
    const startDate = new Date(endDate);

    if (/^month|mnth/.test(unitRaw)) {
      startDate.setMonth(startDate.getMonth() - n);
    } else if (/^week|wk/.test(unitRaw)) {
      startDate.setDate(startDate.getDate() - n * 7);
    } else if (/^day|dy/.test(unitRaw)) {
      startDate.setDate(startDate.getDate() - n);
    } else if (/^year|yr/.test(unitRaw)) {
      startDate.setFullYear(startDate.getFullYear() - n);
    }

    return {
      start: formatDate(startDate),
      end:   formatDate(endDate),
      description: `last ${n} ${unitRaw}(s)`,
    };
  }

  // "this month" / "this week" / "this year"
  const thisPattern = /\bthis\s+(month|week|year)\b/i;
  const thisMatch = text.match(thisPattern);
  if (thisMatch) {
    const unit = thisMatch[1].toLowerCase();
    const startDate = new Date(endDate);
    if (unit === 'month') startDate.setDate(1);
    else if (unit === 'week') {
      const day = startDate.getDay();
      startDate.setDate(startDate.getDate() - day);
    } else if (unit === 'year') {
      startDate.setMonth(0); startDate.setDate(1);
    }
    return { start: formatDate(startDate), end: formatDate(endDate), description: `this ${unit}` };
  }

  // "year to date" / "YTD"
  if (/\b(year[\s-]?to[\s-]?date|ytd)\b/i.test(text)) {
    const startDate = new Date(endDate.getFullYear(), 0, 1);
    return { start: formatDate(startDate), end: formatDate(endDate), description: 'year to date' };
  }

  // "quarter to date" / "QTD"
  if (/\b(quarter[\s-]?to[\s-]?date|qtd)\b/i.test(text)) {
    const q = Math.floor(endDate.getMonth() / 3);
    const startDate = new Date(endDate.getFullYear(), q * 3, 1);
    return { start: formatDate(startDate), end: formatDate(endDate), description: 'quarter to date' };
  }

  // Explicit date range: "from MM-MM-YYYY to MM-MM-YYYY" or "between ... and ..."
  const explicitRange = /(?:from|between)\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(?:to|and|-)\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i;
  const explicitMatch = text.match(explicitRange);
  if (explicitMatch) {
    return {
      start: normaliseDate(explicitMatch[1]),
      end:   normaliseDate(explicitMatch[2]),
      description: 'explicit range',
    };
  }

  // Bare date range (no "from"/"between" prefix): "MM/DD/YYYY to MM/DD/YYYY"
  const bareRange = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+to\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i;
  const bareMatch = text.match(bareRange);
  if (bareMatch) {
    return {
      start: normaliseDate(bareMatch[1]),
      end:   normaliseDate(bareMatch[2]),
      description: 'explicit range',
    };
  }

  // Compact range: "MM/DD-M/DD" (slash-dates joined by a single hyphen, no year component)
  // e.g. "02/01-3/23" means "from 02/01 to 03/23", years inferred from today
  const compactRange = /(\d{1,2}\/\d{1,2})-(\d{1,2}\/\d{1,2})(?![\d\/])/;
  const compactMatch = text.match(compactRange);
  if (compactMatch) {
    const start = parseShortDate(compactMatch[1], today);
    const end   = parseShortDate(compactMatch[2], today);
    if (start && end) {
      return { start, end, description: 'compact range' };
    }
  }

  // Single explicit month/year: "for March 2026" / "for Q1 2025"
  const monthYear = /\bfor\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(\d{4})\b/i;
  const myMatch = text.match(monthYear);
  if (myMatch) {
    const monthMap = { january:1,jan:1,february:2,feb:2,march:3,mar:3,april:4,apr:4,may:5,june:6,jun:6,july:7,jul:7,august:8,aug:8,september:9,sep:9,october:10,oct:10,november:11,nov:11,december:12,dec:12 };
    const m = monthMap[myMatch[1].toLowerCase()];
    const y = parseInt(myMatch[2]);
    const startDate = new Date(y, m - 1, 1);
    const endDateM  = new Date(y, m, 0); // last day of month
    return { start: formatDate(startDate), end: formatDate(endDateM), description: `${myMatch[1]} ${y}` };
  }

  // "after <date>" or "since <date>"  e.g. "after 2/01", "since 02/01/2026"
  const afterPattern = /\b(?:after|since)\s+(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/i;
  const afterMatch = text.match(afterPattern);
  if (afterMatch) {
    const start = parseShortDate(afterMatch[1], today);
    if (start) {
      return { start, end: formatDate(endDate), description: `after ${afterMatch[1]}` };
    }
  }

  // "before <date>"  e.g. "before 3/15", "before 03/15/2026"
  const beforePattern = /\bbefore\s+(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/i;
  const beforeMatch = text.match(beforePattern);
  if (beforeMatch) {
    const end = parseShortDate(beforeMatch[1], today);
    if (end) {
      return { start: null, end, description: `before ${beforeMatch[1]}` };
    }
  }

  return null; // no date range found
}

function formatDate(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function normaliseDate(str) {
  const parts = str.split(/[\/\-]/);
  if (parts.length !== 3) return str;
  const [m, d, y] = parts;
  const year = y.length === 2 ? '20' + y : y;
  return `${m.padStart(2,'0')}/${d.padStart(2,'0')}/${year}`;
}

/**
 * Parse a date string that may omit the year (M/D or M-D).
 * Full dates (M/D/YYYY or M/D/YY) are forwarded to normaliseDate.
 * For partial dates the year is inferred from `today`; if the result
 * would be in the future relative to today, the prior year is used.
 *
 * @param {string} str  e.g. "2/01", "2/1", "02/01/2026"
 * @param {Date} today
 * @returns {string|null}  MM/DD/YYYY or null
 */
function parseShortDate(str, today) {
  const parts = str.split(/[\/\-]/);
  if (parts.length === 3) return normaliseDate(str);
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10);
    const d = parseInt(parts[1], 10);
    if (isNaN(m) || isNaN(d)) return null;
    const year = today.getFullYear();
    const candidate = new Date(year, m - 1, d);
    const useYear = candidate > today ? year - 1 : year;
    return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${useYear}`;
  }
  return null;
}

// ---------------------------------------------
// III. RECIPIENT EXTRACTION
// ---------------------------------------------

/**
 * Common patterns that reference "send back to sender / requestor".
 * Also handles named recipients and email addresses.
 */
const SELF_PATTERNS = [
  /\bsend\s+(?:it\s+)?(?:back\s+)?to\s+me\b/i,
  /\bforward\s+(?:it\s+)?to\s+me\b/i,
  /\bback\s+to\s+me\b/i,  // "send it back to me", "forward back to me"
  /\bsend\s+me\b/i,  // "send me" without "to" - must be before more specific patterns
  /\bplease\s+send\s+me\b/i,
  /\bcan\s+you\s+(?:please\s+)?send\s+me\b/i,
  /\bi\s+(?:would|'d)\s+like\s+(?:to\s+receive|it\s+sent\s+to\s+me)\b/i,
  /\bmy\s+way\b/i,
  /\bto\s+my\s+(?:email|inbox|address)\b/i,
];

function extractRecipient(text) {
  // Check for "back to sender" / self patterns
  for (const pat of SELF_PATTERNS) {
    if (pat.test(text)) return { type: 'sender', display: 'Back to sender (requestor)' };
  }

  // "send [department] the/a/some...": "send accounting the reports", "send HR the data"
  const sendDeptMatch = text.match(/\bsend\s+(accounting|finance|hr|management|team|department|board|sales|marketing)\s+(?:the|a|an|some)\b/i);
  if (sendDeptMatch) return { type: 'department', display: `by department "${sendDeptMatch[1]}"` };

  // "send [Name] the/a/some...": "send John the reports", "send Sarah Johnson the data", "send John M. Smith the file"
  // Matches: FirstName, FirstName LastName, FirstName M. LastName, etc.
  const sendNameMatch = text.match(/\bsend\s+([A-Z][a-z]+(?:\s+(?:[A-Z]\.?\s*)?[A-Z][a-z]+)*)\s+(?:the|a|an|some)\b/);
  if (sendNameMatch) return { type: 'named', display: `by name "${sendNameMatch[1]}"` };

  // Named person: "send it to [Name]" / "forward to [Name]"
  const namedMatch = text.match(/\b(?:send|forward|email|mail|deliver)(?:\s+it)?\s+to\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/);
  if (namedMatch) return { type: 'named', display: `by name "${namedMatch[1]}"` };

  // Email address
  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) return { type: 'email', display: emailMatch[0] };

  // Generic "to [Name]": "to Sarah Johnson", "send reports to John Smith"
  const toNameMatch = text.match(/\bto\s+([A-Z][a-z]+(?:\s+(?:[A-Z]\.?\s*)?[A-Z][a-z]+)*)\b/);
  if (toNameMatch) {
    // Make sure it's not a department by checking against department list
    const name = toNameMatch[1].toLowerCase();
    const departments = ['accounting', 'finance', 'hr', 'management', 'team', 'department', 'board', 'sales', 'marketing'];
    if (!departments.includes(name)) {
      return { type: 'named', display: `by name "${toNameMatch[1]}"` };
    }
  }

  // "to [department]": "to accounting", "to the team", etc.
  const deptMatch = text.match(/\bto\s+(?:the\s+)?(accounting|finance|hr|management|team|department|board|sales|marketing)\b/i);
  if (deptMatch) return { type: 'department', display: `by department "${deptMatch[1]}"` };

  return { type: 'unknown', display: 'Recipient not identified' };
}

// ---------------------------------------------
// IV. MAP CONFIGURATION & FILE MATCHING
// ---------------------------------------------

/**
 * Load mapping configuration from JSON file.
 * Resolves relative paths to config/mapRequestedData/ directory.
 */
function loadMapConfig(mapFile, projectRoot = process.cwd()) {
  if (!mapFile) return null;
  
  try {
    let mapPath;
    
    // If absolute path, use as-is
    if (pathIsAbsolute(mapFile)) {
      mapPath = mapFile;
    } else {
      // Resolve to config/mapRequestedData/ directory
      mapPath = pathResolve(projectRoot, 'config', 'mapRequestedData', mapFile);
    }
    
    if (!existsSync(mapPath)) {
      console.error(`Map config file not found: ${mapPath}`);
      return null;
    }
    
    const content = readFileSync(mapPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`Error loading map config: ${err.message}`);
    return null;
  }
}

/**
 * Parse custom date syntax: {% date(<format>) %}
 * Returns a regex pattern that matches the date format.
 * 
 * Supported format codes:
 *   <mm> = two-digit month (03, 12)
 *   <m> = one or two digit month (3, 12)
 *   <MONTH> = full month name (March, December)
 *   <MM> = month abbreviation (Mar, Dec)
 *   <dd> = two-digit day (03, 31)
 *   <d> = one or two digit day (3, 31)
 *   <yyyy> = four-digit year (2025, 2026)
 *   <yy> = two-digit year (25, 26)
 */
function parseDateSyntax(pattern) {
  const dateMatch = pattern.match(/{%\s*date\((.*?)\)\s*%}/);
  if (!dateMatch) return pattern; // No date syntax, return as-is
  
  let dateFormat = dateMatch[1];
  const segments = [];
  let currentPos = 0;
  
  // Parse format string and convert to regex
  const formatRegex = /<([^>]+)>/g;
  let match;
  let lastIndex = 0;
  
  while ((match = formatRegex.exec(dateFormat)) !== null) {
    // Add literal text before this match
    if (match.index > lastIndex) {
      const literal = dateFormat.substring(lastIndex, match.index);
      segments.push({ type: 'literal', value: literal });
    }
    
    // Add format code
    const code = match[1];
    segments.push({ type: 'format', code });
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add any remaining literal text
  if (lastIndex < dateFormat.length) {
    segments.push({ type: 'literal', value: dateFormat.substring(lastIndex) });
  }
  
  // Convert segments to regex pattern
  let regexPattern = '';
  for (const segment of segments) {
    if (segment.type === 'literal') {
      // Escape regex special characters in literals
      regexPattern += segment.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else {
      // Convert format code to regex
      switch (segment.code) {
        case 'mm': regexPattern += '\\d{2}'; break;
        case 'm': regexPattern += '\\d{1,2}'; break;
        case 'dd': regexPattern += '\\d{2}'; break;
        case 'd': regexPattern += '\\d{1,2}'; break;
        case 'yyyy': regexPattern += '\\d{4}'; break;
        case 'yy': regexPattern += '\\d{2}'; break;
        case 'MONTH': regexPattern += '(?:January|February|March|April|May|June|July|August|September|October|November|December)'; break;
        case 'MM': regexPattern += '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)'; break;
        default: regexPattern += '.*'; // Unknown code, match anything
      }
    }
  }
  
  // Replace the date syntax with the regex pattern
  const finalPattern = pattern.replace(/{%\s*date\(.*?\)\s*%}/, regexPattern);
  return finalPattern;
}

/**
 * Extract date from filename based on date pattern segments.
 * Returns a Date object or null if no date found.
 */
function extractDateFromFilename(filename, segments) {
  // Build regex to capture date components
  let regexPattern = '';
  const captureGroups = [];
  
  for (const segment of segments) {
    if (segment.type === 'literal') {
      regexPattern += segment.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else {
      regexPattern += '(';
      switch (segment.code) {
        case 'mm':
        case 'm':
          regexPattern += '\\d{1,2}';
          captureGroups.push('month');
          break;
        case 'dd':
        case 'd':
          regexPattern += '\\d{1,2}';
          captureGroups.push('day');
          break;
        case 'yyyy':
          regexPattern += '\\d{4}';
          captureGroups.push('year4');
          break;
        case 'yy':
          regexPattern += '\\d{2}';
          captureGroups.push('year2');
          break;
        default:
          regexPattern += '.*';
          captureGroups.push('unknown');
      }
      regexPattern += ')';
    }
  }
  
  const regex = new RegExp(regexPattern);
  const match = filename.match(regex);
  
  if (!match) return null;
  
  // Extract date components
  let month = 0, day = 1, year = new Date().getFullYear();
  
  for (let i = 0; i < captureGroups.length; i++) {
    const value = match[i + 1];
    switch (captureGroups[i]) {
      case 'month':
        month = parseInt(value, 10) - 1; // JavaScript months are 0-indexed
        break;
      case 'day':
        day = parseInt(value, 10);
        break;
      case 'year4':
        year = parseInt(value, 10);
        break;
      case 'year2':
        year = 2000 + parseInt(value, 10);
        break;
    }
  }
  
  return new Date(year, month, day);
}

/**
 * Parse date pattern segments for extraction.
 */
function parseDateSegments(pattern) {
  const dateMatch = pattern.match(/{%\s*date\((.*?)\)\s*%}/);
  if (!dateMatch) return null;
  
  const dateFormat = dateMatch[1];
  const segments = [];
  const formatRegex = /<([^>]+)>/g;
  let match;
  let lastIndex = 0;
  
  while ((match = formatRegex.exec(dateFormat)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'literal', value: dateFormat.substring(lastIndex, match.index) });
    }
    segments.push({ type: 'format', code: match[1] });
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex < dateFormat.length) {
    segments.push({ type: 'literal', value: dateFormat.substring(lastIndex) });
  }
  
  return segments;
}

/**
 * Scan folder for files matching pattern within date range.
 */
function findMatchingFiles(folderPath, filePattern, dateRange) {
  if (!existsSync(folderPath)) {
    return { error: `Folder not found: ${folderPath}`, files: [] };
  }
  
  try {
    const files = readdirSync(folderPath);
    const matchingFiles = [];
    
    // Check if pattern has date syntax
    const dateSegments = parseDateSegments(filePattern);
    const hasDateSyntax = dateSegments !== null;
    
    // Convert pattern to regex
    const regexPattern = parseDateSyntax(filePattern);
    const regex = new RegExp(regexPattern);
    
    for (const file of files) {
      const filePath = pathJoin(folderPath, file);
      const stats = statSync(filePath);
      
      // Skip directories
      if (stats.isDirectory()) continue;
      
      // Check if filename matches pattern
      if (!regex.test(file)) continue;
      
      // If date range specified and pattern has date syntax, filter by date
      if (dateRange && hasDateSyntax) {
        const fileDate = extractDateFromFilename(file, dateSegments);
        if (!fileDate) continue;
        
        const startDate = new Date(dateRange.start);
        const endDate = new Date(dateRange.end);
        
        if (fileDate < startDate || fileDate > endDate) continue;
      }
      
      matchingFiles.push(file);
    }
    
    return { files: matchingFiles, folder: folderPath };
  } catch (err) {
    return { error: `Error scanning folder: ${err.message}`, files: [] };
  }
}

/**
 * Resolve document type to folder/file from map config.
 */
function resolveDocument(documentType, mapConfig) {
  if (!mapConfig || !mapConfig.documents) return null;
  
  for (const doc of mapConfig.documents) {
    // Check if document name matches (indexOf match)
    if (doc.name === '*' || (documentType && documentType.toLowerCase().includes(doc.name.toLowerCase()))) {
      return {
        name: doc.name,
        folder: doc.folder || null,
        file: doc.file || null
      };
    }
  }
  
  return null;
}

/**
 * Resolve recipient with %requestor% syntax and task MAP_REQUEST_DATA.
 */
function resolveRecipient(recipient, mapConfig, taskMapData) {
  if (!mapConfig || !mapConfig.recipients) return recipient;
  
  for (const configRecipient of mapConfig.recipients) {
    // Check for %requestor% special syntax
    if (configRecipient.name === '%requestor%') {
      // If task has MAP_REQUEST_DATA with resolve: true, use those values
      if (taskMapData && taskMapData.resolve) {
        return {
          ...recipient,
          email: taskMapData.email || recipient.email,
          file: taskMapData.file || configRecipient.file,
          resolved: true
        };
      }
      
      // Otherwise use config recipient data
      return {
        ...recipient,
        email: configRecipient.email || recipient.email,
        file: configRecipient.file,
        resolved: true
      };
    }
    
    // Check if recipient matches by name, department, or type
    const recipientName = recipient.display.toLowerCase();
    const configName = configRecipient.name.toLowerCase();
    
    if (recipientName.includes(configName) || configName.includes(recipientName)) {
      return {
        ...recipient,
        email: configRecipient.email || recipient.email,
        file: configRecipient.file,
        resolved: true
      };
    }
  }
  
  return recipient;
}

// ---------------------------------------------
// MASTER PARSER
// ---------------------------------------------

/**
 * parseEmailTask(messageText, referenceDate?, options?)
 *
 * Returns an object:
 * {
 *   raw,           // original message
 *   documentType,  // canonical document name or null
 *   dateRange,     // { start, end, description } or null
 *   recipient,     // { type, display, email?, file? }
 *   document,      // { folder, file } resolved from map (if map provided)
 *   matchedFiles,  // array of matched files (if folder + file pattern provided)
 *   summary,       // human-readable summary string
 * }
 * 
 * Options:
 *   - mapConfig: mapping configuration object or path to config file
 *   - taskMapData: MAP_REQUEST_DATA from task (for %requestor% resolution)
 *   - projectRoot: project root directory for resolving relative paths
 */
function parseEmailTask(messageText, referenceDate = new Date(), options = {}) {
  // Pre-process: chain-aware narrowing (combines dominant-type segments into one body)
  const processedText = classifyAndNarrowChain(messageText);

  const documentType = detectDocumentType(processedText);
  const dateRange    = extractDateRange(processedText, referenceDate);
  let recipient      = extractRecipient(processedText);

  // Load map config if provided
  let mapConfig = options.mapConfig;
  if (typeof mapConfig === 'string') {
    mapConfig = loadMapConfig(mapConfig, options.projectRoot);
  }

  // Resolve document to folder/file
  let resolvedDocument = null;
  if (mapConfig) {
    resolvedDocument = resolveDocument(documentType, mapConfig);
  }

  // Resolve recipient with map and task data
  if (mapConfig) {
    recipient = resolveRecipient(recipient, mapConfig, options.taskMapData);
  }

  // Find matching files if we have folder + file pattern + date range
  let matchedFiles = null;
  if (resolvedDocument && resolvedDocument.folder) {
    const filePattern = recipient.file || resolvedDocument.file;
    if (filePattern && dateRange) {
      matchedFiles = findMatchingFiles(resolvedDocument.folder, filePattern, dateRange);
    }
  }

  // Build summary
  let summary = '';
  
  // Document summary
  if (resolvedDocument && resolvedDocument.folder) {
    summary += `?? Document: "${resolvedDocument.folder}"\n`;
  } else if (documentType) {
    summary += `?? Document: ${documentType}\n`;
  } else {
    summary += `?? Document: ??  Could not determine document type\n`;
  }

  // Date range summary
  if (dateRange) {
    summary += `?? Date Range: ${dateRange.start} to ${dateRange.end}  (${dateRange.description})\n`;
  } else {
    summary += `?? Date Range: ??  No date range detected\n`;
  }

  // Recipient summary
  if (recipient.email) {
    summary += `?? Recipient: "${recipient.email}"`;
  } else {
    summary += `?? Recipient: ${recipient.display}`;
  }

  // Add matched files to summary
  if (matchedFiles && matchedFiles.files && matchedFiles.files.length > 0) {
    summary += `\n++ FILES MATCHING:\n`;
    for (const file of matchedFiles.files) {
      summary += `   ${file}\n`;
    }
  } else if (matchedFiles && matchedFiles.error) {
    summary += `\n++ ERROR: ${matchedFiles.error}\n`;
  }

  return {
    raw: messageText,
    documentType,
    dateRange,
    recipient,
    document: resolvedDocument,
    matchedFiles,
    summary: summary.trimEnd()
  };
}

// ---------------------------------------------
// DEMO - run with: 
//   node narrowRequestedData.js "your message here"
//   node narrowRequestedData.js -f filename.txt
//   node narrowRequestedData.js --file filename.txt
//   node narrowRequestedData.js -m example.json "message"
//   node narrowRequestedData.js --demo-map
// ---------------------------------------------

// ES Module main check - use imports from top of file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Check if this file is being run directly
const isMain = process.argv[1] === __filename || process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const TODAY = new Date();
  
  // Parse command-line arguments
  const args = process.argv.slice(2);
  let userMessage = null;
  let isFileMode = false;
  let mapConfigFile = null;
  let isDemoMap = false;
  
  // Parse arguments
  let i = 0;
  while (i < args.length) {
    if (args[i] === '-f' || args[i] === '--file') {
      isFileMode = true;
      const fileName = args[i + 1];
      const filePath = isAbsolute(fileName) ? fileName : resolve(process.cwd(), fileName);
      try {
        userMessage = readFileSync(filePath, 'utf-8').trim();
      } catch (err) {
        console.error(`Error reading file "${fileName}":`, err.message);
        process.exit(1);
      }
      i += 2;
    } else if (args[i] === '-m' || args[i] === '--map') {
      mapConfigFile = args[i + 1];
      i += 2;
    } else if (args[i] === '--demo-map') {
      isDemoMap = true;
      i += 1;
    } else {
      // Direct message mode
      userMessage = args[i];
      i += 1;
    }
  }
  
  if (userMessage) {
    // Single message mode: parse the provided message and log result
    const projectRoot = resolve(__dirname, '..'); // Project root is parent of helpers/
    const options = mapConfigFile ? { mapConfig: mapConfigFile, projectRoot: projectRoot } : {};
    const result = parseEmailTask(userMessage, TODAY, options);
    console.log('='.repeat(65));
    const modeLabel = isFileMode ? 'File Input Mode' : 'Single Message Mode';
    console.log(`  EMAIL TASK PARSER - ${modeLabel}`);
    console.log(`  Reference Date: ${TODAY.toDateString()}`);
    if (mapConfigFile) console.log(`  Map Config: ${mapConfigFile}`);
    console.log('='.repeat(65));
    console.log('\nINPUT :', result.raw);
    console.log('RESULT:');
    console.log(result.summary);
    console.log('-'.repeat(65));
  } else if (isDemoMap) {
    // Demo with mapping - shows full integration example using generic template
    console.log('='.repeat(65));
    console.log('  EMAIL TASK PARSER - Demo with Map Integration');
    console.log(`  Reference Date: ${TODAY.toDateString()}`);
    console.log('='.repeat(65));
    
    const demoMessage = 'Can you please send me the invoice reports from the last three months?';
    
    // Example task MAP_REQUEST_DATA (generic example)
    const taskMapData = {
      resolve: true,
      email: 'recipient@example.com',
      file: 'Invoice-{% date(<yyyy>-<mm>-<dd>) %}.pdf'
    };
    
    const options = {
      mapConfig: 'example.json.template',
      taskMapData: taskMapData,
      projectRoot: resolve(__dirname, '..')
    };
    
    const result = parseEmailTask(demoMessage, TODAY, options);
    
    console.log('\n** Demonstrating Full Integration **');
    console.log('Task Configuration: mapRequestedData: "example.json.template"');
    console.log('Map Location: config/mapRequestedData/example.json.template');
    console.log('Task MAP_REQUEST_DATA: { resolve: true, email: "recipient@example.com", file: "..." }');
    console.log('\nINPUT :', result.raw);
    console.log('\nRESULT:');
    console.log(result.summary);
    console.log('-'.repeat(65));
    console.log('\nNOTE: This demo uses example.json.template with generic paths.');
    console.log('Real tasks specify their own map file via: mapRequestedData: "yourMap.json"');
  } else {
    // Demo mode: run all test messages
    const testMessages = [
      // Primary example
      'Script Output: Good morning, can you send me the reports for john from the last three months?',

      // Variations
      'Can you forward the sales reports for the past 2 weeks to accounting?',
      'Please email the financial report for the last 3 years to john.doe@example.com',
      'Send me the Harvest Reports from the last 6 months',
      'I would like to receive the payroll data year to date',
      'Can you send the invoices from 01-01-2026 to 03-12-2026 to the finance team?',
      'Forward the feul reprot for the last twelve months back to me',   // typo + word-number
      'Please send me the budgit summaries for this quarter',             // typo
      'Send the anual report for March 2025 to Sarah Johnson',
      'Could you deliver the safety records for the last tow months to HR?', // tow = 2
    ];

    console.log('='.repeat(65));
    console.log('  EMAIL TASK PARSER - Demo Run');
    console.log(`  Reference Date: ${TODAY.toDateString()}`);
    console.log('='.repeat(65));
    console.log('\nUsage:');
    console.log('  node narrowRequestedData.js "message"');
    console.log('  node narrowRequestedData.js -f file.txt');
    console.log('  node narrowRequestedData.js -m yourMap.json "message"');
    console.log('  node narrowRequestedData.js --demo-map  (shows map integration with example template)');
    console.log('='.repeat(65));

    for (const msg of testMessages) {
      const result = parseEmailTask(msg, TODAY);
      console.log('\nINPUT :', result.raw);
      console.log('RESULT:');
      console.log(result.summary);
      console.log('-'.repeat(65));
    }
  }
}

// Export for use as a module (ES Module syntax)
export {
  parseEmailTask,
  detectDocumentType,
  extractDateRange,
  extractRecipient,
  wordsToDigits,
  loadMapConfig,
  parseDateSyntax,
  findMatchingFiles,
  resolveDocument,
  resolveRecipient
};
