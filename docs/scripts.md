<!-- {% raw %} -->
# Scripts Guide

The scripts system allows tasks to execute external scripts (batch files, shell scripts, or executables) with email data passed as arguments.

## Overview

Scripts are configured in the `verbose` task's `SCRIPT_CONFIG` and are executed using Node.js `spawnSync` with proper argument handling for cross-platform compatibility.

## Script Location

Scripts are stored in the `scripts/` directory:

```
extractEmail/
└── scripts/
    ├── example.bat.template    # Windows batch template
    ├── example.sh.template     # Bash script template
    └── your-script.bat         # Your custom scripts
```

## SCRIPT_CONFIG

Configure script execution in your task file:

```javascript
const SCRIPT_CONFIG = {
  scriptPath: "scripts/process-email.bat",
  scriptArgs: [
    "{from}",           // Template variable
    "{subject}",
    "{body}",
    "{date}",
    "{attachmentCount}",
    "{mapConfig}"
  ],
  workingDir: null,      // Working directory (null = project root)
  continueOnError: false // Stop on script error?
};
```

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `scriptPath` | string | Path to script (relative to project root) |
| `scriptArgs` | array | Arguments with template variables |
| `workingDir` | string/null | Working directory (null = project root) |
| `continueOnError` | boolean | Continue if script fails |

---

## Template Variables

Template variables are replaced with email data when the script runs.

| Variable | Description | Example |
|----------|-------------|---------|
| `{from}` | Full sender string | `"John Doe <john@example.com>"` |
| `{subject}` | Email subject | `"Monthly Report"` |
| `{body}` | Email body (normalized) | `"Hello,\nPlease find..."` |
| `{date}` | Email date | `"Mon, 09 Feb 2026 20:54:23 GMT"` |
| `{attachmentCount}` | Number of attachments | `"2"` |
| `{mapConfig}` | Mapping config name | `"Reports.json"` |

### Body Normalization

The `{body}` template variable is normalized for script processing:
- Newlines converted to literal `\n` markers
- Safe for sed/awk post-processing
- Quotes and special characters escaped

---

## Writing Scripts

### Windows Batch Files

**Template:** `scripts/example.bat.template`

```batch
@echo off
setlocal EnableDelayedExpansion

REM ================================================================
REM Example batch script for extractEmail task integration
REM Arguments:
REM   %1 - Email body text (with \n for newlines)
REM   %2 - Map configuration name (optional)
REM ================================================================

set "_emailBody=%~1"
set "_mapConfig=%~2"

echo Processing email...
echo.

REM Save body to temp file, converting \n to actual newlines
echo !_emailBody! | sed "s/\\\\n/\n/g" > "%TEMP%\message.txt"

REM Remove surrounding quotes if present
sed -i "s/\"//g" "%TEMP%\message.txt"

REM Display parsed body
echo === Email Body ===
type "%TEMP%\message.txt"
echo.
echo ==================

REM Call narrowRequestedData helper if map config provided
if "%_mapConfig%"=="" (
  echo No map config provided, using basic parsing
  node helpers\narrowRequestedData.js -f "%TEMP%\message.txt"
) else (
  echo Using map config: %_mapConfig%
  node helpers\narrowRequestedData.js -m "%_mapConfig%" -f "%TEMP%\message.txt"
)

REM Cleanup
del "%TEMP%\message.txt" 2>nul

echo.
echo Script completed.
exit /b 0
```

### Bash Scripts

**Template:** `scripts/example.sh.template`

```bash
#!/bin/bash

# ================================================================
# Example bash script for extractEmail task integration
# Arguments:
#   $1 - Email body text (with \n for newlines)
#   $2 - Map configuration name (optional)
# ================================================================

emailBody="$1"
mapConfig="$2"

echo "Processing email..."
echo

# Save body to temp file, converting \n to actual newlines
echo "$emailBody" | sed 's/\\n/\n/g' | sed 's/"//g' > "/tmp/message.txt"

# Display parsed body
echo "=== Email Body ==="
cat "/tmp/message.txt"
echo
echo "=================="

# Call narrowRequestedData helper if map config provided
if [ -z "$mapConfig" ]; then
  echo "No map config provided, using basic parsing"
  node helpers/narrowRequestedData.js -f "/tmp/message.txt"
else
  echo "Using map config: $mapConfig"
  node helpers/narrowRequestedData.js -m "$mapConfig" -f "/tmp/message.txt"
fi

# Cleanup
rm -f "/tmp/message.txt"

echo
echo "Script completed."
exit 0
```

---

## Script Execution Details

### Path Resolution

Script paths are resolved relative to the project directory:

```javascript
// This works from any current directory
scriptPath: "scripts/myScript.bat"

// Resolves to: /path/to/extractEmail/scripts/myScript.bat
```

### Argument Handling

