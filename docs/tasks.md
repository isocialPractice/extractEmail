<!-- {% raw %} -->
# Task System Guide

Tasks are custom plugins that process emails. They provide a powerful way to automate email-based workflows.

## Overview

Tasks are JavaScript modules in the `extractEmailTasks/` folder that export a default async function. When you run a task, extractEmail fetches emails and passes each one to your task function for processing.

## Running Tasks

### Using --task Option

```bash
# Run a task from the tasks folder
extractEmail --task=myTask 50

# Combine with account selection
extractEmail --config=work --task=myTask 25

# With output folder
extractEmail --task=myTask -o ./output 50
```

### Legacy Method (Direct Task Name)

```bash
# Built-in tasks can be called directly
extractEmail stop
extractEmail downloadAttachments
extractEmail verbose
```

## Built-in Tasks

### stop

Finds emails with "stop" in the subject line (unsubscribe detection).

```bash
extractEmail stop 100
```

**Use case:** Detect mailing list unsubscribe requests.

---

### downloadAttachments

Downloads attachments from emails matching configurable filter criteria.

```bash
extractEmail downloadAttachments 50
```

**Configuration:** Edit `extractEmailTasks/downloadAttachments.js`:

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

Set any filter to `null` to skip it. All specified filters must match.

---

### verbose

Flexible multi-task template supporting multiple task types in sequence.

```bash
extractEmail verbose 100
extractEmail --config=work verbose 50
```

**Configuration:** Edit `extractEmailTasks/verbose.js`:

```javascript
// Single task
const taskDoes = "log-email";

// Or array of tasks (executed in sequence)
const taskDoes = [
  "log-email",
  "download-attachments",
  "run-script"
];
```

**Available Task Types:**

| Type | Description |
|------|-------------|
| `download-attachments` | Download email attachments to output folder |
| `check-header-stop` | Check if subject contains "stop" |
| `run-script` | Execute external script with email data |
| `log-email` | Log email details to console |
| `custom` | Run user-defined handler function |

