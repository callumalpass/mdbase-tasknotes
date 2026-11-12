import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { makeTempDir, runCli } from './helpers.mjs';

function readMarkdownFrontmatter(filePath) {
  const document = readFileSync(filePath, 'utf8');
  const match = document.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  assert.ok(match, `${filePath} must contain YAML frontmatter`);
  return YAML.parse(match[1]);
}

test('init writes one complete, first-class TaskNotes data-contract installation', () => {
  const collectionPath = makeTempDir('mtn-contract-init-');
  const result = runCli(['init', collectionPath]);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  // The contract file location is owned by @tasknotes/model (it moved from
  // _contracts/tasknotes.task.md to _contracts/tasknotes.task/<version>.md), so
  // take it from what init reports instead of hard-coding it.
  const contractPath = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('_contracts/') && line.endsWith('.md'));
  assert.ok(contractPath, `init must report a contract file:\n${result.stdout}`);

  const expectedPaths = [
    'mdbase.yaml',
    contractPath,
    '_types/task.md',
    '_schemas/tasknotes/tasknotes-task.schema.json',
    '_schemas/tasknotes/tasknotes-task-binding.schema.json',
    'tasks',
  ];
  for (const relativePath of expectedPaths) {
    assert.equal(
      existsSync(join(collectionPath, relativePath)),
      true,
      `${relativePath} should be installed`,
    );
  }

  const config = YAML.parse(readFileSync(join(collectionPath, 'mdbase.yaml'), 'utf8'));
  assert.equal(config.settings.contracts_folder, '_contracts');

  const contract = readMarkdownFrontmatter(join(collectionPath, contractPath));
  assert.deepEqual(
    { kind: contract.kind, id: contract.id },
    { kind: 'mdbase.contract', id: 'tasknotes.task' },
  );
  assert.match(contract.version, /^0\.3\.\d+(?:-[0-9A-Za-z.-]+)?$/);

  const taskType = readMarkdownFrontmatter(join(collectionPath, '_types/task.md'));
  const implementation = taskType.implements.find(
    (candidate) =>
      candidate.contract === 'tasknotes.task' &&
      candidate.version === contract.version,
  );
  assert.ok(implementation, 'task type must implement the exact TaskNotes contract');
  assert.equal(implementation.fields.completeInstances, 'completeInstances');
  assert.equal(implementation.binding.status.default, 'open');
  assert.deepEqual(implementation.binding.status.completed_values, ['done']);
  assert.deepEqual(implementation.binding.status.skipped_values, ['cancelled']);

  const taskSchema = JSON.parse(
    readFileSync(
      join(collectionPath, '_schemas/tasknotes/tasknotes-task.schema.json'),
      'utf8',
    ),
  );
  const bindingSchema = JSON.parse(
    readFileSync(
      join(collectionPath, '_schemas/tasknotes/tasknotes-task-binding.schema.json'),
      'utf8',
    ),
  );
  assert.equal(taskSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(bindingSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
});
