<!-- {% raw %} -->
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.6.0]

### Added

- `--stop` option to halt processing after the first matching email is found
- `--count` option to output the total number of matching emails without processing them
- `--match` option to filter emails by a pattern and output only those that match
- `--index` option to target a specific email by its index position
- New `helpers/emailChain.mjs` helper for parsing and working with email chain/thread data
- Helper variable support in `extractEmailTasks/verbose.js.template` for use in task configuration

### Changed

- Improved `helpers/narrowRequestedData.js` and `helpers/filterHelper.mjs` for more accurate narrowing and filtering of email data

## [2.5.0]

### Added

- `--check` option to inspect emails and report matches without downloading or processing
  - Outputs a summary of matching emails (number, from, subject, date)
  - Non-destructive — no emails are moved, downloaded, or modified
- `--range <start-end>` option to process a specific range of emails by number
  - Accepts start and end as inclusive bounds (e.g., `--range 5-15`)
  - Works in combination with other flags such as `-a`, `--task`, and `--filter`
- `--move <folder>` option to move processed emails to a specified IMAP folder after processing
  - Supports any valid IMAP folder path (e.g., `Processed`, `Archive/2026`)
  - Can be combined with `--task` and `-a` for post-processing organization

### Changed

- Added a doing-work indicator during long-running operations to provide visual feedback that processing is active
- Email processing operations now run as background processes to prevent blocking when handling large mailboxes
- Default behaviour no longer includes the `Sent` folder when searching or listing emails
  - Previously all IMAP folders including `Sent` were included by default
  - Use an explicit folder argument to include `Sent` when needed

## [2.4.0]

### Added

- `--filter` option to find and display emails matching filter criteria without downloading
  - Outputs matching email info (number, from, subject)
  - Uses same filter arguments as `-a` (`from=`, `subject=`, `body=`, `attachment=`)
- `--filter:bool` option for conditional logic in scripts
  - Outputs `true` and stops immediately when a match is found
  - Outputs `false` after checking all emails (default: 100) if no match
  - Useful for automation triggers and existence checks
- `body=` filter argument for filtering by email body/message content
  - Works with `-a`, `--filter`, and `--filter:bool`
  - Partial match, case-insensitive
- Test suites for `--filter`, `--filter:bool`, and `body=` filter functionality

## [2.3.0]

### Added

- Dedicated `docs/` folder with comprehensive documentation:
  - `quickstart.md` — get up and running in minutes with installation, configuration, and first commands
  - `options.md` — complete CLI options reference with detailed explanations and examples
  - `tasks.md` — full task system guide including built-in tasks, custom task creation, and verbose task configuration
  - `mapping-tasks.md` — mapping configuration guide for document resolution, date syntax, and file pattern matching
  - `helper-scripts.md` — helper scripts documentation covering dateHelper, filterHelper, and narrowRequestedData
  - `scripts.md` — external script execution guide with SCRIPT_CONFIG, template variables, and cross-platform examples
  - `examples.md` — common usage patterns and recipes for extraction, JSON output, attachments, and automation
- `helpers/narrowRequestedData.js` — natural language email parser with mapping configuration support
  - CLI parameter support: `-f/--file` for file input, `-m/--map` for mapping config, `--demo-map` for demo mode
  - Recipient pattern matching: "send me", "send [Name]", "send [department]", "email to", "forward to", etc.
  - Document type detection from natural language (invoice, report, statement, etc.)
  - Date range extraction from phrases like "last 3 months", "past two weeks", "from January to March"
  - JSON mapping configuration system for document-to-file resolution
  - Custom date syntax parser: `{% date(<format>) %}` with codes `<mm>`, `<dd>`, `<yy>`, `<yyyy>`, `<MONTH>`, etc.
  - File scanning with date range filtering and pattern matching
  - `%requestor%` special syntax for dynamic sender-based file matching
- `config/mapRequestedData/` directory for mapping configuration files
  - `example.json.template` — generic mapping template demonstrating document type to folder/file resolution
  - `README.md` — comprehensive 3-step integration guide for mapping system
- `{mapConfig}` template variable support in `extractEmailTasks/verbose.js.template` for passing mapping config to scripts
- Test suite for mapping functionality in `test/test-mapping.mjs`

### Changed

- Improved documentation consistency across all markdown files
- `helpers/narrowRequestedData.js` converted from CommonJS to ES module syntax
- Script templates (`example.bat.template`, `example.sh.template`) updated with `-m` flag usage examples

## [2.2.0]

