<!-- {% raw %} -->
# CLI Options Reference

Complete reference for all extractEmail command-line options.

## Options Summary

| Option | Description |
|--------|-------------|
| `--config=<name>` | Use account config from accounts folder |
| `--task=<name>` | Run a custom task plugin from tasks folder |
| `-n, --number <num>` | Get a specific email by number |
| `--range <start-end>` | Get a range of emails (e.g. `5-10`) |
| `-f, --full-body` | Output complete body text (not truncated) |
| `--html` | Preserve raw HTML content in body output |
| `--json` | Output results in JSON format |
| `--json:html` | JSON with hierarchical structure from HTML DOM |
| `--json:table` | JSON with columnar format from HTML tables |
| `-a, --attachment-download` | Download attachments from matching emails |
| `--filter` | Find and display emails matching filter criteria |
| `--filter:bool` | Check if any email matches filters, output true/false |
| `--stop [N]` | Stop after N emails or N matches (default N=1 if omitted) |
| `--match [N]` | Output first N matching emails in normal format (default N=1) |
| `--count` | Output integer count of emails in set or matching filters |
| `--index` | Output position numbers of emails in set or matching filters |
| `--move <folder>` | Move matching emails to a named IMAP folder |
| `--check <folder>` | Search emails in a named IMAP folder instead of INBOX |
| `-i, --ignore <rule>` | Ignore emails or attachments matching a pattern |
| `-o, --output-folder <path>` | Write output to a folder or file |
| `-h, --help` | Display help message |
| `--test` | Run with mock email data (no IMAP connection) |
| `[count]` | Digit to specify the number of emails to extract |

### Filter Arguments

| Argument | Description |
|----------|-------------|
| `from="email@domain"` | Filter by sender email (partial, case-insensitive) |
| `sender="email@domain"` | Filter by actual sender via Return-Path header (partial, case-insensitive) |
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

### `--range <start-end>`

Extract a specific range of emails by number. Email #1 is the most recent.

```bash
# Get emails 5 through 10
extractEmail --range 5-10

# Equals sign syntax also works
extractEmail --range=5-10

# Open-ended: from #50 to the very last email
extractEmail --range 50-
extractEmail --range 50-last

# Combine with JSON output
extractEmail --json --range 3-8

# Open-ended with task
extractEmail --config=work --task=myTask --range 50-
```

**Features:**
- Always outputs full body content (not truncated)
- Body text is automatically sanitized (HTML converted to readable text)
- Outputs each email with its actual number (e.g. `=== Email #5 ===`)
- End of range is clamped to total email count if it exceeds it
- `50-` or `50-last` extracts from #50 to the very last email (open-ended)
- Supports field extraction (`from`, `subject`, `body`, `all`, etc.) and `--task`
- Filter criteria (`from=`, `subject=`, `body=`) narrow output without a flag
- Can be combined with `--filter`, `--filter:bool`, `-a`, and `-i`
- Can be combined with `--json`, `--json:html`, or `--json:table`

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

### `--stop [N]`

Stop processing after N emails (standard mode) or N matching emails (filter mode).

```bash
# Stop after the first email processed (N defaults to 1)
extractEmail --stop subject 50

# Stop after processing 3 emails
extractEmail --stop 3 subject 50

# With filter: stop after finding 2 matching emails
extractEmail --filter subject="Invoice" --stop 2

# With attachment download: download from up to 3 matching emails
extractEmail -a subject="Report" --stop 3

# Equals sign syntax also works
extractEmail --stop=5 all 100
```

**Behavior:**
- In **standard mode** (no filter flag): stops after N emails have been output, regardless of content
- In **filter mode** (`--filter`, `-a`, `--move`, `--range` with filters): stops after N matching emails are found and processed
- `N` is optional — when `--stop` is passed without a number, it defaults to `1` (stop after the first)
- Supports space-separated (`--stop 3`) and equals-sign (`--stop=3`) syntax
- Works with `--range`, `--filter`, `-a`, `--move`, `--task`, and all field extraction modes

**Use Cases:**
- Early exit when you only need the first N results
- Limit attachment downloads to the N most recent matching emails
- Quick preview of the newest email without processing the full count

---

### `--match [N]`

Find and output the first N emails matching filter criteria in normal full-block format (same as standard extraction output). Defaults to `N=1` when no argument is given.

```bash
# Output the first matching email in normal format (N defaults to 1)
extractEmail --match

# Output first 3 emails matching body filter (searches default 100)
extractEmail --filter body="some pattern" --match 3

# Output first 2 matches — search ALL emails in the inbox
extractEmail --filter body="some pattern" --match 2 all

# Output first 3 matches within a specific range
extractEmail --filter body="some pattern" --match 3 --range 100-200

# Output first 3 matches from 20 emails, running a task on each match
extractEmail --filter body="some pattern" --match 3 20 --task=taskName
```

**Behavior:**
- Without filter criteria: outputs the first N emails in normal format (equivalent to `--stop N`)
- With filter criteria (`from=`, `subject=`, `body=`, `attachment=`): skips non-matching emails and outputs the first N matches in normal block format
- Output format is identical to standard extraction — full `=== Email #N ===` blocks with all requested fields
- `N` is optional — when `--match` is passed without a number, it defaults to `1`
- Supports space-separated (`--match 3`) and equals-sign (`--match=3`) syntax
- Append `all` as a positional argument to search the entire inbox instead of the default 100-email limit
- Works with `--range` to restrict the search to a specific range of emails
- Works with `--task` to run a task on each matched email
- Overrides `--filter` summary output — matching emails are shown in full block format, not as "Found matching email #N" summaries

