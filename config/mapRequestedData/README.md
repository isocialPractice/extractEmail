# narrowRequestedData.js - Mapping Configuration Guide

## Overview

The `narrowRequestedData.js` helper parses natural language email messages to extract document types, date ranges, and recipients. With mapping configuration, it can resolve these to specific folders, file patterns, and automatically find matching files based on date ranges.

## Basic Usage

```bash
# Parse a message
node helpers/narrowRequestedData.js "send me reports for last 3 months"

# Parse from file
node helpers/narrowRequestedData.js -f message.txt

# With mapping configuration
node helpers/narrowRequestedData.js -m Reports.json "send me reports"

# Demo with full mapping integration
node helpers/narrowRequestedData.js --demo-map
```

##Mapping Configuration

### Configuration File Location

Map configuration files are stored in `config/mapRequestedData/` directory.

- **Relative paths**: `Reports.json` → resolves to `config/mapRequestedData/Reports.json`
- **Absolute paths**: Can specify full path if needed

### Configuration Structure

```json
{
  "description": "Human-readable description of this mapping",
  "mapTo": "scriptName.bat",
  "documents": [
    {
      "name": "report",
      "folder": "C:\\Path\\To\\Documents",
      "file": "Optional-File-Pattern-.*\\.pdf"
    }
  ],
  "recipients": [
    {
      "name": "%requestor%",
      "email": "optional@example.com",
      "file": "Optional-File-Pattern"
    }
  ]
}
```

### Configuration Fields

#### `mapTo` (optional)
Maps this configuration to a specific script name. When the script runs, it will use this map automatically.

#### `documents` (array)
Maps document types to folders and file patterns.

**Fields:**
- `name`: Document type name (uses indexOf matching)
  - Example: `"report"` matches "report", "sales report", etc.
- `folder`: Path to folder containing documents (supports regex patterns)
- `file`: File naming pattern (supports regex and custom date syntax)

**Example:**
```json
{
  "name": "report",
  "folder": "C:\\Documents\\Reports",
  "file": "Report-{% date(<mm>-<dd>-<yyyy>) %}.pdf"
}
```

#### `recipients` (array)
Maps recipient types to email addresses and file patterns.

**Fields:**
- `name`: Recipient identifier
  - `"%requestor%"`: Special syntax for original email sender
  - Department names: `"accounting"`, `"finance"`, `"hr"`, etc.
  - Person names: `"John Smith"`, `"Sarah Johnson"`, etc.
- `email`: Email address (optional when using `%requestor%`)
- `file`: File pattern for this recipient (optional)

**Example:**
```json
{
  "name": "%requestor%",
  "comment": "Resolves to original sender. Email/file can come from task MAP_REQUEST_DATA"
}
```

### Special Syntax: %requestor%

When a recipient's `name` is `%requestor%`, it represents the original email sender. The actual email and file pattern can be defined in two ways:

1. **In the map configuration:**
   ```json
   {
     "name": "%requestor%",
     "email": "default@example.com",
     "file": "Reports-.*\\.pdf"
   }
   ```

2. **In the task MAP_REQUEST_DATA** (with `resolve: true`):
   ```javascript
   const MAP_REQUEST_DATA = {
     resolve: true,
     email: "name@example.com",
     file: "Billing Statement - {% date(<mm>-<dd>-<yy>) %}"
   };
   ```

   Task MAP_REQUEST_DATA takes precedence when `resolve: true`.

## Custom Date Syntax

File patterns can include custom date syntax for matching date-based filenames within a date range.

### Syntax

```
{% date(<format>) %}
```

### Format Codes

| Code | Description | Example |
|------|-------------|---------|
| `<mm>` | Two-digit month | `03`, `12` |
| `<m>` | One or two digit month | `3`, `12` |
| `<MONTH>` | Full month name | `March`, `December` |
| `<MM>` | Month abbreviation | `Mar`, `Dec` |
| `<dd>` | Two-digit day | `03`, `31` |
| `<d>` | One or two digit day | `3`, `31` |
| `<yyyy>` | Four-digit year | `2025`, `2026` |
| `<yy>` | Two-digit year | `25`, `26` |

### Examples

