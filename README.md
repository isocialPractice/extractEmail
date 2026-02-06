# extractEmail ![icon.svg](icon.png)

A Node.js CLI tool to extract and process emails from IMAP accounts. Supports multiple account configurations and custom task plugins for extensible email processing.

## Features

- Extract email fields (from, to, date, subject, body, attachment) from IMAP accounts
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

> **⚠️ Security Note:** Configuration files contain sensitive credentials (passwords, email addresses). The `.gitignore` file prevents `accounts/`, `extractEmailTasks/`, and `configEmailExtraction.mjs` from being committed. Never use `git add -f` on these files or modify `.gitignore` to include them.

### Default Configuration

Create a `configEmailExtraction.mjs` file in the project root:

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
extractEmail [--config=<account>] [--task=<task>] [-o <path>] [option|task] [count]
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

### Options

| Option | Description |
|--------|-------------|
| `-h, --help` | Show help message |
| `from` | Extract sender addresses |
| `to` | Extract recipient addresses |
| `date` | Extract email dates |
| `subject` | Extract email subjects |
| `body` | Extract email body text |
| `attachment` | Extract attachment name(s) or false |
| `all` | Extract all fields (default) |
| `-o, --output-folder <path>` | Write output to a folder or file instead of stdout |

### Output Destination

When `-o, --output-folder` is provided:

- If the path is a directory, non-task output is written to `extractEmal.response.txt` in that folder (overwrites any existing file).
- If the path is a file, the file must not already exist and output is written there.

For attachment tasks, downloads default to the current working directory unless `-o` is provided.

### Examples

```bash
# Extract all fields from last 100 emails (default account)
extractEmail

# Extract subjects from last 50 emails
extractEmail subject 50

# Extract attachment names from last 10 emails
extractEmail attachment 10

# Extract sender addresses from last 25 emails using work account
extractEmail --config=work from 25

# Run a task using --task option
extractEmail --task=myTask 50

# Run a task with a specific account
extractEmail --config=work --task=myTask

# Write output to a folder
extractEmail -o ./output subject 25

# Write output to a specific file
extractEmail -o ./output/results.txt body 10

# Show help
extractEmail --help
```

## Task System

Tasks are custom plugins that process emails. They are located in the `extractEmailTasks/` folder.

### Built-in Tasks

| Task | Description |
|------|-------------|
| `stop` | Find emails with subject "stop" and output the sender |
| `downloadAttachments` | Download attachments from emails matching filter criteria |

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

## License

ISC