See [verbose Task Configuration](#verbose-task-configuration) for details.

---

## Creating Custom Tasks

### Step 1: Create the Task File

Create a new file in `extractEmailTasks/`:

```javascript
// extractEmailTasks/myTask.js

export default async function myTask(
  headersPart,       // Email headers object
  subject,           // Email subject string
  body,              // Email body text
  setVal,            // Helper function
  outputToTerminal,  // Output helper
  context            // Advanced context
) {
  // Your task logic here
}
```

### Step 2: Implement Your Logic

```javascript
// extractEmailTasks/myTask.js

export default async function myTask(
  headersPart,
  subject,
  body,
  setVal,
  outputToTerminal,
  context
) {
  // Check for specific criteria
  if (subject.toLowerCase().includes('urgent')) {
    outputToTerminal('subject', subject, 0);
    outputToTerminal('from', headersPart.from, 1);
    
    // Process the email
    console.log(`Urgent email from: ${headersPart.from}`);
  }
}
```

### Step 3: Register the Task (Optional)

Add to `taskSets` in `extractEmail.mjs` for help documentation:

```javascript
const taskSets = {
  "stop": "Get the number from STOP request...",
  "downloadAttachments": "Download attachments...",
  "myTask": "Description of what myTask does."
};
```

### Step 4: Run Your Task

```bash
extractEmail --task=myTask 50
```

---

## Task Function Parameters

### headersPart

Object containing parsed email headers:

```javascript
{
  from: "Sender Name <sender@example.com>",
  to: "recipient@example.com",
  subject: "Email Subject",
  date: "Mon, 09 Feb 2026 20:54:23 GMT"
}
```

### subject

The email subject as a string.

### body

The email body text (HTML sanitized to readable text).

### setVal(field, headersPart, subject, body)

Helper function to get a specific field value:

```javascript
const senderEmail = setVal('from', headersPart, subject, body);
const emailDate = setVal('date', headersPart, subject, body);
```

### outputToTerminal(field, value, index)

Helper to output formatted results:

```javascript
outputToTerminal('subject', subject, 0);
outputToTerminal('from', headersPart.from, 1);
```

Parameters:
- `field` - Label for the output
- `value` - Value to display
- `index` - Email index for formatting

### context

Advanced context object for complex operations:

```javascript
{
  connection,  // IMAP connection object
  msg,         // Raw message object
  __dirname    // Task directory path
}
```

---

## Verbose Task Configuration

The verbose task provides a flexible interface for common email actions.

### Task Types

#### download-attachments

Downloads all attachments from matching emails.

```javascript
const taskDoes = "download-attachments";
const FILTER_CONFIG = {
  requireAttachments: true  // Only process emails with attachments
};
```

#### check-header-stop

Detects unsubscribe requests with "stop" in the subject.

```javascript
const taskDoes = "check-header-stop";
```

#### run-script

Executes an external script with email data.

```javascript
const taskDoes = "run-script";

const SCRIPT_CONFIG = {
  scriptPath: "scripts/process-email.sh",
  scriptArgs: [
    "{from}",      // Template variable - sender
    "{subject}",   // Template variable - subject
    "{body}",      // Template variable - body
    "{date}"       // Template variable - date
  ],
  workingDir: null,
  continueOnError: false
};
```

**Template Variables:**
- `{from}` - Full sender string
- `{subject}` - Email subject
- `{body}` - Email body (normalized)
- `{date}` - Email date
- `{attachmentCount}` - Number of attachments
- `{mapConfig}` - Mapping configuration name

#### log-email

Outputs email details to console.

```javascript
const taskDoes = "log-email";
```

#### custom

Runs a user-defined handler function.

```javascript
const taskDoes = "custom";

const CUSTOM_HANDLER = (headersPart, subject, body, fullEmail, outputToTerminal) => {
  // Custom processing logic
  outputToTerminal("Custom", "Processing email", 0);
  
  // Return false to stop processing further tasks
  return true;
};
```

### Filter Configuration

```javascript
const FILTER_CONFIG = {
  // Filter by sender
  fromPattern: "reports@example.com",
  
  // Filter by actual sender from Return-Path header
  // Checks the Return-Path (envelope sender), which may differ from From
  sender: "mailer@example.com",
  
  // Filter by subject
  subjectPattern: "Monthly Report",
  
  // Filter by body text
  bodyPattern: "attached",
  
  // Only emails with attachments
  requireAttachments: false,
  
  // Mapping configuration file
  mapRequestedData: "Reports.json"
};
```

### Multi-Task Execution

Execute multiple tasks in sequence:

```javascript
const taskDoes = [
  "log-email",           // First: log the email
  "check-header-stop",   // Second: check for stop
  "download-attachments" // Third: download attachments
];
```

Tasks execute in order. If a task returns `false`, subsequent tasks are skipped.

---

## Filter Template Syntax

Filters support `{{ }}` template syntax for advanced matching.

### Regular Expressions

```javascript
// Any email from example.com
fromPattern: "{{ .*@example\\.com }}"

// Invoice followed by digits
subjectPattern: "{{ Invoice #[0-9]+ }}"

// Mixed literal and regex
subjectPattern: "Invoice {{ #[0-9]+ }}"
```

### Date Placeholders

```javascript
// Match current year
subjectPattern: "{{ dates.year }}"

// Match month and year
subjectPattern: "Report - {{ dates.month }} {{ dates.year }}"

// Match last month's report
subjectPattern: "{{ dates.lastMonth }} Report"
```

**Available Placeholders:**

| Placeholder | Example |
|-------------|---------|
| `{{ dates.year }}` | `2026` |
| `{{ dates.lastYear }}` | `2025` |
| `{{ dates.nextYear }}` | `2027` |
| `{{ dates.month }}` | `March` |
| `{{ dates.lastMonth }}` | `February` |
| `{{ dates.month.abbr }}` | `Mar` |
| `{{ dates.day }}` | `03` |
| `{{ dates.quarter }}` | `1` |
| `{{ dates.lastQuarter }}` | `4` |

---

## Task Examples

### Example 1: Forward Important Emails

```javascript
// extractEmailTasks/forwardImportant.js

export default async function forwardImportant(
  headersPart,
  subject,
  body,
  setVal,
  outputToTerminal,
  context
) {
  const urgentKeywords = ['urgent', 'asap', 'critical', 'emergency'];
  
  const isUrgent = urgentKeywords.some(keyword => 
    subject.toLowerCase().includes(keyword)
  );
  
  if (isUrgent) {
    outputToTerminal('URGENT', subject, 0);
    outputToTerminal('From', headersPart.from, 1);
    outputToTerminal('Date', headersPart.date, 2);
    
    // Log for external processing
    console.log(JSON.stringify({
      type: 'urgent',
      from: headersPart.from,
      subject: subject,
      date: headersPart.date
    }));
  }
}
```

### Example 2: Extract Invoice Data

```javascript
// extractEmailTasks/extractInvoices.js

export default async function extractInvoices(
  headersPart,
  subject,
  body,
  setVal,
  outputToTerminal,
  context
) {
  // Check if this is an invoice email
  if (!subject.toLowerCase().includes('invoice')) {
    return;
  }
  
  // Extract invoice number from subject
  const invoiceMatch = subject.match(/Invoice\s*#?\s*(\d+)/i);
  const invoiceNumber = invoiceMatch ? invoiceMatch[1] : 'Unknown';
  
  // Extract amount from body (pattern: $X,XXX.XX)
  const amountMatch = body.match(/\$[\d,]+\.\d{2}/);
  const amount = amountMatch ? amountMatch[0] : 'Not found';
  
  outputToTerminal('Invoice #', invoiceNumber, 0);
  outputToTerminal('Amount', amount, 1);
  outputToTerminal('From', headersPart.from, 2);
}
```

### Example 3: Auto-Archive Old Emails

```javascript
// extractEmailTasks/archiveOld.js

export default async function archiveOld(
  headersPart,
  subject,
  body,
  setVal,
  outputToTerminal,
  context
) {
  const emailDate = new Date(headersPart.date);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  if (emailDate < thirtyDaysAgo) {
    outputToTerminal('Archive', subject, 0);
    outputToTerminal('Date', headersPart.date, 1);
    
    // Log for archival processing
    console.log(`ARCHIVE: ${subject} (${headersPart.date})`);
  }
}
```

---

## Best Practices

1. **Handle errors gracefully** - Wrap operations in try/catch blocks
2. **Use outputToTerminal** - Consistent output formatting
3. **Filter early** - Check criteria before heavy processing
4. **Return early** - Skip emails that don't match
5. **Use context sparingly** - The context object is for advanced use
6. **Test with --test flag** - Validate before running on real emails
7. **Document your tasks** - Add to taskSets for help output
<!-- {% endraw %} -->