```javascript
// Match: Invoice-01-15-2026.pdf, Invoice-12-31-2025.pdf
"Invoice-{% date(<mm>-<dd>-<yyyy>) %}.pdf"

// Match: Report-3-5-26.pdf, Report-12-15-26.pdf
"Report-{% date(<m>-<d>-<yy>) %}.pdf"

// Match: Statement-March-2026.pdf, Statement-December-2025.pdf
"Statement-{% date(<MONTH>-<yyyy>) %}.pdf"
```

### Date Range Filtering

When a file pattern includes date syntax and a date range is detected in the message, the helper automatically:

1. Parses the date syntax into a regex pattern
2. Scans the folder for matching files
3. Extracts dates from filenames
4. Filters files to those within the date range
5. Returns matching files

**Example:**

Message: "send me reports for last 4 months" (range: 11/11/2025 to 03/11/2026)

Pattern: `Billing Statement - {% date(<mm>-<dd>-<yy>) %}.pdf`

Matches:
- `Billing Statement - 11-17-25.pdf` ✓
- `Billing Statement - 12-01-25.pdf` ✓
- `Billing Statement - 01-15-26.pdf` ✓
- `Billing Statement - 09-30-25.pdf` ✗ (outside range)

## Task Integration

### Step 1: Configure FILTER_CONFIG

In task files (e.g., `verbose.js`), specify the map configuration:

```javascript
const FILTER_CONFIG = {
  mapRequestedData: "Reports.json",  // Resolves to config/mapRequestedData/Reports.json
  fromPattern: "sender@example.com",
  bodyPattern: "specific text"
};
```

### Step 2: Pass to Script via SCRIPT_CONFIG

Add `{mapConfig}` to your script arguments to pass the mapping configuration:

```javascript
const SCRIPT_CONFIG = {
  scriptPath: "scripts/processReports.bat",
  scriptArgs: [
    "{body}",      // Email body text
    "{mapConfig}"  // REQUIRED: Maps to FILTER_CONFIG.mapRequestedData
  ]
};
```

### Step 3: Use -m Flag in Script

Your script receives the map config and must use the `-m` flag when calling narrowRequestedData.js:

**Batch (Windows):**
```batch
@echo off
set "_emailBody=%~1"
set "_mapConfig=%~2"

REM Save body to temp file
echo "%_emailBody%" | sed "s/\\\\n/\n/g" > "%TEMP%\message.txt"
sed -i "s/\"//g" "%TEMP%\message.txt"

REM Call helper with -m flag (required for mapping)
if "%_mapConfig%"=="" (
  node helpers\narrowRequestedData.js -f "%TEMP%\message.txt"
) else (
  node helpers\narrowRequestedData.js -m "%_mapConfig%" -f "%TEMP%\message.txt"
)
```

**Bash (Linux/Mac):**
```bash
#!/bin/bash
emailBody="$1"
mapConfig="$2"

# Save body to temp file
echo "$emailBody" | sed 's/\\n/\n/g' | sed 's/"//g' > "/tmp/message.txt"

# Call helper with -m flag (required for mapping)
if [ -z "$mapConfig" ]; then
  node helpers/narrowRequestedData.js -f "/tmp/message.txt"
else
  node helpers/narrowRequestedData.js -m "$mapConfig" -f "/tmp/message.txt"
fi
```

**Key Points:**
- The `-m` or `--map` flag is **required** to enable mapping functionality
- FILTER_CONFIG.mapRequestedData sets the config file name
- {mapConfig} template variable passes it to your script
- Your script uses it with: `node helpers/narrowRequestedData.js -m "%_mapConfig%" -f "message.txt"`

See `scripts/example.bat.template` and `scripts/example.sh.template` for complete examples.

### MAP_REQUEST_DATA

Define recipient properties that override mapped values when `%requestor%` is used:

```javascript
const MAP_REQUEST_DATA = {
  resolve: true,  // Enable resolution with map
  email: "recipient@example.com",
  file: "Document-{% date(<mm>-<dd>-<yyyy>) %}.pdf"
};
```

## Example Configuration Files

### Example 1: Generic Template

**File:** `config/mapRequestedData/example.json.template`

