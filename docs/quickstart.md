# Quickstart Guide

Get up and running with extractEmail in minutes.

## Prerequisites

- Node.js 16.x or higher
- npm (comes with Node.js)
- Access to an IMAP email account

## Installation

### 1. Clone and Install

```bash
git clone <repository-url>
cd extractEmail
npm install
```

### 2. Make Command Available Globally (Optional)

```bash
npm link
```

This allows you to run `extractEmail` from any directory.

## Configuration

### Step 1: Create Your Configuration File

Copy the template to create your configuration:

```bash
cp configEmailExtraction.mjs.template configEmailExtraction.mjs
```

### Step 2: Add Your IMAP Credentials

Edit `configEmailExtraction.mjs` with your email provider's settings:

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

### Common IMAP Settings

| Provider | Host | Port |
|----------|------|------|
| Gmail | imap.gmail.com | 993 |
| Outlook/Office 365 | outlook.office365.com | 993 |
| Yahoo | imap.mail.yahoo.com | 993 |
| iCloud | imap.mail.me.com | 993 |

> **Note:** For Gmail and some other providers, you may need to enable "Less secure app access" or create an App Password.

## Your First Commands

### View Recent Emails

```bash
# View all fields from the last 100 emails
extractEmail

# View just subjects from the last 50 emails
extractEmail subject 50
```

### Get a Specific Email

```bash
# Get the most recent email with full body
extractEmail -n 1

# Get email #5 with full content
extractEmail -n 5
```

### Extract Specific Fields

```bash
# Get sender addresses
extractEmail from 10

# Get email dates
extractEmail date 10

# Get attachment names
extractEmail attachment 10
```

### Output Formats

```bash
# Default text format
extractEmail subject 10

# JSON format for programmatic use
extractEmail --json all 10

# Full body (not truncated)
extractEmail -f all 10
```

## Test Without Real Credentials

Use the built-in test mode to explore features without configuring IMAP:

```bash
# Run with mock email data
node extractEmail.mjs --test

# Test specific extractions
node extractEmail.mjs --test subject 3

# Test task execution
node extractEmail.mjs --test stop
```

## Next Steps

- **[Options Reference](options.md)** - Complete CLI options documentation
- **[Tasks Guide](tasks.md)** - Learn about the task plugin system
- **[Examples](examples.md)** - Common usage patterns and recipes
- **[Mapping Tasks](mapping-tasks.md)** - Advanced mapping configuration

## Troubleshooting

### Connection Errors

- Verify your IMAP host and port settings
- Check that your email provider allows IMAP access
- For Gmail, enable IMAP in Gmail settings and use an App Password

### Authentication Errors

- Double-check your username and password
- Some providers require full email address as username
- Check if 2FA requires an App Password

### Timeout Errors

- Increase `authTimeout` value in your config
- Check your network connection
- Verify the IMAP server is accessible

## Getting Help

```bash
# Show help message
extractEmail --help
```
