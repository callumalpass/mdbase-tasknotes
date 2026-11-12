import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { makeTempDir, runCli } from './helpers.mjs';

// A TaskNotes v5 collection (mdbase spec 0.3) whose task type renames fields
// through its `implements` binding, as TaskNotes does for custom field names.
const RENAMED = {
  scheduled: 'date_scheduled',
  completedDate: 'date_completed',
  completeInstances: 'complete_instances',
  skippedInstances: 'skipped_instances',
};

function readFrontmatter(filePath) {
  const match = readFileSync(filePath, 'utf8').match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  assert.ok(match, `${filePath} must contain YAML frontmatter`);
  return YAML.parse(match[1]);
}

function makeRenamedCollection({ archivedTag } = {}) {
  const root = makeTempDir('mtn-v03-implements-');
  const init = runCli(['init', root]);
  assert.equal(init.status, 0, init.stderr || init.stdout);

  const typePath = join(root, '_types/task.md');
  const document = readFileSync(typePath, 'utf8');
  const match = document.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(match, 'generated task type must have frontmatter');
  const type = YAML.parse(match[1]);

  const properties = type.schema.value.properties;
  const implementation = type.implements.find((i) => i.contract === 'tasknotes.task');
  for (const [role, field] of Object.entries(RENAMED)) {
    const current = implementation.fields[role];
    assert.ok(current in properties, `generated schema must define ${current}`);
    properties[field] = properties[current];
    delete properties[current];
    implementation.fields[role] = field;
  }
  if (archivedTag !== undefined) {
    implementation.binding.archive = { archived_tag: archivedTag };
  }
  writeFileSync(typePath, `---\n${YAML.stringify(type)}---\n${match[2]}`);

  writeFileSync(
    join(root, 'tasks/Water plants.md'),
    [
      '---',
      'title: Water plants',
      'status: open',
      'priority: normal',
      'date_scheduled: 2026-11-02',
      'recurrence: FREQ=WEEKLY;BYDAY=MO',
      'dateCreated: 2026-10-01T09:00:00.000Z',
      'type: task',
      '---',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'tasks/File taxes.md'),
    [
      '---',
      'title: File taxes',
      'status: open',
      'priority: normal',
      'dateCreated: 2026-10-01T09:00:00.000Z',
      'type: task',
      '---',
      '',
    ].join('\n'),
  );
  return root;
}

function assertNoDefaultNames(frontmatter) {
  for (const role of Object.keys(RENAMED)) {
    assert.equal(role in frontmatter, false, `must not write default field ${role}`);
  }
}

test('v0.3 implements mapping: create, update and complete write the bound field names', () => {
  const root = makeRenamedCollection();

  let result = runCli(['create', '--path', root, 'Buy milk tomorrow']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const created = readFrontmatter(join(root, 'tasks/Buy milk.md'));
  assert.match(String(created.date_scheduled), /^\d{4}-\d{2}-\d{2}$/);
  assertNoDefaultNames(created);

  result = runCli(['update', '--path', root, 'Buy milk', '--scheduled', '2026-12-01']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const updated = readFrontmatter(join(root, 'tasks/Buy milk.md'));
  assert.equal(String(updated.date_scheduled), '2026-12-01');
  assertNoDefaultNames(updated);

  result = runCli(['complete', '--path', root, 'File taxes', '--date', '2026-11-10']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const completed = readFrontmatter(join(root, 'tasks/File taxes.md'));
  assert.equal(completed.status, 'done');
  assert.equal(String(completed.date_completed), '2026-11-10');
  assertNoDefaultNames(completed);
});

test('v0.3 implements mapping: completing one recurring instance', () => {
  const root = makeRenamedCollection();
  const taskPath = join(root, 'tasks/Water plants.md');

  let result = runCli(['complete', '--path', root, 'Water plants', '--date', '2026-11-09']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /next 2026-11-16/);

  let task = readFrontmatter(taskPath);
  assert.equal(task.status, 'open', 'the series stays open');
  assert.deepEqual(task.complete_instances.map(String), ['2026-11-09']);
  assert.equal(String(task.date_scheduled), '2026-11-16');
  assert.equal('date_completed' in task, false);
  assertNoDefaultNames(task);

  result = runCli(['complete', '--path', root, 'Water plants', '--date', '2026-11-09']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /already completed on 2026-11-09/);
  task = readFrontmatter(taskPath);
  assert.deepEqual(task.complete_instances.map(String), ['2026-11-09']);
});

function archiveAndRead(root) {
  const result = runCli(['archive', '--path', root, 'File taxes']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return readFrontmatter(join(root, 'tasks/File taxes.md'));
}

test('archive adds the archived_tag the type binds', () => {
  const root = makeRenamedCollection({ archivedTag: 'cold-storage' });

  const task = archiveAndRead(root);
  assert.deepEqual(task.tags, ['cold-storage']);

  // Archiving again is a no-op, and list hides the task by default.
  const again = archiveAndRead(root);
  assert.deepEqual(again.tags, ['cold-storage']);
  const listed = runCli(['list', '--path', root, '--json']);
  assert.equal(listed.status, 0, listed.stderr || listed.stdout);
  const paths = JSON.parse(listed.stdout).map((t) => t.path);
  assert.equal(paths.includes('tasks/File taxes.md'), false);
  assert.equal(paths.includes('tasks/Water plants.md'), true);
});

test('archive keeps the "archive" tag for a v0.2 type, which binds none', () => {
  const root = makeTempDir('mtn-v02-archive-');
  mkdirSync(join(root, '_types'), { recursive: true });
  mkdirSync(join(root, 'tasks'), { recursive: true });
  writeFileSync(
    join(root, 'mdbase.yaml'),
    ['spec_version: "0.2.0"', 'settings:', '  types_folder: "_types"', ''].join('\n'),
  );
  writeFileSync(
    join(root, '_types/task.md'),
    [
      '---',
      'name: task',
      'match:',
      '  path_glob: "tasks/**/*.md"',
      'fields:',
      '  title: { type: string, required: true }',
      '  status: { type: enum, values: [open, done], default: open }',
      '  tags: { type: list, items: { type: string } }',
      '---',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(root, 'tasks/File taxes.md'),
    ['---', 'title: File taxes', 'status: open', '---', ''].join('\n'),
  );
  assert.deepEqual(archiveAndRead(root).tags, ['archive']);
});