```json
{
  "description": "Example mapping configuration template",
  "mapTo": "exampleScript.bat",
  "documents": [
    {
      "name": "invoice",
      "folder": "C:\\Documents\\Invoices\\2026"
    },
    {
      "name": "receipt",
      "file": "Receipt-.*\\.pdf"
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

### Example 2:  Reports

**File:** `config/mapRequestedData/Reports.json`

```json
{
  "description": "Acme Corp report mapping",
  "mapTo": "reportRequest.bat",
  "documents": [
    {
      "name": "report",
      "folder": "C:\\Documents\\Billing\\Statements"
    }
  ],
  "recipients": [
    {
      "name": "%requestor%"
    }
  ]
}
```

**Task:** `verbose.js`

```javascript
const FILTER_CONFIG = {
  mapRequestedData: "Reports.json",
  fromPattern: "reports@example.com",
  bodyPattern: "John Smith"
};

const MAP_REQUEST_DATA = {
  resolve: true,
  email: "jane.doe@example.com",
  file: "Billing Statement - {% date(<mm>-<dd>-<yy>) %}"
};
```

**Result:**

When an email matches the filters:
- Document type "report" resolves to the billing folder
- Recipient `%requestor%` resolves to `jane.doe@example.com`
- File pattern with date syntax scans folder for matching PDFs
- Returns all files within the detected date range

## Output Format

### Without Mapping

```
?? Document: report
?? Date Range: 11/11/2025 to 03/11/2026  (last 4 months(s))
?? Recipient: Back to sender (requestor)
```

### With Mapping & File Matching

```
?? Document: "C:\Path\To\Documents\Folder"
?? Date Range: 11/11/2025 to 03/11/2026  (last 4 months(s))
?? Recipient: "jane.doe@example.com"
++ FILES MATCHING:
   Billing Statement - 11-17-25.pdf
   Billing Statement - 12-01-25.pdf
   Billing Statement - 01-15-26.pdf
   ...
```

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

## Full Integration Example

**Command:**
```bash
node extractEmail.mjs --config= --task=verbose 5
```

**Email Message:**
```
Good morning, can you please send me the reports for Acme Corp 
from the last four months?
```

**Processing Flow:**

1. **Task filter matches email** (from pattern + body pattern)
2. **Helper parses message:**
   - Document: "report"
   - Date range: 11/11/2025 to 03/11/2026 (last 4 months)
   - Recipient: "Back to sender (requestor)"

3. **Map resolution** (`Reports.json`):
   - "report" → `report` → billing folder path
   - "requestor" → `%requestor%` → use MAP_REQUEST_DATA

4. **Task MAP_REQUEST_DATA** (resolve: true):
   - Email: `jane.doe@example.com`
   - File pattern: `Billing Statement - {% date(<mm>-<dd>-<yy>) %}`

5. **File scanning:**
   - Parse date syntax to regex
   - Scan folder for matching files
   - Filter by date range
   - Return 18 matching PDFs

6. **Script receives resolved data:**
   - Document folder
   - Recipient email
   - List of files to send

## Tips & Best Practices

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

7. **Cross-platform paths**: Node's `path` module handles Windows/Unix differences automatically

## Testing

The project includes automated tests for the mapping functionality:

```bash
# Run all mapping tests
node test/test-mapping.mjs
```

**Test Coverage:**
- Basic message parsing (document types, date ranges, recipients)
- Map configuration loading
- Date syntax parsing ({% date(<format>) %})
- Document resolution with indexOf matching
- Recipient resolution with %requestor%
- Date range extraction (relative and absolute)
- Pattern variations and typos

**Adding Your Own Tests:**

Edit `test/test-mapping.mjs` to add custom test cases:

```javascript
test('Your test name', () => {
  const result = parseEmailTask('your test message', new Date());
  assert(result.documentType === 'expected type', 'Assertion message');
});
```

## Troubleshooting

**Files not matching:**
- Check folder path exists and is accessible
- Verify file pattern regex is correct
- Ensure date syntax matches actual filename format
- Check date range includes file dates

**Map not loading:**
- Verify file is in `config/mapRequestedData/`
- Check JSON syntax is valid
- Ensure file extension is `.json`

**%requestor% not resolving:**
- Verify `resolve: true` in MAP_REQUEST_DATA
- Check map recipient name is exactly `"%requestor%"`
- Ensure email/file defined in task or map

**Date syntax not parsing:**
- Verify syntax: `{% date(<format>) %}`
- Check format codes are valid (`<mm>`, `<dd>`, etc.)
- Ensure angle brackets around format codes