**Difference from `--filter` + `--stop`:**
- `--filter ... --stop N` uses the `--filter` summary output format (`Found matching email #N: ...`)
- `--match N` always uses the normal extraction output format (`=== Email #N ===` blocks)

**Output example** (`extractEmail --filter body="invoice" --match 2`):
```
=== Email #3 ===
From: billing@company.com
Subject: Invoice for March
Body: Please find attached your invoice...

=== Email #7 ===
From: vendor@supplier.com
Subject: Your invoice is ready
Body: Your monthly invoice has been generated...
```

---

### `--count`

Output a single integer representing the number of emails in the checked set or the number that match the specified filter criteria. No other output is produced.

```bash
# Count emails in the default set (first 100)
extractEmail --count

# Count emails with "Invoice" in subject (from default 100)
extractEmail --count subject="Invoice"

# Count matching emails from the entire inbox (all emails, not just 100)
extractEmail --count from="boss@work.com" all

# Count matching emails within a specific range
extractEmail --count body="urgent" --range 100-200
```

**Behavior:**
- Without filter criteria: outputs the total number of emails in the checked set
- With filter criteria (`from=`, `subject=`, `body=`, `attachment=`): outputs the count of matching emails
- Append `all` as a positional argument to scan the entire inbox instead of the default 100-email limit
- Works with `--range` to count within a specific range of emails
- Takes priority over all other output modes (`--filter`, `--json`, etc.)

**Output format:** A plain integer on a single line, e.g. `42`

---

### `--index`

Output the position numbers (1-based, newest-first) of emails in the checked set or matching filter criteria. Designed to identify which numbers to pass to `-n`.

```bash
# List positions of all emails in the default set (first 100)
extractEmail --index

# List positions of emails with "Invoice" in subject
extractEmail --index subject="Invoice"

# List positions of matching emails from the entire inbox
extractEmail --index from="boss@work.com" all

# List positions of matching emails within a specific range
extractEmail --index body="urgent" --range 100-200
```

**Behavior:**
- Without filter criteria: outputs all positions in the checked set (e.g. `1,2,3,...,100`)
- With filter criteria (`from=`, `subject=`, `body=`, `attachment=`): outputs only the positions of matching emails
- Output is a comma-separated list of integers on a single line
- Append `all` as a positional argument to scan the entire inbox instead of the default 100-email limit
- Works with `--range` to list positions within a specific range of emails
- Position numbers match those used by `-n` — Email #1 is the most recent

**Output format:** A comma-separated list of integers, e.g. `4,60` (or `1,2,3,...,100` without filters)

**Output when no matches:** An empty line

**Use Cases:**
- Preview which email numbers match a filter before fetching with `-n`
- Build scripts that loop over matching emails by number

---

### `--move <folder>`

Move emails matching filter criteria to a named IMAP folder on the server.

```bash
# Move emails with "invoice" in body to the invoices folder
extractEmail --move invoices body="invoice"

# Move last 20 matching emails
extractEmail --move invoices body="invoice" 20

# Move matching emails within a range (folder names with spaces need quotes)
extractEmail --move "invoiced bills" body="invoice" --range 5-10

# Combine with from= filter
extractEmail --move invoices from="billing@company.com"
```

**Behavior:**
- Verifies the folder exists on the IMAP server before processing
- Outputs `Folder "<name>" does not exist` and stops if the folder is not found
- Moves each matching email and logs: `Moved email #N to "<folder>": "<subject>"`
- Requires filter criteria (`from=`, `subject=`, `body=`, or `attachment=`)
- Supports `[count]` and `--range` to limit which emails are checked
- Can be combined with `--filter` to also show matching email details

**Error Example:**
```
Folder "invoiced bills" does not exist
```

---

### `--check <folder>`

Search emails in a named IMAP folder instead of the default INBOX.

```bash
# Extract subjects from the Sent folder
extractEmail --check "Sent" subject 20

# Get emails #10-20 from the Sent folder with full body
extractEmail --check "Sent" --range 10-20

# Find emails containing "invoice" in the Archive folder
extractEmail --check "Archive" --filter body="invoice"

# Run a task against emails in a custom folder
extractEmail --check "Reports" --task=myTask 50
```

**Behavior:**
- Validates the folder exists on the IMAP server before processing
- Outputs `Folder "<name>" does not exist` and stops if the folder is not found
- Works with all extraction options: `--range`, `--filter`, `--filter:bool`, `-a`, `--task`, `--json`, etc.
- Folder names are matched case-insensitively; nested paths are searched recursively

**Error Example:**
```
Folder "Archive" does not exist
```

---

Used with `-a, --attachment-download`, `--filter`, `--filter:bool`, or `--move`:

### `from="email@domain.com"`

Filter by sender email address (partial match, case-insensitive).

```bash
# With attachment download
extractEmail -a from="boss@work.com"

# With filter mode (no download)
extractEmail --filter from="boss@work.com"
```

### `sender="email@domain.com"`

Filter by the actual sender via the Return-Path header (partial match, case-insensitive). The Return-Path (envelope sender) may differ from the From header when the sending address is not the author address.

```bash
# Find emails where the actual sender differs from From
extractEmail --filter sender="mailer@example.com"

# Combine with from= for precise matching
extractEmail --filter from="admin@example.com" sender="mailer@example.com"

# Use with --filter:bool for conditional checks
extractEmail --filter:bool sender="noreply@example.com"
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