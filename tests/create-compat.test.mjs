import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir, runCli, stripAnsi } from "./helpers.mjs";

function writeCollection(root, taskTypeContent) {
  mkdirSync(join(root, "_types"), { recursive: true });
  writeFileSync(join(root, "mdbase.yaml"), [
    'spec_version: "0.2.0"',
    "settings:",
    '  types_folder: "_types"',
    "",
  ].join("\n"));
  writeFileSync(join(root, "_types", "task.md"), taskTypeContent);
}

function currentDateParts() {
  const now = new Date();
  return {
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1).padStart(2, "0"),
    monthNameShort: now.toLocaleString("en-US", { month: "short" }),
  };
}

test("create: falls back to templated path_pattern using TaskNotes-style variables", () => {
  const collectionPath = makeTempDir("mtn-create-compat-pattern-");
  writeCollection(collectionPath, [
    "---",
    "name: task",
    'path_pattern: "calendar/{{year}}/{{month}}-{{monthNameShort}}/{{titleKebab}}.md"',
    "match:",
    "  where:",
    "    tags:",
    '      contains: "task"',
    "fields:",
    "  title:",
    "    type: string",
    "    required: true",
    "  status:",
    "    type: enum",
    "    required: true",
    "    values: [open, done]",
    "    default: open",
    "  tags:",
    "    type: list",
    "    items:",
    "      type: string",
    "  dateCreated:",
    "    type: datetime",
    "    required: true",
    "  dateModified:",
    "    type: datetime",
    "---",
    "",
  ].join("\n"));

  const result = runCli(["create", "--path", collectionPath, "Ship launch plan"]);
  const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
  assert.equal(result.status, 0, output);
  assert.match(output, /Task created/);

  const parts = currentDateParts();
  const expectedRelativePath = `calendar/${parts.year}/${parts.month}-${parts.monthNameShort}/ship-launch-plan.md`;
  assert.ok(
    existsSync(join(collectionPath, expectedRelativePath)),
    `Expected file to exist at ${expectedRelativePath}`,
  );
});

test("create: applies match.where defaults and required timestamps for TaskNotes-style types", () => {
  const collectionPath = makeTempDir("mtn-create-compat-where-");
  writeCollection(collectionPath, [
    "---",
    "name: task",
    'path_pattern: "tasks/{{year}}/{{titleKebab}}.md"',
    "match:",
    "  where:",
    "    tags:",
    '      contains: "task"',
    '    "kind":',
    '      eq: "task"',
    "fields:",
    "  title:",
    "    type: string",
    "    required: true",
    "  status:",
    "    type: enum",
    "    required: true",
    "    values: [open, done]",
    "    default: open",
    "  tags:",
    "    type: list",
    "    items:",
    "      type: string",
    "  dateCreated:",
    "    type: datetime",
    "    required: true",
    "  kind:",
    "    type: string",
    "---",
    "",
  ].join("\n"));

  const result = runCli(["create", "--path", collectionPath, "Budget review"]);
  const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
  assert.equal(result.status, 0, output);
  assert.match(output, /Task created/);

  const parts = currentDateParts();
  const expectedRelativePath = `tasks/${parts.year}/budget-review.md`;
  assert.ok(
    existsSync(join(collectionPath, expectedRelativePath)),
    `Expected file to exist at ${expectedRelativePath}`,
  );

  const createdText = readFileSync(join(collectionPath, expectedRelativePath), "utf8");
  assert.match(createdText, /dateCreated:/);
  assert.match(createdText, /kind:\s*task/);
  assert.match(createdText, /task/);
});

test("create: supports zettel-style path_pattern placeholders via mtn compatibility rendering", () => {
  const collectionPath = makeTempDir("mtn-create-compat-zettel-");
  writeCollection(collectionPath, [
    "---",
    "name: task",
    'path_pattern: "tasks/{{year}}/{{zettel}}.md"',
    "match:",
    "  where:",
    "    tags:",
    '      contains: "task"',
    "fields:",
    "  title:",
    "    type: string",
    "    required: true",
    "  status:",
    "    type: enum",
    "    required: true",
    "    values: [open, done]",
    "    default: open",
    "  tags:",
    "    type: list",
    "    items:",
    "      type: string",
    "  dateCreated:",
    "    type: datetime",
    "    required: true",
    "---",
    "",
  ].join("\n"));

  const result = runCli(["create", "--path", collectionPath, "Zettel compatibility check"]);
  const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
  assert.equal(result.status, 0, output);
  assert.match(output, /Task created/);

  const parts = currentDateParts();
  const expectedDir = join(collectionPath, "tasks", parts.year);
  const createdPathMatch = output.match(/→\s+(.+\.md)\s*$/m);
  assert.ok(createdPathMatch, `Expected created path in output:\n${output}`);
  const createdRelativePath = createdPathMatch[1].trim();
  assert.ok(createdRelativePath.startsWith(`tasks/${parts.year}/`), createdRelativePath);
  assert.ok(existsSync(join(collectionPath, createdRelativePath)), createdRelativePath);

  const basename = createdRelativePath.split("/").pop() || "";
  assert.match(basename, /^\d{6}[0-9a-z]+\.md$/);
  assert.ok(existsSync(expectedDir));
});

test("create: warns with exact missing template variables when path_pattern cannot be resolved", () => {
  const collectionPath = makeTempDir("mtn-create-compat-missing-var-");
  writeCollection(collectionPath, [
    "---",
    "name: task",
    'path_pattern: "tasks/{{year}}/{{mystery}}/{{titleKebab}}.md"',
    "match:",
    "  where:",
    "    tags:",
    '      contains: "task"',
    "fields:",
    "  title:",
    "    type: string",
    "    required: true",
    "  status:",
    "    type: enum",
    "    required: true",
    "    values: [open, done]",
    "    default: open",
    "  tags:",
    "    type: list",
    "    items:",
    "      type: string",
    "  dateCreated:",
    "    type: datetime",
    "    required: true",
    "---",
    "",
  ].join("\n"));

  const result = runCli(["create", "--path", collectionPath, "Missing var warning test"]);
  const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
  assert.equal(result.status, 1, output);
  assert.match(output, /Cannot resolve path_pattern/);
  assert.match(output, /missing template values for mystery/);
  assert.match(output, /Failed to create task:/);
});
