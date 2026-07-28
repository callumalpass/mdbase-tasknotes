# mdbase-tasknotes

Standalone CLI for managing markdown tasks via [mdbase](https://mdbase.dev). Create, query, and manage tasks directly on markdown files using natural language.

New collections use the mdbase v0.3 JSON Schema type format. Existing v0.2
TaskNotes collections remain supported, so the CLI can share a vault with the
[TaskNotes](https://github.com/callumalpass/tasknotes) Obsidian plugin during a
staged migration.

## Install

```
npm install -g mdbase-tasknotes
```

## Quick start

```bash
# Initialize a new collection
mtn init ~/notes

# Set as default collection
mtn config --set collectionPath=~/notes

# Create tasks with natural language
mtn create "Buy groceries tomorrow #shopping @errands"
mtn create "Write report due friday #work +quarterly-review"
mtn create "Fix the faucet high priority #home @house"

# List and query
mtn list
mtn list --overdue
mtn list --tag work --status open
mtn list --json

# Complete a task
mtn complete "Buy groceries"

# Track time
mtn timer start "Write report"
mtn timer status
mtn timer stop
mtn timer log --period today
```

## Commands

| Command | Description |
|---|---|
| `mtn init [path]` | Initialize a new collection with `mdbase.yaml` and `_types/task.md` |
| `mtn create <text...>` | Create a task from natural language |
| `mtn list` | List tasks with filters (`--status`, `--priority`, `--tag`, `--due`, `--overdue`, `--where`, `--on`, `--json`) |
| `mtn show <task>` | Show full task detail (`--on YYYY-MM-DD` for recurring instance state) |
| `mtn complete <task>` | Mark a task as done (`--date YYYY-MM-DD` for recurring instance completion) |
| `mtn update <task>` | Update fields (`--status`, `--priority`, `--due`, `--title`, `--add-tag`, `--remove-tag`) |
| `mtn delete <task>` | Delete a task (`--force` to skip backlink check) |
| `mtn archive <task>` | Add archive tag to a task |
| `mtn skip <task>` | Skip a recurring instance (`--date YYYY-MM-DD`, default today) |
| `mtn unskip <task>` | Unskip a recurring instance (`--date YYYY-MM-DD`, default today) |
| `mtn search <query>` | Full-text search across tasks |
| `mtn timer start\|stop\|status\|log` | Time tracking |
| `mtn projects [list\|show]` | List projects and their tasks |
| `mtn stats` | Aggregate statistics |
| `mtn interactive` | REPL with live NLP preview |
| `mtn config` | Manage CLI configuration (`--set`, `--get`, `--list`) |

Tasks can be referenced by file path or title. Titles are matched exactly first, then by substring.

## Natural language parsing

Task text is parsed using [tasknotes-nlp-core](https://github.com/callumalpass/tasknotes-nlp-core). Supported patterns:

- **Dates** — `tomorrow`, `friday`, `next week`, `2026-03-15`
- **Tags** — `#shopping`, `#work`
- **Contexts** — `@home`, `@office`
- **Projects** — `+quarterly-review`
- **Priority** — `high priority`, `urgent`
- **Recurrence** — `every day`, `weekly`, `every monday`
- **Estimates** — `~30m`, `~2h`

The parser reads status and priority values from your collection's
`_types/task.md`, so customizing the type definition changes what the parser
accepts. In v0.3, the type file declares that it `implements` the exact
`tasknotes.task` contract version. Its field map says how collection-specific
frontmatter becomes the portable TaskNotes task view, while its contract
binding holds TaskNotes behavior such as completed status values. Multiple
types can implement the same contract without requiring applications to know
their stored field names.

## Collection path

Resolved in order:

1. `--path` / `-p` flag
2. `MDBASE_TASKNOTES_PATH` environment variable
3. `collectionPath` in `~/.config/mdbase-tasknotes/config.json`
4. Current working directory

## Using with TaskNotes

If you use the [TaskNotes](https://github.com/callumalpass/tasknotes) Obsidian
plugin with mdbase export enabled, point `mtn` at the vault root. Both tools read
the same `mdbase.yaml`, task type, and Markdown records. Migrate copied data
first with the mdbase CLI; do not partially rewrite a live collection by hand.

`mtn` is a task-domain client, not a general saved-view executor. It reads
canonical `type: view` files as ordinary collection records through the shared
core but does not advertise `view_records`; use `mdbase view run` for portable
named-view execution.

## Creating Tasks With Custom Paths

The v0.3 `match.path_glob` and `collection.path.pattern` settings do
different jobs in `_types/task.md`:

- `match.path_glob` tells mdbase which existing files should be
  treated as tasks.
- `collection.path.pattern` tells `mtn create` where to write a new task file.

If your task type only has `match.path_glob`, listing existing tasks can work,
but creating a new task without an explicit path cannot choose a filename. Add
`collection.path.pattern` for creation:

```yaml
kind: mdbase.type
name: task
version: 1
schema:
  dialect: json-schema-2020-12
  value:
    type: object
    properties:
      title:
        type: string
match:
  path_glob: "calendar/**/*.md"
collection:
  path:
    pattern: "calendar/{{year}}/{{month}}-{{monthNameShort}}/{{titleKebab}}.md"
```

## License

MIT
