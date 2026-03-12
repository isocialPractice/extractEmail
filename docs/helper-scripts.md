# Helper Scripts Guide

Helper scripts provide shared functionality for tasks and the main application.

## Overview

Helper scripts are located in the `helpers/` directory and provide:
- Date value resolution for filter templates
- Filter pattern evaluation
- Natural language parsing for document requests

## Available Helpers

### dateHelper.mjs

Provides date values for `{{ dates.* }}` template placeholders.

**Location:** `helpers/dateHelper.mjs`

#### Usage

```javascript
import { getDateValues } from './helpers/dateHelper.mjs';

const dates = getDateValues();
console.log(dates.year);       // "2026"
console.log(dates.month);      // "March"
console.log(dates.lastMonth);  // "February"
```

#### Available Date Values

| Property | Description | Example |
|----------|-------------|---------|
| `year` | Current four-digit year | `"2026"` |
| `lastYear` | Previous year | `"2025"` |
| `nextYear` | Next year | `"2027"` |
| `month` | Current full month name | `"March"` |
| `lastMonth` | Previous month name | `"February"` |
| `month.abbr` | Current month abbreviation | `"Mar"` |
| `lastMonth.abbr` | Previous month abbreviation | `"Feb"` |
| `day` | Current two-digit day | `"12"` |
| `quarter` | Current quarter (1-4) | `"1"` |
| `lastQuarter` | Previous quarter | `"4"` |
| `year.short` | Two-digit year | `"26"` |

#### In Filter Patterns

```javascript
const FILTER_CONFIG = {
  subjectPattern: "{{ dates.month }} {{ dates.year }}",  // "March 2026"
  fromPattern: "{{ dates.lastMonth }} Report"           // "February Report"
};
```

---

### filterHelper.mjs

Provides template-aware filter pattern evaluation.

**Location:** `helpers/filterHelper.mjs`

#### Functions

##### resolveFilterPattern(pattern)

Resolves `{{ }}` template syntax in filter patterns.

```javascript
import { resolveFilterPattern } from './helpers/filterHelper.mjs';

// Date placeholder
const resolved = resolveFilterPattern("{{ dates.year }}");
// Returns object that matches "2026"

// Regex pattern
const regexResolved = resolveFilterPattern("{{ Invoice #[0-9]+ }}");
// Returns regex-enabled object

// Plain string (unchanged)
const plain = resolveFilterPattern("Invoice");
// Returns object for substring matching
```

##### testPattern(pattern, text)

Tests if text matches a resolved pattern.

```javascript
import { testPattern, resolveFilterPattern } from './helpers/filterHelper.mjs';

const pattern = resolveFilterPattern("{{ dates.month }}");
const matches = testPattern(pattern, "March Report");  // true
```

#### Pattern Types

**Plain String:**
```javascript
// Case-insensitive substring match
fromPattern: "example.com"
// Matches: "user@example.com", "EXAMPLE.COM", etc.
```

**Regular Expression:**
```javascript
// Wrap in {{ }} for regex
fromPattern: "{{ .*@example\\.com }}"
// Matches: any email ending with @example.com
```

**Date Placeholder:**
```javascript
// Auto-resolved to current date value
subjectPattern: "{{ dates.year }}"
// Matches: "2026" (current year)
```

**Mixed Patterns:**
```javascript
// Combine literal text with templates
subjectPattern: "Report - {{ dates.month }} {{ dates.year }}"
// Matches: "Report - March 2026"
```

---

### narrowRequestedData.js

Parses natural language email messages to extract document requests.

**Location:** `helpers/narrowRequestedData.js`

#### Command Line Usage

```bash
# Parse a message
node helpers/narrowRequestedData.js "send me reports for last 3 months"

# Parse from file
node helpers/narrowRequestedData.js -f message.txt

# With mapping configuration
node helpers/narrowRequestedData.js -m Reports.json "send me reports"

# Demo mode
node helpers/narrowRequestedData.js --demo-map
```

#### Programmatic Usage

