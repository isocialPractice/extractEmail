# Examples

Common usage patterns and recipes for extractEmail.

## Basic Extraction

### View Recent Emails

```bash
# All fields from last 100 emails (default)
extractEmail

# Last 50 emails
extractEmail all 50

# Last 10 emails
extractEmail 10
```

### Extract Specific Fields

```bash
# Sender addresses
extractEmail from 25

# Recipient addresses
extractEmail to 25

# Email dates
extractEmail date 25

# Subjects only
extractEmail subject 50

# Body text (truncated to 200 chars)
extractEmail body 10

# Attachment names
extractEmail attachment 20
```

---

## Email Selection

### Get Specific Email by Number

```bash
# Most recent email (#1 = newest)
extractEmail -n 1

# Fifth most recent
extractEmail -n 5

# Tenth most recent
extractEmail -n 10
```

### Full Body Output

```bash
# Full body, not truncated (HTML sanitized to text)
extractEmail -f all 20

# Full body for specific email
extractEmail -f -n 3

# Full body subjects
extractEmail -f subject 20
```

### Raw HTML Output

```bash
# Preserve HTML structure
extractEmail --html all 20

# Raw HTML for specific email
extractEmail --html -n 1
```

---

## JSON Output

### Basic JSON

```bash
# JSON format
extractEmail --json all 10

# JSON for specific email
extractEmail --json -n 1

# Save to file
extractEmail --json all 20 -o ./output/emails.json
```

### Using with jq

```bash
# Extract subjects only
extractEmail --json all 10 | jq '.[].Subject'

# Get sender addresses
extractEmail --json all 10 | jq '.[].From'

# Filter by subject
extractEmail --json all 50 | jq 'to_entries | .[] | select(.value.Subject | contains("Invoice"))'

# Pretty print single email
extractEmail --json -n 1 | jq '.'
```

### Hierarchical JSON

```bash
# HTML heading structure
extractEmail --json:html -n 1

# Extract nested content
extractEmail --json:html -n 1 | jq '.["Email #1"].Body'
```

### Table JSON

```bash
# Extract table data only
extractEmail --json:table -n 1

# Get column data
extractEmail --json:table -n 1 | jq '.["Email #1"].Body.Field'
```

---

## Attachment Downloads

### By Email Number

```bash
# Download from specific email
extractEmail -a -n 1

# Download from email #5 to specific folder
extractEmail -a -n 5 -o ./downloads
```

### By Sender

```bash
# All emails from sender
extractEmail -a from="reports@company.com"

# Partial match
extractEmail -a from="company.com"
```

### By Subject

```bash
# Subject contains "Invoice"
extractEmail -a subject="Invoice"

# Subject contains "Report"
extractEmail -a subject="Monthly Report"
```

### First with Attachment

```bash
# First email with any attachment
extractEmail -a attachment=true

# To specific folder
extractEmail -a attachment=true -o ./downloads
```

---

## Multiple Accounts

### Basic Account Selection

```bash
# Use work account
extractEmail --config=work subject 50

# Use personal account
extractEmail --config=personal from 25

# Extension optional
extractEmail --config=work.mjs subject 50
```

### Combined with Tasks

```bash
# Work account with task
extractEmail --config=work --task=downloadAttachments 50

# Personal with attachment download
extractEmail --config=personal -a subject="Receipt"
```

---

## Task Execution

### Built-in Tasks

```bash
# Find "stop" requests
extractEmail stop 100

# Download attachments (legacy)
extractEmail downloadAttachments 50

# Verbose multi-task
extractEmail verbose 50
```

### Using --task Option

```bash
# Run custom task
extractEmail --task=myCustomTask 50

# With account
extractEmail --config=work --task=myCustomTask 25

# With output
extractEmail --task=myCustomTask -o ./output 50
```

### Task with Specific Email

```bash
# Run task on email #1
extractEmail --task=verbose -n 1

# Run task on email #5
extractEmail --task=downloadAttachments -n 5
```

---

## Ignore Rules

### Ignore by Sender