Arguments are passed using `spawnSync` with proper escaping:
- **No manual quoting needed** in `scriptArgs`
- Spaces and special characters handled automatically
- Cross-platform compatible

```javascript
// DON'T add quotes - handled automatically
scriptArgs: ["{from}", "{subject}"]

// NOT like this:
scriptArgs: ['"{from}"', '"{subject}"']  // WRONG
```

### Windows Special Characters

For Windows batch files, special characters are automatically escaped:
- `< > | & ^ %` converted to caret-escaped versions
- Email addresses with `<>` handled correctly
- Piping and redirection characters protected

---

## Complete Task Example

### Task Configuration

```javascript
// extractEmailTasks/verbose.js

const taskDoes = "run-script";

const FILTER_CONFIG = {
  mapRequestedData: "Reports.json",
  fromPattern: "requests@example.com",
  bodyPattern: "send me"
};

const MAP_REQUEST_DATA = {
  resolve: true,
  email: "recipient@example.com",
  file: "Report-{% date(<mm>-<dd>-<yy>) %}.pdf"
};

const SCRIPT_CONFIG = {
  scriptPath: "scripts/processRequest.bat",
  scriptArgs: [
    "{body}",
    "{mapConfig}"
  ],
  workingDir: null,
  continueOnError: false
};
```

### Script File

```batch
@echo off
setlocal EnableDelayedExpansion

set "_body=%~1"
set "_map=%~2"

REM Process the email body
echo !_body! | sed "s/\\\\n/\n/g" > "%TEMP%\body.txt"
sed -i "s/\"//g" "%TEMP%\body.txt"

REM Parse with mapping
node helpers\narrowRequestedData.js -m "%_map%" -f "%TEMP%\body.txt" > "%TEMP%\parsed.txt"

REM Read parsed results
for /f "tokens=*" %%a in (%TEMP%\parsed.txt) do (
  echo %%a
)

REM Your custom processing here...

del "%TEMP%\body.txt" "%TEMP%\parsed.txt" 2>nul
exit /b 0
```

### Running

```bash
extractEmail --task=verbose 50
```

---

## Error Handling

### continueOnError: false (Default)

Script errors stop task execution:

```javascript
const SCRIPT_CONFIG = {
  scriptPath: "scripts/critical.bat",
  continueOnError: false  // Stop if script fails
};
```

### continueOnError: true

Script errors are logged but processing continues:

```javascript
const SCRIPT_CONFIG = {
  scriptPath: "scripts/optional.bat",
  continueOnError: true  // Log error, continue processing
};
```

### Exit Codes

- `0` - Success
- Non-zero - Error (triggers continueOnError behavior)

---

## Advanced Patterns

### Chaining Multiple Scripts

Use multi-task execution:

```javascript
const taskDoes = [
  "run-script",  // First script
  "log-email",   // Log results
  "run-script"   // Another script (need separate config)
];
```

### Conditional Script Selection

In your task logic:

```javascript
const CUSTOM_HANDLER = (headersPart, subject, body, fullEmail, output) => {
  if (subject.includes('urgent')) {
    // Run urgent script
    execSync('scripts/urgent.bat');
  } else {
    // Run normal script
    execSync('scripts/normal.bat');
  }
  return true;
};
```

### Processing Script Output

Capture script output in custom handler:

```javascript
import { spawnSync } from 'child_process';

const CUSTOM_HANDLER = (headersPart, subject, body) => {
  const result = spawnSync('node', [
    'helpers/narrowRequestedData.js',
    '-m', 'Reports.json',
    body
  ], {
    encoding: 'utf-8',
    cwd: process.cwd()
  });
  
  if (result.status === 0) {
    console.log('Script output:', result.stdout);
  } else {
    console.error('Script error:', result.stderr);
  }
  
  return true;
};
```

---

## Best Practices

1. **Use template files** - Keep `.template` versions in git, actual scripts in `.gitignore`
2. **Handle missing arguments** - Check if variables are empty before using
3. **Clean up temp files** - Delete temporary files after processing
4. **Use proper exit codes** - Return 0 for success, non-zero for errors
5. **Log progress** - Echo status messages for debugging
6. **Test independently** - Verify scripts work before integrating with tasks
7. **Cross-platform awareness** - Use appropriate line endings and path separators

---

## Troubleshooting

### Script Not Found

- Check `scriptPath` is relative to project root
- Verify script file exists
- Check file permissions (executable on Linux/Mac)

### Arguments Not Passing

- Don't add quotes around template variables
- Check `scriptArgs` array format
- Verify template variable names are correct

### Special Character Issues

- Windows: Characters should be auto-escaped
- Linux: Check shell quoting
- Body text: Use `sed` to process `\n` markers

### Script Exits Early

- Check for syntax errors in script
- Verify all required tools (sed, node) are available
- Run script manually with test arguments
<!-- {% endraw %} -->