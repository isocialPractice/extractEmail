<!-- {% raw %} -->
# extractEmail ![icon.svg](icon.png)

A Node.js CLI tool to extract and process emails from IMAP accounts. Supports multiple account configurations and custom task plugins for extensible email processing.

`Ctrl + click` to view [full documentation](https://isocialpractice.github.io/extractEmail/index.html).

## Features

- Extract email fields (from, to, date, subject, body, attachment) from IMAP accounts
- Automatic HTML sanitization for body text (converts HTML to readable text by default)
- Get specific emails by number with full body content
- Full-body mode for complete email content (sanitized text, not truncated)
- HTML mode to preserve raw HTML content for parsing or processing
- **JSON output mode** for programmatic parsing and data integration
- Download attachments directly with powerful filtering options
- Support for multiple email account configurations
- Extensible task plugin system for custom email processing
- Built-in task for downloading attachments with filter criteria
- Test mode with mock data (no real IMAP credentials required)

## Installation

```bash
npm install
```

To make the command available globally:

```bash
npm link
```

## Configuration

> **⚠️ Security Note:** Configuration files contain sensitive credentials. Template files (`.template`) are tracked in Git, but actual config files are ignored. Never use `git add -f` on non-template config files.

### Setup

After cloning, copy the template files to create your configuration:

```bash
# Copy the default config template
cp configEmailExtraction.mjs.template configEmailExtraction.mjs

# Copy account template (for multi-account setup)
cp accounts/example.mjs.template accounts/example.mjs

# Copy task templates
cp extractEmailTasks/downloadAttachments.js.template extractEmailTasks/downloadAttachments.js
cp extractEmailTasks/stop.js.template extractEmailTasks/stop.js
cp extractEmailTasks/verbose.js.template extractEmailTasks/verbose.js
```

Then edit these files with your credentials. Changes to these files won't be tracked by Git.

### Default Configuration

Edit `configEmailExtraction.mjs` with your credentials:

```javascript
export const configEmail = {
  imap: {
    user: 'your-email@example.com',
    password: 'your-password',
    host: 'imap.example.com',
    port: 993,
    tls: true,
    authTimeout: 3000,
    tlsOptions: { rejectUnauthorized: false }
  }
};
```

### Multiple Account Support

1. Edit `config.json` to specify your accounts and tasks folders:

```json
{
  "accountsFolder": "./accounts",
  "tasksFolder": "./extractEmailTasks"
}
```

2. Create account configuration files in the accounts folder (e.g., `accounts/work.mjs`):

```javascript
export const configEmail = {
  imap: {
    user: 'work@company.com',
    password: 'work-password',
    host: 'imap.company.com',
    port: 993,
    tls: true,
    authTimeout: 3000,
    tlsOptions: { rejectUnauthorized: false }
  }
};
```

Account filenames must not contain spaces or special characters (`/ \ : * ? " < > |`).

## Usage

```bash
extractEmail [--config=<account>] [--task=<task>] [-o <path>] [-n <num>] [-f] [--html] [--json[:html|table]] [-a] [--filter] [--move <folder>] [option|task] [count]
```

### Account Selection

| Option | Description |
|--------|-------------|
| `--config=<name>` | Use account config from accounts folder (with or without `.mjs` extension) |

If `--config` is omitted, uses `./configEmailExtraction.mjs` in the current directory.

### Task Selection

| Option | Description |
|--------|-------------|
| `--task=<name>` | Run a task from the configured `tasksFolder` (with or without `.js` extension) |

If `--task` is provided, it looks for the task in the `tasksFolder` configured in `config.json` (default: `./extractEmailTasks`). This allows you to organize tasks in a custom folder.

### Email Selection Options

| Option | Description |
|--------|-------------|
| `-n, --number <num>` | Get a specific email by number (e.g., Email #5). Email #1 is the newest. Always outputs the full body message (sanitized). |
| `-f, --full-body` | Output the full body message (sanitized HTML to readable text, not truncated). Default count reduces to 20 for better performance. |
| `--html` | Output the full body with raw HTML preserved (not sanitized). Useful for parsing or when HTML structure is needed. Default count reduces to 20. |
| `--json` | Output results in JSON format instead of text. Useful for programmatic parsing and data integration. Default count reduces to 20. |
| `--json:html` | Output JSON with hierarchical structure based on HTML headings (h1-h6). Content is nested under heading names with 'tag-data' properties. Default count reduces to 25. |
| `--json:table` | Output JSON with columnar format from HTML tables. Extracts ONLY table data, removes all other content. Table headers (th) or first row (td) become property names, values are arrays of column data. Default count reduces to 25. |
| `-a, --attachment-download` | Download attachment(s) from email(s). Requires one of: `-n <num>`, `from="email@site.com"`, `subject="pattern"`, `body="text"`, or `attachment=true`. |
| `--filter` | Find and display emails matching filter criteria (same filters as `-a`, but without downloading attachments). |
| `--filter:bool` | Check if any email matches filter criteria, output `true` or `false`. Stops immediately on first match. Default checks 100 emails. |
| `--count` | Output a single integer count of emails in the checked set or matching filter criteria. Works with `all` and `--range`. |
| `--index` | Output comma-separated position numbers of emails in the checked set or matching filter criteria. Useful to identify which `-n` numbers to use. Works with `all` and `--range`. |
| `--move <folder>` | Move emails matching filter criteria to a named IMAP folder. Verifies the folder exists; outputs an error if not found. Supports `[count]` and `--range`. |

### Filter Arguments

Used with `-a, --attachment-download`, `--filter`, `--filter:bool`, or `--move` to filter emails:

| Filter | Description |
|--------|-------------|
| `from="email@domain.com"` | Filter by sender email address (partial match, case-insensitive) |
| `subject="pattern"` | Filter by subject text (partial match, case-insensitive) |
| `body="text"` | Filter by email body/message content (partial match, case-insensitive) |
| `attachment=true` | Find first email with attachment |

### Extraction Options

| Option | Description |
|--------|-------------|
| `-h, --help` | Show help message |
| `from` | Extract sender addresses |
| `to` | Extract recipient addresses |
| `date` | Extract email dates |
| `subject` | Extract email subjects |
| `body` | Extract email body text (HTML sanitized, truncated to 200 chars unless `-f` or `--html` is used) |
| `attachment` | Extract attachment name(s) or false |
| `all` | Extract all fields (default, body is sanitized and truncated) |
| `-o, --output-folder <path>` | Write output to a folder or file instead of stdout |

### Output Destination

When `-o, --output-folder` is provided:

- If the path is a directory, non-task output is written to `extractEmal.response.txt` in that folder (overwrites any existing file).
- If the path is a file, the file must not already exist and output is written there.

For attachment tasks, downloads default to the current working directory unless `-o` is provided.

### Email Numbering

Emails are numbered from newest to oldest:
- **Email #1** = Most recent email
- **Email #2** = Second most recent
- And so on...

This makes it easy to reference recent emails by number.

### Body Text Display

By default, email body text is **automatically sanitized** (HTML converted to readable text) and **truncated to 200 characters** for performance.

#### Display Modes:

- **Default mode** (no flags)
  - HTML is automatically sanitized to readable text
  - Body is truncated to 200 characters
  - Respects basic formatting (paragraphs, line breaks, tables)

- **Use `-f, --full-body`** for full sanitized text output
  - HTML is sanitized to readable text (not truncated)
  - Respects block elements like `<p>`, `<div>`, `<br>` for proper line breaks
  - Tables are converted to pipe-delimited format for readability
  - Default count reduces to 20 emails for performance

- **Use `--html`** to preserve raw HTML content
  - Keeps all HTML tags and structure intact (not sanitized)
  - Not truncated
  - Useful for parsing HTML or when original HTML is needed
  - Default count reduces to 20 emails for performance

- **Use `-n, --number`** to get a specific email
  - Always shows full body (sanitized to text)
  - Not truncated

#### Table Formatting

HTML tables are automatically converted to a pipe-delimited format for easy reading:

**HTML Input:**
```html
<table>
  <tr><th>Field</th><th>Response</th></tr>
  <tr><td>Name</td><td>John Doe</td></tr>
  <tr><td>Use Product</td><td>Yes</td></tr>
</table>
```

**Sanitized Output:**
```
| Field | Response |
| Name | John Doe |
| Use Product | Yes |
```

This format makes tables readable in terminal output and can be easily parsed or imported into spreadsheets.

### JSON Output Mode

The `--json` flag outputs emails in JSON format for easy programmatic parsing:

**Command:**
```bash
extractEmail --json all 2
```

**Output:**
```json
{
  "Email #2": {
    "From": "sender@example.com",
    "To": ["recipient1@example.com", "recipient2@example.com"],
    "Date": "Mon, 09 Feb 2026 20:54:23 GMT",
    "Subject": "Example Subject",
    "Attachment": "document.pdf",
    "Body": "Email body content here..."
  },
  "Email #1": {
    "From": "another@example.com",
    "To": "you@example.com",
    "Date": "Mon, 09 Feb 2026 22:21:23 -0700",
    "Subject": "Another Subject",
    "Attachment": "false",
    "Body": "Another email body..."
  }
}
```

**Benefits:**
- Easy to parse with `JSON.parse()` in JavaScript/Node.js
- Compatible with `jq` command-line tool for filtering
- Can be directly imported into databases or data pipelines
- `From` and `Date` are always strings
- `To` is automatically converted to an array when multiple recipients exist (otherwise a string)

#### Hierarchical JSON Mode (`--json:html`)

The `--json:html` flag creates a hierarchical JSON structure based on HTML heading levels (h1-h6):

**Command:**
```bash
extractEmail --json:html -n 1
```

**Output:**
```json
{
  "Email #1": {
    "From": "sender@example.com",
    "To": "you@example.com",
    "Date": "Mon, 09 Feb 2026 22:21:23 -0700",
    "Subject": "Survey Response",
    "Attachment": "false",
    "Body": {
      "Main Heading": {
        "tag-data": "Introduction content here",
        "Subheading Level 2": {
          "tag-data": "Details under subheading",
          "Subheading Level 3": {
            "tag-data": "Nested content"
          }
        }
      },
      "tag-data": "Content without heading parent appears at root"
    }
  }
}
```

**Benefits:**
- Automatically organizes content by heading structure
- Preserves document hierarchy for structured data extraction
- Content between headings stored in `tag-data` properties
- Useful for parsing structured HTML emails like reports or surveys

#### Columnar Table JSON Mode (`--json:table`)

The `--json:table` flag extracts HTML tables into columnar JSON format. All non-table content is removed:

**Command:**
```bash
extractEmail --json:table -n 1
```

**Input Email with Table:**
```html
<p>Hello, here is your survey response:</p>
<table>
  <tr><th>Field</th><th>Response</th></tr>
  <tr><td>Name</td><td>John Doe</td></tr>
  <tr><td>Use Product</td><td>Yes</td></tr>
</table>
<p>Thank you!</p>
```

**Output:**
```json
{
  "Email #1": {
    "From": "sender@example.com",
    "To": "you@example.com",
    "Date": "Mon, 09 Feb 2026 22:21:23 -0700",
    "Subject": "Survey Response",
    "Attachment": "false",
    "Body": {
      "Field": [
        "Name",
        "Use Product"
      ],
      "Response": [
        "John Doe",
        "Yes"
      ]
    }
  }
}
```

**Benefits:**
- Extracts ONLY table data, removes all other content
- Converts HTML tables to structured JSON automatically
- Table headers (th elements) or first row (td elements) become property names
- Column data stored as arrays for easy iteration
- Perfect for extracting tabular data from emails (invoices, reports, forms)
- If no tables are found, Body will be an empty object

### Examples

#### Basic Extraction

```bash
# Extract all fields from last 100 emails (default account)
# Body is sanitized and truncated to 200 chars
extractEmail

# Extract subjects from last 50 emails
extractEmail subject 50

# Extract body from last 10 emails (sanitized, truncated)
extractEmail body 10

# Extract attachment names from last 10 emails
extractEmail attachment 10

# Extract sender addresses from last 25 emails using work account
extractEmail --config=work from 25
```

#### Email Selection by Number

```bash
# Get the most recent email with full body (#1 = newest)
extractEmail -n 1

# Get email #10 with full body
extractEmail -n 10

# Get email #5 and download its attachments
extractEmail -a -n 5
```

#### Full Body Mode

```bash
# Get last 20 emails with full body (sanitized text, not truncated)
extractEmail -f all 20

# Get last 10 subject lines with full body text (sanitized, not truncated)
extractEmail -f subject 10

# Get last 20 emails with raw HTML preserved (not sanitized, not truncated)
extractEmail --html all 20

# Get last 5 emails with HTML for parsing (raw HTML)
extractEmail --html body 5
```

#### JSON Output

```bash
# Get last 10 emails in JSON format
extractEmail --json all 10

# Get specific email in JSON format
extractEmail --json -n 5

# Get emails with JSON output and save to file
extractEmail --json all 20 -o ./output/emails.json

# Use with jq to filter specific fields
extractEmail --json all 10 | jq '.[].Subject'

# Get email with hierarchical JSON structure based on HTML headings
extractEmail --json:html -n 1

# Get last 25 emails with hierarchical structure (default count for --json:html)
extractEmail --json:html all

# Get email with columnar table JSON format
extractEmail --json:table -n 1

# Get last 25 emails with table format (default count for --json:table)
extractEmail --json:table all

# Extract and parse table data with jq
extractEmail --json:table -n 1 | jq '.["Email #1"].Body.Field'
```

#### Download Attachments

```bash
# Download attachments from email #5
extractEmail -a -n 5

# Download attachments from emails sent by a specific sender
extractEmail -a from="boss@work.com"

# Download attachments from emails with "Invoice" in subject
extractEmail -a subject="Invoice"

# Download attachments from the first email that has any attachment
extractEmail -a attachment=true

# Download attachments to a specific folder
extractEmail -a -n 5 -o ./downloads
```

#### Task Execution

```bash
# Run a task using --task option
extractEmail --task=myTask 50

# Run a task with a specific account
extractEmail --config=work --task=myTask
```

#### Output Control

```bash
# Write output to a folder
extractEmail -o ./output subject 25

# Write output to a specific file
extractEmail -o ./output/results.txt body 10

# Show help
extractEmail --help
```

## Direct Attachment Download

You can download attachments directly using the `-a, --attachment-download` flag combined with filters, without needing to use the `downloadAttachments` task.

### Usage

```bash
extractEmail -a [filter] [-o <output-folder>]
```

### Filter Options

At least one filter is required when using `-a`:

- **Specific email number:** `-n <num>` - Download from a specific email
- **Sender filter:** `from="email@domain.com"` - Download from emails sent by this sender
- **Subject filter:** `subject="pattern"` - Download from emails with this subject pattern
- **Has attachment:** `attachment=true` - Download from the first email that has any attachment

### Examples

```bash
# Download attachments from email #5
extractEmail -a -n 5

# Download from all emails sent by a specific sender
extractEmail -a from="reports@company.com"

# Download from emails with "invoice" in the subject
extractEmail -a subject="invoice"

# Download from the first email with any attachment
extractEmail -a attachment=true

# Specify output folder
extractEmail -a -n 5 -o ./my-downloads
```

By default, attachments are saved to an `attachments/` folder in the current directory. Use `-o` to specify a different location.

## Task System

Tasks are custom plugins that process emails. They are located in the `extractEmailTasks/` folder.

### Built-in Tasks

| Task | Description |
|------|-------------|
| `stop` | Find emails with subject "stop" and output the sender |
| `downloadAttachments` | Download attachments from emails matching filter criteria (legacy method) |
| `verbose` | Flexible multi-task template for common email-response actions |

### Running Tasks

```bash
# Run the stop task on last 100 emails
extractEmail stop

# Run downloadAttachments task on last 50 emails with work account
extractEmail --config=work downloadAttachments 50
```

When `-o` points to a file and multiple attachments are downloaded, files are prefixed with `1_`, `2_`, etc. If an attachment extension differs from the file path extension, the attachment extension is appended (for example, `1_report.txt.pdf`).

### downloadAttachments Task

This task downloads attachments from emails matching configurable filter criteria.

Edit `extractEmailTasks/downloadAttachments.js` to configure filters:

```javascript
const FILTER_CONFIG = {
  // Filter by sender (plain substring or {{ template }} pattern)
  fromPattern: "noreply@example.com",

  // Filter by subject (plain substring or {{ template }} pattern)
  subjectPattern: "Invoice",

  // Filter by body text (plain substring or {{ template }} pattern)
  bodyPattern: "attached",
};
```

Set any filter to `null` to skip it. All specified filters must match for an email to be processed.

#### Filter Template Syntax

Filter patterns support `{{ }}` template syntax for regular expressions and dynamic date values. Plain strings (no `{{ }}`) continue to use the existing case-insensitive substring match.

**Regular expression segments:**

Wrap any regex expression in `{{ }}`. Literal text outside `{{ }}` is automatically escaped.

```javascript
fromPattern:    "{{ .*@invoices\\.com }}"      // any address at invoices.com
subjectPattern: "{{ Invoice #[0-9]+ }}"        // "Invoice #" followed by digits
subjectPattern: "{{ .{3,} }}"                  // three or more characters
subjectPattern: "Invoice {{ #[0-9]+ }}"        // literal "Invoice " + digit filter
```

**Date helper placeholders:**

Use `{{ dates.* }}` to inject the current date value as an escaped literal (not a regex). Powered by [@jhauga/getDate](https://github.com/jhauga/getDate).

| Placeholder | Example value |
|---|---|
| `{{ dates.year }}`           | `2026` |
| `{{ dates.lastYear }}`       | `2025` |
| `{{ dates.nextYear }}`       | `2027` |
| `{{ dates.month }}`          | `March` |
| `{{ dates.lastMonth }}`      | `February` |
| `{{ dates.month.abbr }}`     | `Mar` |
| `{{ dates.lastMonth.abbr }}` | `Feb` |
| `{{ dates.day }}`            | `03` |
| `{{ dates.quarter }}`        | `1` |
| `{{ dates.lastQuarter }}`    | `4` |
| `{{ dates.year.short }}`     | `26` |

```javascript
subjectPattern: "{{ dates.year }}"                         // matches subject containing "2026"
subjectPattern: "Report - {{ dates.month }}"               // "Report - March"
subjectPattern: "{{ dates.month }} {{ dates.year }}"       // "March 2026" (exact match)
subjectPattern: "{{ dates.month }}.*{{ [0-9]{4} }}"        // month then any 4-digit year
```

**Mixing literals, regex, and date helpers:**

```javascript
// Match "Monthly Report" followed by the current year anywhere in the subject:
subjectPattern: "Monthly Report.*{{ dates.year }}"

// Match sender from a domain, case-insensitive:
fromPattern: "{{ .*@(invoices|billing)\\.company\\.com }}"

// Match body mentioning the current month:
bodyPattern: "{{ dates.month }}"
```
verbose Task

The `verbose` task template provides a flexible, easy-to-configure interface for handling common email-response actions. It can execute multiple tasks in sequence and supports various built-in task types.

Edit `extractEmailTasks/verbose.js` to configure:

```javascript
// Define single task or array of tasks to execute
const taskDoes = [
  "log-email",
  "download-attachments"
];

// Optional: Filter which emails to process
const FILTER_CONFIG = {
  fromPattern: null,           // Filter by sender
  subjectPattern: null,        // Filter by subject
  bodyPattern: null,           // Filter by body text
  requireAttachments: false,   // Only process emails with attachments
};
```

#### Available Task Types

| Task Type | Description |
|-----------|-------------|
| `download-attachments` | Download email attachments to output folder |
| `check-header-stop` | Check if subject contains "stop" (mailing list unsubscribe detection) |
| `run-script` | Execute a custom shell script or batch file |
| `log-email` | Log email details to console |
| `custom` | Run custom handler function defined in `CUSTOM_HANDLER` |

#### Script Configuration (for "run-script" task)

Configure external scripts to run in response to emails:

```javascript
const SCRIPT_CONFIG = {
  scriptPath: "scripts/process-email.sh",  // Path to script
  scriptArgs: [                            // Arguments with template variables
    "{from}",                              // Don't add quotes - handled automatically
    "{subject}"
  ],
  workingDir: null,                        // Working directory (null = current)
  continueOnError: false,                  // Continue if script fails?
};
```

**Template variables for script arguments:**
- `{from}` - Email sender (full "Display Name <email@domain.com>" format)
- `{subject}` - Email subject
- `{date}` - Email date
- `{attachmentCount}` - Number of attachments

**Important:** Don't wrap template variables in quotes in `scriptArgs`. The script runner uses `spawnSync` which properly handles arguments with spaces and special characters automatically.

**Example use cases:**

```javascript
// Download attachments from emails with attachments
const taskDoes = "download-attachments";
const FILTER_CONFIG = { requireAttachments: true };

// Run script for emails from specific sender
const taskDoes = "run-script";
const FILTER_CONFIG = { fromPattern: "reports@company.com" };

// Multi-task: Log email, check for "stop", then download attachments
const taskDoes = [
  "log-email",
  "check-header-stop",
  "download-attachments"
];

// Custom processing with your own logic
const taskDoes = "custom";
const CUSTOM_HANDLER = (headersPart, subject, body, fullEmail, outputToTerminal) => {
  // Your custom logic here
  outputToTerminal("Custom", "Processing email", 0);
  return true; // Return false to stop processing further tasks
};
```

**Running the verbose task:**

```bash
# Run verbose task on last 100 emails
extractEmail verbose

# Run verbose task on last 50 emails with work account
extractEmail --config=work verbose 50

# Run verbose task with output folder
extractEmail verbose -o ./downloads 25
```

### 
### Creating Custom Tasks

1. Create a new file in `extractEmailTasks/` (e.g., `myTask.js`)

2. Export a default async function:

```javascript
export default async function myTask(
  headersPart,  // Email headers { from, to, subject, date }
  subject,      // Email subject string
  body,         // Email body text
  setVal,       // Helper: setVal(field, headersPart, subject, body)
  outputToTerminal,  // Helper: outputToTerminal(field, value, index)
  context       // { connection, msg, __dirname } for advanced operations
) {
  // Your custom logic here
  if (subject.includes('important')) {
    outputToTerminal('subject', subject, 0);
    outputToTerminal('from', headersPart.from, 1);
  }
}
```

3. Add your task to `taskSets` in `extractEmail.mjs`:

```javascript
const taskSets = {
  "stop": "Get the number from STOP request...",
  "downloadAttachments": "Download attachments...",
  "myTask": "Description of what myTask does."
};
```

4. Run your task:

```bash
extractEmail myTask 50
```

## Testing

The application includes a test mode that uses mock email data, allowing you to test without real IMAP credentials.

### Running Tests

```bash
npm test
```

This runs the test suite that validates:
- Help output and documentation
- Field extraction (from, to, date, subject, body)
- Task execution (stop task)
- Count limiting

### Manual Testing with --test Flag

Use `--test` to run with mock email data:

```bash
# Test extracting all fields
node extractEmail.mjs --test

# Test extracting subjects from 3 emails
node extractEmail.mjs --test subject 3

# Test the stop task
node extractEmail.mjs --test stop
```

### Mock Email Data

The test mode uses 5 sample emails defined in `test/mockImap.mjs`:
- Welcome email
- Monthly report
- STOP request (for testing stop task)
- Invoice with PDF attachment
- Support ticket response

You can modify `test/mockImap.mjs` to add custom test scenarios.

## Project Structure

```text
extractEmail/
├── extractEmail.mjs           # Main CLI entry point
├── configEmailExtraction.mjs  # Default IMAP configuration
├── config.json                # Multi-account folder configuration
├── package.json               # Project metadata and dependencies
├── accounts/                  # Account configuration files
│   └── example.mjs            # Example account config
├── extractEmailTasks/         # Custom task plugins
│   ├── stop.js                # Example: find "stop" emails
│   ├── downloadAttachments.js # Download attachments task
│   ├── verbose.js             # Flexible multi-task template
│   └── helpers/               # Shared task helpers
│       ├── dateHelper.mjs     # {{ dates.* }} values via @jhauga/getDate
│       └── filterHelper.mjs   # {{ regex }} / {{ dates.* }} filter resolution
└── test/                      # Test utilities
    ├── run-tests.mjs          # Test runner script
    └── mockImap.mjs           # Mock IMAP with sample emails
```

## Dependencies

- [imap-simple](https://www.npmjs.com/package/imap-simple) - IMAP client library
- [mailparser](https://www.npmjs.com/package/mailparser) - Email parsing library
- [html-to-text](https://www.npmjs.com/package/html-to-text) - HTML to text conversion for sanitized body output
- [@jhauga/getdate](https://github.com/jhauga/getDate) - Cross-platform date retrieval for `{{ dates.* }}` filter placeholders

## License

ISC
<!-- {% endraw %} -->
