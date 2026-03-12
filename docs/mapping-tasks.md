<!-- {% raw %} -->
# Mapping Tasks Guide

Mapping configuration enables intelligent document resolution, recipient management, and file pattern matching based on email content.

## Overview

The mapping system parses natural language email messages to extract:
- **Document types** (reports, invoices, statements, etc.)
- **Date ranges** (last month, last 3 months, specific dates)
- **Recipients** (who should receive the response)

With mapping configuration, these can be resolved to specific folders, file patterns, and automatically matched files.

## Basic Usage

### Command Line

```bash
# Parse a message directly
node helpers/narrowRequestedData.js "send me reports for last 3 months"

# Parse from file
node helpers/narrowRequestedData.js -f message.txt

# With mapping configuration
node helpers/narrowRequestedData.js -m Reports.json "send me reports"

# Demo with full mapping integration
node helpers/narrowRequestedData.js --demo-map
```

### In Tasks

Configure mapping in your task file:

```javascript
const FILTER_CONFIG = {
  mapRequestedData: "Reports.json",  // Mapping configuration file
  fromPattern: "reports@example.com",
  bodyPattern: "send me"
};
```

---

## Mapping Configuration Files

### Location

Map configuration files are stored in `config/mapRequestedData/` directory.

```bash
# Relative path (recommended)
Reports.json → config/mapRequestedData/Reports.json

# Absolute path also supported
/full/path/to/config.json
```

### Basic Structure

```json
{
  "description": "Human-readable description of this mapping",
  "mapTo": "scriptName.bat",
  "documents": [
    {
      "name": "report",
      "folder": "C:\\Path\\To\\Documents",
      "file": "Report-.*\\.pdf"
    }
  ],
  "recipients": [
    {
      "name": "%requestor%",
      "email": "optional@example.com"
    }
  ]
}
```

---

## Configuration Fields

### description

Human-readable description of the mapping's purpose.

```json
{
  "description": "Monthly billing report mapping for Acme Corp"
}
```

### mapTo

Maps this configuration to a specific script name.

```json
{
  "mapTo": "processReports.bat"
}
```

When a script runs, it can automatically use this map configuration.

### documents

Array of document type mappings.

```json
{
  "documents": [
    {
      "name": "report",
      "folder": "C:\\Documents\\Reports",
      "file": "Report-{% date(<mm>-<dd>-<yyyy>) %}.pdf"
    },
    {
      "name": "invoice",
      "folder": "C:\\Documents\\Invoices",
      "file": "Invoice-.*\\.pdf"
    }
  ]
}
```

**Fields:**

| Field | Description |
|-------|-------------|
| `name` | Document type identifier (uses indexOf matching) |
| `folder` | Path to folder containing documents |
| `file` | File naming pattern (supports regex and date syntax) |

**Name Matching:**
- `"report"` matches: "report", "sales report", "monthly report"
- `"invoice"` matches: "invoice", "vendor invoice"

### recipients

Array of recipient mappings.

```json
{
  "recipients": [
    {
      "name": "%requestor%",
      "comment": "Original email sender"
    },
    {
      "name": "accounting",
      "email": "accounting@example.com",
      "file": "AccountingReport-.*\\.pdf"
    },
    {
      "name": "John Smith",
      "email": "john.smith@example.com"
    }
  ]
}
```

**Fields:**

| Field | Description |
|-------|-------------|
| `name` | Recipient identifier or `%requestor%` |
| `email` | Email address (optional for `%requestor%`) |
| `file` | Specific file pattern for this recipient (optional) |

---

## The %requestor% Placeholder

When a recipient's `name` is `%requestor%`, it represents the original email sender.

### Basic Usage

```json
{
  "recipients": [
    {
      "name": "%requestor%",
      "comment": "Resolves to original sender"
    }
  ]
}
```

### With Default Values

```json
{
  "recipients": [
    {
      "name": "%requestor%",
      "email": "default@example.com",
      "file": "Report-.*\\.pdf"
    }
  ]
}
```

### Task Override

Override via `MAP_REQUEST_DATA` in your task:

```javascript
const MAP_REQUEST_DATA = {
  resolve: true,  // Enable resolution
  email: "jane.doe@example.com",
  file: "Billing Statement - {% date(<mm>-<dd>-<yy>) %}"
};
```

