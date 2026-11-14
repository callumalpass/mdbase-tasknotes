import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { makeTempDir, runCli } from './helpers.mjs';

function readFrontmatter(filePath) {
  const match = readFileSync(filePath, 'utf8').match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  assert.ok(match, `${filePath} must contain YAML frontmatter`);
  return YAML.parse(match[1]);
}

function writeTask(root, relativePath, title, extra = []) {
  const file = join(root, relativePath);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(
    file,
    ['---', `title: ${title}`, 'status: open', 'type: task', ...extra, '---', '', 'Body.', ''].join('\n'),
  );
}

/** TaskNotes' collection settings record, `_settings/dev.tasknotes.md`. */
function writeSettings(root, settings) {
  mkdirSync(join(root, '_settings'), { recursive: true });
  writeFileSync(
    join(root, '_settings/dev.tasknotes.md'),
    `---\n${YAML.stringify({ app: 'dev.tasknotes', scope: 'collection', settings_version: 1, ...settings })}---\n`,
  );
}

const RC5_FIXTURE = new URL('./fixtures/tasknotes-rc5-binding/', import.meta.url);

/**
 * A collection with real TaskNotes metadata whose tasknotes.task 0.3.0-rc.5
 * binding still carries archive.move_on_archive and archive.folder.
 */
function makeRc5Collection({ moveOnArchive, folder }) {
  const root = makeTempDir('mtn-archive-rc5-');
  cpSync(RC5_FIXTURE, root, { recursive: true });
  const typePath = join(root, '_types/task.md');
  const type = readFileSync(typePath, 'utf8')
    .replace('        move_on_archive: false\n', `        move_on_archive: ${moveOnArchive}\n`)
    .replace('        folder: TaskNotes/Archive\n', `        folder: ${folder}\n`);
  writeFileSync(typePath, type);
  mkdirSync(join(root, 'Work/Actions'), { recursive: true });
  writeFileSync(
    join(root, 'Work/Actions/Alpha.md'),
    ['---', 'tags:', '  - task', 'title: Alpha', 'status: open', '---', '', 'Body.', ''].join('\n'),
  );
  return root;
}

function makeCollection() {
  const root = makeTempDir('mtn-archive-move-');
  const init = runCli(['init', root]);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  writeTask(root, 'tasks/Alpha.md', 'Alpha', ['priority: high']);
  writeTask(root, 'tasks/Beta.md', 'Beta');
  return root;
}

function mtn(root, ...args) {
  return runCli([...args, '--path', root]);
}

test('archive without move_on_archive only tags the task', () => {
  const root = makeCollection();
  const result = mtn(root, 'archive', 'Alpha');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(existsSync(join(root, 'tasks/Alpha.md')));
  assert.deepEqual(readFrontmatter(join(root, 'tasks/Alpha.md')).tags, ['archived']);
});

test('archive moves to TaskNotes/Archive when archive_folder is empty', () => {
  const root = makeCollection();
  writeSettings(root, { move_on_archive: true, archive_folder: '' });

  const result = mtn(root, 'archive', 'Alpha');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /TaskNotes\/Archive\/Alpha\.md/);
  assert.equal(existsSync(join(root, 'tasks/Alpha.md')), false);
  const moved = readFrontmatter(join(root, 'TaskNotes/Archive/Alpha.md'));
  assert.deepEqual(moved.tags, ['archived']);
  assert.match(readFileSync(join(root, 'TaskNotes/Archive/Alpha.md'), 'utf8'), /Body\./);
});

test('archive renders a templated archive_folder like TaskNotes', () => {
  const root = makeCollection();
  writeSettings(root, { move_on_archive: true, archive_folder: 'Archive/{{year}}/{{priority}}/{{project}}' });

  const result = mtn(root, 'archive', 'Alpha');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  // {{project}} has no value, so its segment is dropped.
  const year = String(new Date().getFullYear());
  assert.ok(existsSync(join(root, 'Archive', year, 'high', 'Alpha.md')), result.stdout);
});