```javascript
import { parseEmailTask, loadMapConfig } from './helpers/narrowRequestedData.js';

// Basic parsing
const result = parseEmailTask("send me invoices for last month");

console.log(result.documentType);  // "invoice"
console.log(result.dateRange);     // { start: Date, end: Date }
console.log(result.recipient);     // "requestor"

// With mapping
const mapConfig = loadMapConfig('Invoices.json');
const resultWithMap = parseEmailTask(
  "send me invoices",
  new Date(),
  { mapConfig, projectRoot: process.cwd() }
);

console.log(resultWithMap.matchedFiles);  // Array of matching files
```

#### Parsing Capabilities

**Document Types:**
- Recognizes: report, invoice, statement, receipt, document, file
- Uses indexOf matching for variations

**Date Ranges:**
- Relative: "last month", "last 3 months", "this year"
- Specific: "from January to March", "01/01/2026 to 03/01/2026"

**Recipients:**
- Explicit: "send to accounting", "forward to John Smith"
- Implicit: "send me" → requestor (original sender)

#### Output Format

```javascript
{
  documentType: "report",
  dateRange: {
    start: Date,
    end: Date,
    description: "last 4 months"
  },
  recipient: {
    type: "requestor" | "named",
    name: "John Smith",
    email: "john@example.com"
  },
  matchedFiles: ["file1.pdf", "file2.pdf"],
  folder: "C:\\Documents\\Reports"
}
```

---

## Creating Custom Helpers

### Step 1: Create Helper File

```javascript
// helpers/myHelper.mjs

/**
 * Custom helper function
 * @param {string} input - Input to process
 * @returns {string} Processed output
 */
export function processInput(input) {
  // Your logic here
  return input.toUpperCase();
}

/**
 * Another helper
 */
export function formatOutput(data) {
  return JSON.stringify(data, null, 2);
}
```

### Step 2: Use in Tasks

```javascript
// extractEmailTasks/myTask.js
import { processInput, formatOutput } from '../helpers/myHelper.mjs';

export default async function myTask(headersPart, subject, body) {
  const processed = processInput(subject);
  console.log(formatOutput({ subject: processed }));
}
```

### Step 3: Use in Main Script

```javascript
// In extractEmail.mjs or other modules
import { processInput } from './helpers/myHelper.mjs';
```

---

## Helper Best Practices

1. **Export named functions** - Easier to import selectively
2. **Use JSDoc comments** - Document parameters and return types
3. **Handle edge cases** - Check for null/undefined inputs
4. **Keep helpers focused** - One responsibility per function
5. **Use .mjs extension** - Enables ES module syntax
6. **Test independently** - Helpers should work in isolation

---

## Integration Examples

### Using dateHelper in Filters

```javascript
// extractEmailTasks/monthlyReport.js
import { getDateValues } from '../helpers/dateHelper.mjs';

const dates = getDateValues();

const FILTER_CONFIG = {
  subjectPattern: `Monthly Report - ${dates.month}`,
  requireAttachments: true
};
```

### Using filterHelper in Custom Task

```javascript
// extractEmailTasks/customFilter.js
import { resolveFilterPattern, testPattern } from '../helpers/filterHelper.mjs';

export default async function customFilter(headersPart, subject, body) {
  const pattern = resolveFilterPattern("{{ dates.year }}");
  
  if (testPattern(pattern, subject)) {
    console.log(`Email matches current year: ${subject}`);
  }
}
```

### Using narrowRequestedData in Script

```javascript
// extractEmailTasks/processRequest.js
import { parseEmailTask, loadMapConfig } from '../helpers/narrowRequestedData.js';

export default async function processRequest(headersPart, subject, body) {
  const mapConfig = loadMapConfig('Documents.json');
  
  const parsed = parseEmailTask(body, new Date(), {
    mapConfig,
    projectRoot: process.cwd()
  });
  
  if (parsed.matchedFiles.length > 0) {
    console.log(`Found ${parsed.matchedFiles.length} matching files`);
    parsed.matchedFiles.forEach(file => console.log(`  - ${file}`));
  }
}
```