```bash
# Ignore newsletters
extractEmail -i from="newsletter@" subject 100

# Ignore multiple senders
extractEmail -i from="spam@" -i from="promo@" subject 100
```

### Ignore by Subject

```bash
# Ignore ads
extractEmail -i subject="[AD]" all 50

# Ignore automated emails
extractEmail -i subject="Auto-reply" all 50
```

### Ignore Attachment Types

```bash
# Ignore images
extractEmail -i attachment="*.jpg" -a subject="Report"

# Ignore multiple types
extractEmail -i attachment=["*.jpg","*.png","*.gif"] -a subject="Report"
```

### Combined Rules

```bash
# Bracket notation
extractEmail -i [from="newsletter@", subject="[AD]"] all 100
```

---

## Output Control

### Output to Folder

```bash
# Creates extractEmail.response.txt in folder
extractEmail -o ./output subject 50
```

### Output to File

```bash
# Specific filename (must not exist)
extractEmail -o ./output/subjects.txt subject 50
```

### Attachment Output

```bash
# Attachments to specific folder
extractEmail -a -n 5 -o ./my-downloads
```

---

## Filter Templates

### Date-Based Filtering (in tasks)

```javascript
// In task configuration
const FILTER_CONFIG = {
  // Current year
  subjectPattern: "{{ dates.year }}",
  
  // Current month
  subjectPattern: "{{ dates.month }}",
  
  // Last month
  subjectPattern: "{{ dates.lastMonth }} Report"
};
```

### Regex Patterns (in tasks)

```javascript
// In task configuration
const FILTER_CONFIG = {
  // Any @example.com email
  fromPattern: "{{ .*@example\\.com }}",
  
  // Invoice with number
  subjectPattern: "{{ Invoice #[0-9]+ }}",
  
  // Mixed literal and regex
  subjectPattern: "Report {{ [0-9]{4} }}"
};
```

---

## Testing

### Test Mode

```bash
# Run with mock data
node extractEmail.mjs --test

# Test specific extraction
node extractEmail.mjs --test subject 3

# Test task
node extractEmail.mjs --test stop

# Test all fields
node extractEmail.mjs --test all 5
```

### Run Test Suite

```bash
npm test
```

---

## Automation Recipes

### Daily Report Download

```bash
# Create a batch/shell script
# daily-download.bat

extractEmail --config=work -a subject="Daily Report" -o ./reports
```

### Archive Old Emails

```bash
# Get subjects for review
extractEmail --config=archive subject 1000 -o ./archive-list.txt
```

### Invoice Processing

```bash
# Download invoices
extractEmail -a subject="Invoice" -o ./invoices

# Get invoice data as JSON
extractEmail --json:table subject="Invoice" 50 > invoices.json
```

### Unsubscribe Detection

```bash
# Find stop requests
extractEmail stop 500

# Or with verbose task
extractEmail --task=verbose 500
```

---

## Piping and Chaining

### With grep

```bash
# Filter output
extractEmail subject 100 | grep "Invoice"

# Count matches
extractEmail subject 100 | grep -c "Report"
```

### With head/tail

```bash
# First 10 lines
extractEmail subject 100 | head -10

# Last 10 lines
extractEmail subject 100 | tail -10
```

### With sort

```bash
# Sort subjects
extractEmail subject 100 | sort

# Unique subjects
extractEmail subject 100 | sort -u
```

---

## Error Recovery

### Connection Issues

```bash
# Retry with smaller batch
extractEmail subject 10

# Try different account
extractEmail --config=backup subject 50
```

### Timeout Adjustment

Edit your config file to increase timeout:

```javascript
export const configEmail = {
  imap: {
    // ... other settings
    authTimeout: 10000,  // Increase from 3000
  }
};
```

---

## Performance Tips

### Limit Email Count

```bash
# Default count varies by mode
extractEmail all        # 100 emails
extractEmail -f all     # 20 emails (full body)
extractEmail --json all # 20 emails
```

### Use Specific Fields

```bash
# Faster than 'all'
extractEmail subject 100
extractEmail from 100
```

### Filter Early

```bash
# With downloads, specify filters
extractEmail -a subject="Specific" -n 1
# vs scanning all emails
```