### Added
- `extractEmailTasks/verbose.js.template` — flexible multi-task email processing template
  - Supports single task or array of tasks executed in sequence via `taskDoes` configuration
  - Five built-in task types:
    - `download-attachments` — download email attachments to output folder
    - `check-header-stop` — detect unsubscribe requests with "stop" in subject
    - `run-script` — execute external batch files, shell scripts, or executables
    - `log-email` — output email details to console
    - `custom` — run user-defined custom handler functions
  - `FILTER_CONFIG` for email filtering by sender, subject, body text, and attachment requirements
  - `SCRIPT_CONFIG` for external script execution with template variable substitution
    - Template variables: `{from}`, `{subject}`, `{body}`, `{date}`
    - Full email body extraction from parsed message (includes forwarded content)
    - Body normalization with literal `\n` markers for sed/awk post-processing
    - Project-relative path resolution (scripts work when running from any directory)
    - Windows batch file support with proper cmd.exe special character escaping (`< > | & ^ %`)
  - `CUSTOM_HANDLER` function for advanced custom processing logic
- Example script templates:
  - `scripts/example.sh.template` — bash script template
  - `scripts/example.bat.template` — Windows batch file template
- Comprehensive test suite for verbose task with 6 test cases

### Changed
- Script execution now uses `spawnSync` with proper argument escaping instead of `execSync`
- Windows batch files executed with `shell: true` and caret-escaped special characters

### Fixed
- Script paths resolve relative to project directory instead of current working directory
- Special characters in email addresses (angle brackets) properly escaped for cmd.exe

## [2.1.0]

### Added
- `{{ }}` template syntax for task filter patterns — wrap a regex in `{{ expr }}` for full regex
  matching; wrap a date placeholder like `{{ dates.year }}` for auto-resolved literal date values
- `helpers/dateHelper.mjs` — provides `getDateValues()` mapping all
  `{{ dates.* }}` placeholders to their current values via `@jhauga/getDate`
- `helpers/filterHelper.mjs` — provides `resolveFilterPattern()` and
  `testPattern()` for template-aware filter evaluation in tasks
- `@jhauga/getdate` dependency for cross-platform date retrieval in filter templates
- `-i, --ignore <rule>` option to ignore emails or attachments matching a pattern
  - Supports glob wildcards (`*.jpg`), `{{ regex }}`, and `{{ dates.* }}` templates
  - Fields: `from`, `subject`, `body`, `attachment` (alias: `att`)
  - Multiple rules via repeated `-i` flags or bracket notation `-i [field="pat", ...]`
  - Array values: `-i attachment=["*.jpg","*.png"]`
  - Attachment ignore works universally with built-in download and task files (via Proxy wrapper)

### Changed
- Email processing now iterates newest-first (Email #1 is fetched and processed first, not last)
- `--task` combined with `-a` now routes correctly through the task's own attachment logic
  instead of the built-in CLI attachment handler
- `--task` combined with `-n <num>` now runs the task against that specific email instead of
  outputting the email directly
- Moved `extractEmailTasks/helpers/` to `helpers/` at project root for shared access
  across main script and task files

### Fixed
- Task filter patterns using `resolveFilterPattern()` now return a backwards-compatible object
  with `.toLowerCase()` so existing task files using old-style string comparisons continue to work
- `-a` flag no longer bypasses `--task` execution (tasks with their own download logic now run)
- `-n` flag no longer bypasses `--task` execution (task runs against the specific email)
- Attachment summary now correctly filtered by `-i` rules in `-n` specific email path

## [2.0.0]

Releasing version `2.0.0` as new options and improved handling of output merit a major version update.

### Added

- `--json:[argument]` flag to convert the output to JSON format
- `--html` flag to extract body as HTML
- Format HTML table output as quasi-markdown

### Changed

- Improved handling of HTML in body output

## [1.0.0]

### Added
- `-n, --number <num>` flag to get a specific email by number with full body content
- `-f, --full-body` flag to output full body message instead of truncated preview
- `-a, --attachment-download` flag for direct attachment download from command line
- Filter arguments for attachment downloads: `from="email"`, `subject="pattern"`, `attachment=true`
- Email numbering from newest to oldest (Email #1 = most recent)
- Body text truncation to 200 characters by default for better performance
- Improved HTML email parsing with fallback to text/plain
- Better nested structure handling for multipart emails

### Changed
- Default email count reduced to 20 when using `-f, --full-body` for better performance
- Attachment detection improved with connection re-fetch capability
- Email display numbers now show in reverse order (newest first)

### Fixed
- Nested array handling in IMAP struct parsing for attachments
- HTML part extraction for emails without text/plain parts
- Body content retrieval with multiple fallback strategies

## [0.0.0] - Initial Repository

### Added
- Extract email fields (from, to, date, subject, body, attachment) from IMAP accounts
- Support for multiple email account configurations
- Extensible task plugin system for custom email processing
- Built-in `stop` task to find emails with "stop" in subject
- Built-in `downloadAttachments` task with configurable filters
- Test mode with mock IMAP data
- Output to file or folder with `-o, --output-folder` flag
- Account selection with `--config` flag
- Task execution with `--task` flag
<!-- {% endraw %} -->