Task values take precedence when `resolve: true`.

---

## Date Syntax

File patterns support custom date syntax for matching date-based filenames.

### Syntax Format

```
{% date(<format>) %}
```

### Format Codes

| Code | Description | Example |
|------|-------------|---------|
| `<mm>` | Two-digit month | `03`, `12` |
| `<m>` | One/two digit month | `3`, `12` |
| `<MONTH>` | Full month name | `March`, `December` |
| `<MM>` | Month abbreviation | `Mar`, `Dec` |
| `<dd>` | Two-digit day | `03`, `31` |
| `<d>` | One/two digit day | `3`, `31` |
| `<yyyy>` | Four-digit year | `2025`, `2026` |
| `<yy>` | Two-digit year | `25`, `26` |

### Examples

```javascript
// Match: Invoice-01-15-2026.pdf
"Invoice-{% date(<mm>-<dd>-<yyyy>) %}.pdf"

// Match: Report-3-5-26.pdf
"Report-{% date(<m>-<d>-<yy>) %}.pdf"

// Match: Statement-March-2026.pdf
"Statement-{% date(<MONTH>-<yyyy>) %}.pdf"

// Match: Log-Mar-03-2026.txt
"Log-{% date(<MM>-<dd>-<yyyy>) %}.txt"
```

---

## Date Range Filtering

When a file pattern includes date syntax and a date range is detected in the message, the system automatically:

1. Parses the date syntax into a regex pattern
2. Scans the folder for matching files
3. Extracts dates from filenames
4. Filters files to those within the date range
5. Returns matching files

### Example

**Message:** "send me reports for last 4 months"

**Date Range:** 11/11/2025 to 03/11/2026

**Pattern:** `Billing Statement - {% date(<mm>-<dd>-<yy>) %}.pdf`

**Matching Files:**
- `Billing Statement - 11-17-25.pdf` ✓
- `Billing Statement - 12-01-25.pdf` ✓
- `Billing Statement - 01-15-26.pdf` ✓
- `Billing Statement - 09-30-25.pdf` ✗ (outside range)

---

## Task Integration

### Step 1: Configure FILTER_CONFIG

```javascript
const FILTER_CONFIG = {
  mapRequestedData: "Reports.json",
  fromPattern: "sender@example.com",
  bodyPattern: "specific text"
};
```

### Step 2: Configure MAP_REQUEST_DATA (Optional)

```javascript
const MAP_REQUEST_DATA = {
  resolve: true,
  email: "recipient@example.com",
  file: "Document-{% date(<mm>-<dd>-<yyyy>) %}.pdf"
};
```

### Step 3: Configure SCRIPT_CONFIG

Pass mapping configuration to your script:

```javascript
const SCRIPT_CONFIG = {
  scriptPath: "scripts/processReports.bat",
  scriptArgs: [
    "{body}",       // Email body text
    "{mapConfig}"   // Mapping configuration name
  ]
};
```

### Step 4: Use -m Flag in Script

Your script receives the map config and uses it:

**Windows Batch:**
```batch
@echo off
set "_emailBody=%~1"
set "_mapConfig=%~2"

echo "%_emailBody%" | sed "s/\\\\n/\n/g" > "%TEMP%\message.txt"

if "%_mapConfig%"=="" (
  node helpers\narrowRequestedData.js -f "%TEMP%\message.txt"
) else (
  node helpers\narrowRequestedData.js -m "%_mapConfig%" -f "%TEMP%\message.txt"
)
```

**Bash:**
```bash
#!/bin/bash
emailBody="$1"
mapConfig="$2"

echo "$emailBody" | sed 's/\\n/\n/g' > "/tmp/message.txt"

if [ -z "$mapConfig" ]; then
  node helpers/narrowRequestedData.js -f "/tmp/message.txt"
else
  node helpers/narrowRequestedData.js -m "$mapConfig" -f "/tmp/message.txt"
fi
```

---

## Complete Example

### Configuration File

**File:** `config/mapRequestedData/Billing.json`

