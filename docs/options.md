<!-- {% raw %} -->
# CLI Options Reference

Complete reference for all extractEmail command-line options.

## Options Summary

| Option | Description |
|--------|-------------|
| `--config=<name>` | Use account config from accounts folder |
| `--task=<name>` | Run a custom task plugin from tasks folder |
| `-n, --number <num>` | Get a specific email by number |
| `-f, --full-body` | Output complete body text (not truncated) |
| `--html` | Preserve raw HTML content in body output |
| `--json` | Output results in JSON format |
| `--json:html` | JSON with hierarchical structure from HTML DOM |
| `--json:table` | JSON with columnar format from HTML tables |
| `-a, --attachment-download` | Download attachments from matching emails |
| `--filter` | Find and display emails matching filter criteria |
| `--filter:bool` | Check if any email matches filters, output true/false |
| `-i, --ignore <rule>` | Ignore emails or attachments matching a pattern |
| `-o, --output-folder <path>` | Write output to a folder or file |
| `-h, --help` | Display help message |
| `--test` | Run with mock email data (no IMAP connection) |

### Filter Arguments

| Argument | Description |
|----------|-------------|
| `from="email@domain"` | Filter by sender email (partial, case-insensitive) |
| `subject="pattern"` | Filter by subject text (partial, case-insensitive) |
| `body="text"` | Filter by body content (partial, case-insensitive) |
| `attachment=true` | Match first email with any attachment |

### Field Extraction

| Field | Description |
|-------|-------------|
| `from` | Extract sender addresses |
| `to` | Extract recipient addresses |
| `date` | Extract email dates |
| `subject` | Extract email subjects |
| `body` | Extract email body text (truncated to 200 chars) |
| `attachment` | Extract attachment names (or `false` if none) |
| `all` | Extract all fields (default) |

---

## Basic Syntax

```bash
extractEmail [options] [field] [count]
```

## Account and Task Selection

### `--config=<name>`

Select which account configuration to use.

```bash
# Use account from accounts/work.mjs
extractEmail --config=work subject 10

# Extension is optional
extractEmail --config=work.mjs subject 10
```

**Default:** Uses `./configEmailExtraction.mjs` in the current directory.

