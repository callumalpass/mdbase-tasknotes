import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli, makeTempDir, stripAnsi } from './helpers.mjs';

test('core flow: init/create/list/complete/stats', () => {
  const collectionPath = makeTempDir('mtn-core-');

  let result = runCli(['init', collectionPath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCli(['create', '--path', collectionPath, 'Buy groceries tomorrow #shopping @errands']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCli(['create', '--path', collectionPath, 'Write report due friday #work']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCli(['create', '--path', collectionPath, 'Fix sink #home']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCli(['list', '--path', collectionPath, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const listed = JSON.parse(result.stdout);
  assert.equal(listed.length, 3);

  result = runCli(['complete', '--path', collectionPath, 'Buy groceries']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCli(['list', '--path', collectionPath, '--status', 'open', '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const openOnly = JSON.parse(result.stdout);
  assert.equal(openOnly.length, 2);

  result = runCli(['stats', '--path', collectionPath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const clean = stripAnsi(result.stdout);
  assert.match(clean, /Total tasks:\s+3/);
  assert.match(clean, /Completion rate:\s+33%/);
});

test('create: parses standalone scheduled and start NLP triggers', () => {
  const collectionPath = makeTempDir('mtn-nlp-scheduled-');

  let result = runCli(['init', collectionPath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCli([
    'create',
    '--path',
    collectionPath,
    'Write report scheduled 2026-05-01 due 2026-05-13',
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCli([
    'create',
    '--path',
    collectionPath,
    'Draft outline start 2026-06-01 due 2026-06-13',
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCli(['list', '--path', collectionPath, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const listed = JSON.parse(result.stdout);
  const byTitle = new Map(listed.map((task) => [task.title, task]));

  assert.equal(byTitle.get('Write report')?.scheduled, '2026-05-01');
  assert.equal(byTitle.get('Write report')?.due, '2026-05-13');
  assert.equal(byTitle.get('Draft outline')?.scheduled, '2026-06-01');
  assert.equal(byTitle.get('Draft outline')?.due, '2026-06-13');
});

test('list: resolves natural-language due filters', () => {
  const collectionPath = makeTempDir('mtn-list-due-nlp-');

  let result = runCli(['init', collectionPath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCli(['create', '--path', collectionPath, 'Call Alex due tomorrow']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCli(['create', '--path', collectionPath, 'Submit invoice due 2026-05-13']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = runCli(['list', '--path', collectionPath, '--due', 'tomorrow', '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  let listed = JSON.parse(result.stdout);
  assert.deepEqual(listed.map((task) => task.title), ['Call Alex']);

  result = runCli(['list', '--path', collectionPath, '--due', 'May 13 2026', '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  listed = JSON.parse(result.stdout);
  assert.deepEqual(listed.map((task) => task.title), ['Submit invoice']);
});
