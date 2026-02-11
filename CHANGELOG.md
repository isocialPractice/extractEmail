# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0]

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