**See also:** [Multiple Account Setup](#multiple-account-setup)

---

### `--task=<name>`

Run a custom task plugin from the tasks folder.

```bash
# Run the downloadAttachments task
extractEmail --task=downloadAttachments 50

# Extension is optional
extractEmail --task=downloadAttachments.js 50

# Combine with account selection
extractEmail --config=work --task=myTask 25
```

**Default:** No task (standard extraction mode).

**See also:** [Tasks Guide](tasks.md)

---

## Email Selection Options

### `-n, --number <num>`

Get a specific email by number. Email #1 is the most recent.

```bash
# Get the newest email
extractEmail -n 1

# Get the 10th most recent email
extractEmail -n 10

# Combine with attachment download
extractEmail -a -n 5
```

**Features:**
- Always outputs full body content (not truncated)
- Body text is automatically sanitized (HTML converted to readable text)
- Can be combined with `-a` for attachment download
- Can be combined with `--task` to run task on specific email

---

### `-f, --full-body`

Output complete body text instead of truncated preview.

```bash
# Get full body for last 20 emails
extractEmail -f all 20

# Full body output for subject extraction
extractEmail -f subject 10
```

**Features:**
- HTML is sanitized to readable text
- Body is NOT truncated (default truncates to 200 chars)
- Default email count reduces to 20 for performance
- Tables converted to pipe-delimited format

---

### `--html`

Preserve raw HTML content in body output.

```bash
# Get raw HTML body for last 20 emails
extractEmail --html all 20

# HTML output for specific email
extractEmail --html -n 1
```

**Features:**
- HTML tags and structure preserved
- Content is NOT sanitized
- Body is NOT truncated
- Default email count reduces to 20 for performance
- Useful for parsing or when original HTML structure is needed

---

## JSON Output Options

### `--json`

Output results in JSON format.

```bash
# Get last 10 emails in JSON
extractEmail --json all 10

# JSON output for specific email
extractEmail --json -n 5

# Pipe to jq for filtering
extractEmail --json all 10 | jq '.[].Subject'
```

**Output Structure:**
```json
{
  "Email #2": {
    "From": "sender@example.com",
    "To": ["recipient1@example.com", "recipient2@example.com"],
    "Date": "Mon, 09 Feb 2026 20:54:23 GMT",
    "Subject": "Example Subject",
    "Attachment": "document.pdf",
    "Body": "Email body content here..."
  }
}
```

**Notes:**
- `From` and `Date` are always strings
- `To` is an array when multiple recipients exist
- Default email count reduces to 20

---

### `--json:html`

Hierarchical JSON structure based on HTML headings (h1-h6).

```bash
# Hierarchical JSON for specific email
extractEmail --json:html -n 1

# Hierarchical JSON for multiple emails
extractEmail --json:html all 25
```

**Output Structure:**
```json
{
  "Email #1": {
    "Body": {
      "Main Heading": {
        "tag-data": "Content under heading",
        "Subheading": {
          "tag-data": "Nested content"
        }
      }
    }
  }
}
```

**Features:**
- Content organized by heading structure
- Preserves document hierarchy
- Content between headings stored in `tag-data` properties
- Default email count: 25

---

### `--json:table`

Extract HTML tables into columnar JSON format.

```bash
# Table JSON for specific email
extractEmail --json:table -n 1

# Table JSON for multiple emails
extractEmail --json:table all 25
```

**Output Structure:**
```json
{
  "Email #1": {
    "Body": {
      "Field": ["Name", "Use Product"],
      "Response": ["John Doe", "Yes"]
    }
  }
}
```

**Features:**
- Extracts ONLY table data (removes all other content)
- Table headers become property names
- Column data stored as arrays
- Perfect for invoices, reports, forms
- Default email count: 25

---

## Attachment Options

### `-a, --attachment-download`

Download attachments from matching emails.

```bash
# Download from specific email
extractEmail -a -n 5

# Download by sender filter
extractEmail -a from="reports@company.com"

# Download by subject filter
extractEmail -a subject="Invoice"

# Download by body content
extractEmail -a body="attached report"

# Download first email with any attachment
extractEmail -a attachment=true

# Specify output folder
extractEmail -a -n 5 -o ./downloads
```

**Requires one of:**
- `-n <num>` - Specific email number
- `from="email@domain.com"` - Sender filter
- `subject="pattern"` - Subject filter
- `body="text"` - Body content filter
- `attachment=true` - First email with attachment

---

### `--filter`

Find and display emails matching filter criteria without downloading attachments.

```bash
# Find emails from a specific sender
extractEmail --filter from="boss@work.com"

# Find emails with specific subject text
extractEmail --filter subject="Project Update"

# Find emails containing body text
extractEmail --filter body="urgent meeting"

# Combine multiple filters
extractEmail --filter body="deadline" subject="Report"

# Find emails with attachments (first match)
extractEmail --filter attachment=true
```

**Features:**
- Uses the same filter arguments as `-a` (`from=`, `subject=`, `body=`, `attachment=`)
- Does NOT download attachments (use `-a` for that)
- Outputs matching email info (number, from, subject)
- Useful for searching/finding emails before taking action

---

### `--filter:bool`

Check if any email matches filter criteria and output `true` or `false`.

```bash
# Check if any email is from boss (outputs true/false)
extractEmail --filter:bool from="boss@work.com"

# Check if "urgent" appears in any email body
extractEmail --filter:bool body="urgent"

# Check last 50 emails for specific subject
extractEmail --filter:bool subject="Invoice" 50

# Combine multiple filters
extractEmail --filter:bool body="deadline" from="project@"
```

**Behavior:**
- Outputs `true` and **stops immediately** when a match is found
- Outputs `false` after checking all emails if no match
- Default count: 100 emails (customize with a number argument)
- Uses the same filter arguments as `--filter` (`from=`, `subject=`, `body=`, `attachment=`)

**Use Cases:**
- Conditional logic in shell scripts
- Automation triggers based on email content
- Quick existence checks before running tasks

**Example in a script:**
```bash
# Bash/shell example
if [ "$(extractEmail --filter:bool from="alert@system.com")" = "true" ]; then
  echo "Alert email received!"
  # Run some task...
fi
```

---

## Filter Arguments

Used with `-a, --attachment-download`, `--filter`, or `--filter:bool`:

### `from="email@domain.com"`

Filter by sender email address (partial match, case-insensitive).

```bash
# With attachment download
extractEmail -a from="boss@work.com"

# With filter mode (no download)
extractEmail --filter from="boss@work.com"
```

### `subject="pattern"`

Filter by subject text (partial match, case-insensitive).

```bash
# With attachment download
extractEmail -a subject="Monthly Report"

# With filter mode (no download)
extractEmail --filter subject="Monthly Report"
```

### `body="text"`

Filter by email body/message content (partial match, case-insensitive).

```bash
# Find emails mentioning a project
extractEmail --filter body="Project Alpha"

# Download attachments from emails containing specific text
extractEmail -a body="please find attached"

# Combine with other filters
extractEmail --filter body="urgent" from="boss@"
```

### `attachment=true`

Find first email that has any attachment.

```bash
# With attachment download
extractEmail -a attachment=true

# With filter mode (no download)
extractEmail --filter attachment=true
```

---

## Ignore Rules

### `-i, --ignore <rule>`

Ignore emails or attachments matching a pattern.

```bash
# Ignore by sender
extractEmail -i from="newsletter@"

# Ignore by subject
extractEmail -i subject="Unsubscribe"

# Ignore attachment types
extractEmail -i attachment="*.jpg"

# Multiple rules
extractEmail -i from="spam@" -i subject="[AD]"

# Bracket notation for multiple
extractEmail -i [from="spam@", attachment="*.tmp"]

# Array values for attachments
extractEmail -i attachment=["*.jpg","*.png","*.gif"]
```

**Supported Fields:**
- `from` - Sender email/name
- `subject` - Email subject
- `body` - Email body text
- `attachment` (alias: `att`) - Attachment filename

**Pattern Types:**
- Plain text: `"newsletter"` (substring match)
- Glob wildcards: `"*.jpg"`, `"report*.pdf"`
- Regex: `"{{ ^ADV: }}"` (wrapped in `{{ }}`)
- Date templates: `"{{ dates.year }}"` (see [Filter Templates](#filter-templates))

---

## Output Options

### `-o, --output-folder <path>`

Write output to a folder or file instead of stdout.

```bash
# Output to folder (creates extractEmail.response.txt)
extractEmail -o ./output subject 25

# Output to specific file (must not exist)
extractEmail -o ./output/results.txt body 10

# Attachment download to folder
extractEmail -a -n 5 -o ./downloads
```

**Behavior:**
- Directory path: Creates `extractEmal.response.txt` in that folder
- File path: File must not already exist
- Attachment downloads: Files saved to specified folder

---

### `-h, --help`

Display help message with usage information.

```bash
extractEmail --help
```

---

## Field Extraction Options

| Field | Description |
|-------|-------------|
| `from` | Extract sender addresses |
| `to` | Extract recipient addresses |
| `date` | Extract email dates |
| `subject` | Extract email subjects |
| `body` | Extract email body text (truncated to 200 chars by default) |
| `attachment` | Extract attachment names (or `false` if none) |
| `all` | Extract all fields (default) |

```bash
# Extract single field
extractEmail subject 50

# Multiple fields (use 'all')
extractEmail all 50
```

---

## Filter Templates

The `{{ }}` template syntax enables advanced pattern matching in filters.

### Regular Expression Patterns

```javascript
// Any email from invoices.com
fromPattern: "{{ .*@invoices\\.com }}"

// Subject with digits
subjectPattern: "{{ Invoice #[0-9]+ }}"

// Mixed literal and regex
subjectPattern: "Invoice {{ #[0-9]+ }}"
```

### Date Template Placeholders

| Placeholder | Example |
|-------------|---------|
| `{{ dates.year }}` | `2026` |
| `{{ dates.lastYear }}` | `2025` |
| `{{ dates.month }}` | `March` |
| `{{ dates.lastMonth }}` | `February` |
| `{{ dates.month.abbr }}` | `Mar` |
| `{{ dates.day }}` | `03` |
| `{{ dates.quarter }}` | `1` |

```javascript
// Match current year in subject
subjectPattern: "{{ dates.year }}"

// Match month and year
subjectPattern: "Report - {{ dates.month }} {{ dates.year }}"
```

---

## Multiple Account Setup

### 1. Configure accounts folder

Edit `config.json`:

```json
{
  "accountsFolder": "./accounts",
  "tasksFolder": "./extractEmailTasks"
}
```

### 2. Create account files

Create `accounts/work.mjs`:

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

### 3. Use with --config

```bash
extractEmail --config=work subject 50
```

**Naming Rules:**
- No spaces in filenames
- No special characters: `/ \ : * ? " < > |`
- Extension (`.mjs`) is optional in commands

---

## Testing Options

### `--test`

Run with mock email data (no real IMAP connection).

```bash
# Test all fields
node extractEmail.mjs --test

# Test specific extraction
node extractEmail.mjs --test subject 3

# Test task execution
node extractEmail.mjs --test stop
```

Uses sample emails from `test/mockImap.mjs`.
<!-- {% endraw %} -->