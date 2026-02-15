# mdbase-tasknotes

Standalone CLI for managing markdown tasks via [mdbase](https://mdbase.dev). Create, query, and manage tasks directly on markdown files using natural language.

Works on the same vault and `_types/task.md` schema that the [TaskNotes](https://github.com/callumalpass/tasknotes) Obsidian plugin generates, or can initialize its own standalone collection.

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
| `mtn list` | List tasks with filters (`--status`, `--priority`, `--tag`, `--due`, `--overdue`, `--where`, `--json`) |
| `mtn show <task>` | Show full task detail |
| `mtn complete <task>` | Mark a task as done |
| `mtn update <task>` | Update fields (`--status`, `--priority`, `--due`, `--title`, `--add-tag`, `--remove-tag`) |
| `mtn delete <task>` | Delete a task (`--force` to skip backlink check) |
| `mtn archive <task>` | Add archive tag to a task |
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

The parser reads status and priority values from your collection's `_types/task.md`, so customizing the type definition changes what the parser accepts.

## Collection path

Resolved in order:

1. `--path` / `-p` flag
2. `MDBASE_TASKNOTES_PATH` environment variable
3. `collectionPath` in `~/.config/mdbase-tasknotes/config.json`
4. Current working directory

## Using with TaskNotes

If you use the [TaskNotes](https://github.com/callumalpass/tasknotes) Obsidian plugin with mdbase spec generation enabled, `mtn` works directly on your vault — point it at your vault root and it will read the same `mdbase.yaml` and `_types/task.md` the plugin generates. Tasks created by either tool are visible to both.

## License

MIT
