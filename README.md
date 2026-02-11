# extractEmail ![icon.svg](icon.png)

A Node.js CLI tool to extract and process emails from IMAP accounts. Supports multiple account configurations and custom task plugins for extensible email processing.

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
extractEmail [--config=<account>] [--task=<task>] [-o <path>] [-n <num>] [-f] [--html] [--json[:html|table]] [-a] [option|task] [count]
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
| `-a, --attachment-download` | Download attachment(s) from email(s). Requires one of: `-n <num>`, `from="email@site.com"`, `subject="pattern"`, or `attachment=true`. |

### Filter Arguments

Used with `-a, --attachment-download` to filter emails:

| Filter | Description |
|--------|-------------|
| `from="email@domain.com"` | Filter by sender email address (partial match, case-insensitive) |
| `subject="pattern"` | Filter by subject text (partial match, case-insensitive) |
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
  // Filter by sender (case-insensitive, partial match)
  fromPattern: "noreply@example.com",

  // Filter by subject (case-insensitive, partial match)
  subjectPattern: "Invoice",

  // Filter by body text (case-insensitive, partial match)
  bodyPattern: "attached",
};

// Output folder comes from -o/--output-folder (defaults to current working directory)
```

Set any filter to `null` to skip it. All specified filters must match for an email to be processed.

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
│   └── downloadAttachments.js # Download attachments task
└── test/                      # Test utilities
    ├── run-tests.mjs          # Test runner script
    └── mockImap.mjs           # Mock IMAP with sample emails
```

## Dependencies

- [imap-simple](https://www.npmjs.com/package/imap-simple) - IMAP client library
- [mailparser](https://www.npmjs.com/package/mailparser) - Email parsing library
- [html-to-text](https://www.npmjs.com/package/html-to-text) - HTML to text conversion for sanitized body output

## License

ISC