```json
{
  "description": "Acme Corp billing report mapping",
  "mapTo": "sendBillingReport.bat",
  "documents": [
    {
      "name": "statement",
      "folder": "C:\\Documents\\Billing\\Statements",
      "file": "Statement-{% date(<mm>-<dd>-<yy>) %}.pdf"
    },
    {
      "name": "invoice",
      "folder": "C:\\Documents\\Billing\\Invoices",
      "file": "Invoice-{% date(<yyyy>-<mm>) %}.pdf"
    }
  ],
  "recipients": [
    {
      "name": "%requestor%"
    },
    {
      "name": "accounting",
      "email": "accounting@example.com"
    }
  ]
}
```

### Task Configuration

**File:** `extractEmailTasks/verbose.js`

```javascript
const FILTER_CONFIG = {
  mapRequestedData: "Billing.json",
  fromPattern: "requests@example.com",
  bodyPattern: "send me"
};

const MAP_REQUEST_DATA = {
  resolve: true,
  email: "jane.doe@example.com",
  file: "Statement-{% date(<mm>-<dd>-<yy>) %}.pdf"
};

const taskDoes = "run-script";

const SCRIPT_CONFIG = {
  scriptPath: "scripts/sendBillingReport.bat",
  scriptArgs: ["{body}", "{mapConfig}"]
};
```

### Email Message

```
Good morning, can you please send me the statements 
from the last four months?
```

### Processing Flow

1. **Task filter matches email** (from pattern + body pattern)
2. **Helper parses message:**
   - Document: "statement"
   - Date range: 11/11/2025 to 03/11/2026
   - Recipient: "Back to sender (requestor)"
3. **Map resolution:**
   - "statement" → Statements folder
   - "%requestor%" → jane.doe@example.com (from MAP_REQUEST_DATA)
4. **File scanning:**
   - Pattern converted to regex
   - Folder scanned for matches
   - Files filtered by date range
5. **Script receives:**
   - Document folder path
   - Recipient email
   - List of matching files

---

## Output Formats

### Without Mapping

```
?? Document: report
?? Date Range: 11/11/2025 to 03/11/2026  (last 4 months(s))
?? Recipient: Back to sender (requestor)
```

### With Mapping & File Matching

```
?? Document: "C:\Documents\Billing\Statements"
?? Date Range: 11/11/2025 to 03/11/2026  (last 4 months(s))
?? Recipient: "jane.doe@example.com"
++ FILES MATCHING:
   Statement-11-17-25.pdf
   Statement-12-01-25.pdf
   Statement-01-15-26.pdf
```

---

## Programmatic Usage

```javascript
import { parseEmailTask, loadMapConfig } from './helpers/narrowRequestedData.js';

// Basic usage
const result1 = parseEmailTask("send me reports for last month");

// With mapping
const mapConfig = loadMapConfig('Reports.json');
const taskMapData = {
  resolve: true,
  email: 'recipient@example.com',
  file: 'Report-{% date(<mm>-<dd>-<yyyy>) %}.pdf'
};

const result2 = parseEmailTask(
  "send me reports for last month",
  new Date('2026-03-12'),
  { mapConfig, taskMapData, projectRoot: process.cwd() }
);

console.log(result2.matchedFiles);
```

---

## Best Practices

1. **Use indexOf matching** for document names to catch variations
   - `"report"` matches "report", "sales report", "expense report"

2. **Test date patterns** before deploying
   - Run `--demo-map` to see file matching in action

3. **Keep folder paths absolute** for clarity and reliability

4. **Use %requestor%** when sender should receive the response

5. **Define MAP_REQUEST_DATA** when you need task-specific file patterns

6. **Use regex patterns** for flexible file matching:
   - `.*` = any characters
   - `Report-\\d{4}\\.pdf` = Report-NNNN.pdf

7. **Cross-platform paths**: Node's `path` module handles differences automatically

---

## Troubleshooting

### Files Not Matching

- Check folder path exists and is accessible
- Verify file pattern regex is correct
- Ensure date syntax matches actual filename format
- Check date range includes file dates

### Map Not Loading

- Verify file is in `config/mapRequestedData/`
- Check JSON syntax is valid
- Ensure file extension is `.json`

### %requestor% Not Resolving

- Verify `resolve: true` in MAP_REQUEST_DATA
- Check map recipient name is exactly `"%requestor%"`
- Ensure email/file defined in task or map

### Date Syntax Not Parsing

- Verify syntax: `{% date(<format>) %}`
- Check format codes are valid
- Ensure no spaces in format string
<!-- {% endraw %} -->