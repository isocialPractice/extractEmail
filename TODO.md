# extractEmail TODO

## Constant TODO Item(s)

- [ ] update `package.json` version from `X.Y.Z` to match corresponding major release, minor release, or minor change.

## Minor Updates

- [ ] add `--version` / `-v` flag to print current version and exit
- [ ] add `--mailbox <name>` flag to select a mailbox other than `INBOX`
- [ ] add `--since <date>` flag for filtering emails on or after a date
- [ ] add `--before <date>` flag for filtering emails before a date
- [ ] add `--from <pattern>` shorthand filter flag (currently requires a task)
- [ ] add `--subject <pattern>` shorthand filter flag
- [ ] confirm and document chaining multiple `-i` ignore rules in a single command
- [ ] add `--dry-run` flag for attachment downloads (list matched files without saving)
- [ ] add `--verbose` / `--debug` flag for detailed IMAP interaction output
- [ ] add `--quiet` flag to suppress non-essential terminal output
- [ ] show attachment download progress (e.g., `[2/5] saving invoice.pdf`)
- [ ] unify `--json`, `--json:html`, `--json:table` under a single `--output-format <mode>` flag
- [ ] support loading ignore rules from a file via `--ignore-file <path>`
- [ ] improve `--help` output to include short usage examples per flag

## Major Updates

- [ ] add OAuth2 / XOAUTH2 authentication support (Gmail, Outlook)
- [ ] add `--watch` / `--poll <interval>` mode to continuously monitor inbox
- [ ] add SMTP sending capability (reply, forward, compose new)
- [ ] add multi-folder support to search across multiple mailboxes in one run
- [ ] build an interactive TUI (terminal UI) email browser mode

### Major Updates Under Consideration

- [ ] Port to TypeScript

## Improve Upon Current Features

- [ ] improve `{{ }}` template syntax to support OR logic (e.g., `{{ val1 | val2 }}`)
- [ ] improve HTML-to-text sanitization for deeply nested and malformed table markup
- [ ] improve task error handling with structured error objects and meaningful exit codes