test('an rc.5 binding\'s archive.move_on_archive and folder are honoured', () => {
  const root = makeRc5Collection({ moveOnArchive: true, folder: 'Old/Archive' });

  let result = mtn(root, 'archive', 'Alpha');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(existsSync(join(root, 'Old/Archive/Alpha.md')), result.stdout);
  assert.deepEqual(readFrontmatter(join(root, 'Old/Archive/Alpha.md')).tags, ['task', 'archived']);

  // Unarchive goes back to the type's path folder (Work/Actions here).
  result = mtn(root, 'unarchive', 'Old/Archive/Alpha.md');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(existsSync(join(root, 'Work/Actions/Alpha.md')), result.stdout);
});

test('the settings record wins over an rc.5 binding', () => {
  const root = makeRc5Collection({ moveOnArchive: true, folder: 'Old/Archive' });
  writeSettings(root, { move_on_archive: false });

  const result = mtn(root, 'archive', 'Alpha');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(existsSync(join(root, 'Work/Actions/Alpha.md')));
  assert.equal(existsSync(join(root, 'Old/Archive/Alpha.md')), false);
});

test('archive refuses to overwrite a file in the archive folder and changes nothing', () => {
  const root = makeCollection();
  writeSettings(root, { move_on_archive: true, archive_folder: 'Archive' });
  writeTask(root, 'Archive/Alpha.md', 'Older Alpha');
  const before = readFileSync(join(root, 'tasks/Alpha.md'), 'utf8');

  const result = mtn(root, 'archive', 'tasks/Alpha.md');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Archive\/Alpha\.md already exists/);
  assert.equal(readFileSync(join(root, 'tasks/Alpha.md'), 'utf8'), before);
  assert.equal(readFrontmatter(join(root, 'Archive/Alpha.md')).title, 'Older Alpha');
});

test('archive does not rewrite links in other notes', () => {
  const root = makeCollection();
  writeSettings(root, { move_on_archive: true });
  writeFileSync(join(root, 'Note.md'), 'See [[Alpha]] and [[tasks/Alpha]].\n');

  const result = mtn(root, 'archive', 'Alpha');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(readFileSync(join(root, 'Note.md'), 'utf8'), 'See [[Alpha]] and [[tasks/Alpha]].\n');
});

test('unarchive removes the tag and moves the task back to the tasks folder', () => {
  const root = makeCollection();
  writeSettings(root, { move_on_archive: true });

  let result = mtn(root, 'archive', 'Alpha');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = mtn(root, 'unarchive', 'Alpha');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /tasks\/Alpha\.md/);

  assert.equal(existsSync(join(root, 'TaskNotes/Archive/Alpha.md')), false);
  const task = readFrontmatter(join(root, 'tasks/Alpha.md'));
  assert.deepEqual(task.tags, []);

  result = mtn(root, 'unarchive', 'Alpha');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /is not archived/);
});

test('unarchive without moving only removes the tag', () => {
  const root = makeCollection();
  writeTask(root, 'TaskNotes/Archive/Gamma.md', 'Gamma', ['tags:', '  - work', '  - archived']);

  const result = mtn(root, 'unarchive', 'Gamma');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(readFrontmatter(join(root, 'TaskNotes/Archive/Gamma.md')).tags, ['work']);
});

test('unarchive refuses to overwrite a task in the tasks folder', () => {
  const root = makeCollection();
  writeSettings(root, { move_on_archive: true });
  writeTask(root, 'TaskNotes/Archive/Beta.md', 'Old Beta', ['tags:', '  - archived']);

  const result = mtn(root, 'unarchive', 'TaskNotes/Archive/Beta.md');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tasks\/Beta\.md already exists/);
  assert.deepEqual(readFrontmatter(join(root, 'TaskNotes/Archive/Beta.md')).tags, ['archived']);
});
