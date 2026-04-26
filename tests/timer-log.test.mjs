import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, makeTempDir, stripAnsi } from "./helpers.mjs";

function localIso(year, month, day, hour, minute, second = 0) {
  return new Date(year, month - 1, day, hour, minute, second, 0).toISOString();
}

function writeTimerTask(collectionPath) {
  const tasksDir = join(collectionPath, "tasks");
  mkdirSync(tasksDir, { recursive: true });
  writeFileSync(
    join(tasksDir, "Timer task.md"),
    `---
title: Timer task
status: open
priority: normal
dateCreated: '2026-02-22T00:00:00.000Z'
dateModified: '2026-02-22T00:00:00.000Z'
timeEntries:
  - startTime: '${localIso(2026, 2, 22, 21, 10)}'
    endTime: '${localIso(2026, 2, 22, 21, 30)}'
    description: before
  - startTime: '${localIso(2026, 2, 22, 21, 20, 30)}'
    endTime: '${localIso(2026, 2, 22, 21, 45)}'
    description: inside
  - startTime: '${localIso(2026, 2, 22, 21, 21)}'
    endTime: '${localIso(2026, 2, 22, 21, 50)}'
    description: after
type: task
---

`,
  );
}

test("timer log: supports hour and minute from/to filters", () => {
  const collectionPath = makeTempDir("mtn-timer-log-");

  let result = runCli(["init", collectionPath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  writeTimerTask(collectionPath);

  result = runCli([
    "--path",
    collectionPath,
    "timer",
    "log",
    "--from",
    "2026-02-22 21:11",
    "--to",
    "2026-02-22T21:20",
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const output = stripAnsi(result.stdout);
  assert.match(output, /inside/);
  assert.doesNotMatch(output, /before/);
  assert.doesNotMatch(output, /after/);
});
