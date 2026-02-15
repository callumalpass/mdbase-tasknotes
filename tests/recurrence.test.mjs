import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, makeTempDir, stripAnsi } from './helpers.mjs';

test('recurrence instance state: skip, unskip, complete by date', () => {
  const collectionPath = makeTempDir('mtn-recur-');

  let result = runCli(['init', collectionPath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCli(['create', '--path', collectionPath, 'Recurring checkin #work']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const taskPath = join(collectionPath, 'tasks', 'Recurring checkin.md');
  const original = readFileSync(taskPath, 'utf8');
  const updated = original.replace(
    'title: Recurring checkin\n',
    'title: Recurring checkin\nscheduled: \'2026-02-10\'\nrecurrence: FREQ=DAILY\n',
  );
  writeFileSync(taskPath, updated, 'utf8');

  result = runCli(['skip', '--path', collectionPath, 'Recurring checkin', '--date', '2026-02-11']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCli(['show', '--path', collectionPath, 'Recurring checkin', '--on', '2026-02-11']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(stripAnsi(result.stdout), /Instance \(2026-02-11\): skipped/);

  result = runCli(['unskip', '--path', collectionPath, 'Recurring checkin', '--date', '2026-02-11']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCli(['show', '--path', collectionPath, 'Recurring checkin', '--on', '2026-02-11']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(stripAnsi(result.stdout), /Instance \(2026-02-11\): open/);

  result = runCli(['complete', '--path', collectionPath, 'Recurring checkin', '--date', '2026-02-11']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCli(['show', '--path', collectionPath, 'Recurring checkin', '--on', '2026-02-11']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(stripAnsi(result.stdout), /Instance \(2026-02-11\): completed/);
});
