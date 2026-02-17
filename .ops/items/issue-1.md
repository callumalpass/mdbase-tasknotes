---
id: 'github:callumalpass/mdbase-tasknotes:issue:1'
repo: callumalpass/mdbase-tasknotes
kind: issue
number: 1
remote_state: OPEN
remote_title: '`mdn timer log` doesn''t count time correctly'
remote_author: anomatomato
remote_url: 'https://github.com/callumalpass/mdbase-tasknotes/issues/1'
remote_updated_at: '2026-02-15T17:20:58Z'
last_seen_remote_updated_at: '2026-02-15T17:20:58Z'
local_status: done
priority: high
difficulty: easy
risk: low
sync_state: clean
type: item_state
command_id: triage-issue
last_analyzed_at: '2026-02-17T12:30:00Z'
summary: >
  Two bugs in `timer log` display. (1) Duration shows "0 minutes" because
  line 232 uses `entry.duration || 0` with no fallback calculation from
  startTime/endTime — entries without a stored `duration` field (e.g.
  created externally, or from before `duration` was persisted) always show
  0. (2) Task name shows "undefined" because line 193 reads
  `task.frontmatter.title` directly instead of using
  `resolveDisplayTitle()` with path fallback, so tasks whose title role
  maps to a custom field name (or archived tasks missing the field) render
  as "undefined".
notes: |
  ## Root Cause Analysis

  ### Bug 1 — Duration "0 minutes"
  - `duration` was stored as a cached field on TimeEntry but was unreliable
    (missing for externally-created entries, stale if times edited).
  - Display code used `entry.duration || 0` — always 0 when field absent.

  ### Bug 2 — Task name "undefined"
  - `task.frontmatter.title` used directly with no fallback.
  - Other commands (list, projects) use `resolveDisplayTitle()` correctly.

  ## Fix Applied
  - Removed `duration` from `TimeEntry` type entirely.
  - `timer stop` no longer writes `duration` to frontmatter.
  - All duration display (timer log, stats, format) now computes
    dynamically via `differenceInMinutes(endTime, startTime)`.
  - Timer log + status use `resolveDisplayTitle(fm, mapping) || task.path`
    for task names, matching list/projects behavior.
  - Files changed: `src/types.ts`, `src/commands/timer.ts`,
    `src/commands/stats.ts`, `src/format.ts`.
---

