import test from "node:test";
import assert from "node:assert/strict";
import { createTaskWithCompat } from "../../dist/create-compat.js";
import { defaultFieldMapping } from "../../dist/field-mapping.js";

function makeCompatCollection(taskType, opts = {}) {
  const calls = [];
  const collection = {
    typeDefs: new Map([["task", taskType]]),
    async create(input) {
      calls.push(input);
      if (opts.forceCreateError) {
        return { error: { code: opts.forceCreateError, message: opts.forceCreateError } };
      }
      if (!input.path) {
        return { error: { code: "path_required", message: "path required" } };
      }
      return { path: input.path, frontmatter: input.frontmatter, warnings: [] };
    },
  };
  return { collection, calls };
}

function taskType(pathPattern, extra = {}) {
  return {
    path_pattern: pathPattern,
    fields: {
      title: { type: "string", required: true },
      status: { type: "enum", default: "open" },
      priority: { type: "enum", default: "normal" },
      dateCreated: { type: "datetime" },
      dateModified: { type: "datetime" },
      tags: { type: "list", items: { type: "string" } },
      ...extra.fields,
    },
    match: extra.match,
  };
}

function fixedNow(isoString, fn) {
  const RealDate = Date;
  const fixed = new RealDate(isoString);
  class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(fixed.getTime());
        return;
      }
      super(...args);
    }
    static now() {
      return fixed.getTime();
    }
  }
  globalThis.Date = MockDate;
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

const MAPPING = defaultFieldMapping();

test("create-compat conformance: path_pattern rendering matrix", async (t) => {
  const templates = [
    "tasks/{title}",
    "tasks/{titleKebab}",
    "tasks/{titleSnake}",
    "tasks/{priority}/{title}",
    "tasks/{status}/{titleKebab}",
    "tasks/{year}/{month}/{title}",
    "tasks/{year}/{monthNameShort}/{title}",
    "tasks/{date}/{title}",
    "tasks/{shortDate}/{title}",
    "tasks/{time}/{title}",
    "tasks/{timestamp}-{title}",
    "tasks/{zettel}",
    "tasks/{title}/{dueDate}",
    "tasks/{title}/{scheduledDate}",
    "tasks/{title}/{priorityShort}",
    "tasks/{title}/{statusShort}",
    "tasks/{title}/{titleCamel}",
    "tasks/{title}/{titlePascal}",
    "tasks/{title}/{titleUpper}",
    "tasks/{title}/{titleLower}",
    "tasks/{title}/{week}",
    "tasks/{title}/{quarter}",
    "tasks/{title}/{unix}",
    "tasks/{title}/{unixMs}",
    "tasks/{title}/{timezoneShort}",
  ];

  const frontmatters = [
    { title: "Plan workshop", status: "open", priority: "normal" },
    { title: "Write report", status: "in-progress", priority: "high", due: "2026-02-20" },
    { title: "Ship release", status: "open", priority: "low", scheduled: "2026-02-21" },
    { title: "Call ACME", status: "blocked", priority: "urgent", due: "2026-02-22", scheduled: "2026-02-20" },
  ];

  for (const template of templates) {
    for (const fm of frontmatters) {
      await t.test(`renders template ${template} for title=${fm.title}`, async () => {
        const { collection, calls } = makeCompatCollection(taskType(template));

        const result = await fixedNow("2026-02-20T10:20:30.000Z", async () =>
          createTaskWithCompat(collection, MAPPING, fm),
        );

        assert.equal(result.error, undefined);
        assert.equal(typeof result.path, "string");
        assert.match(result.path, /\.md$/);
        assert.equal(result.path.includes("{"), false);
        assert.equal(result.path.includes("}"), false);
        assert.equal(calls.length >= 1, true);
      });
    }
  }
});

test("create-compat conformance: match.where and defaults matrix", async (t) => {
  const whereCases = [
    { where: { kind: { eq: "task" } }, expectKey: "kind", expectValue: "task" },
    { where: { tags: { contains: "task" } }, expectKey: "tags", expectContains: "task" },
    { where: { owner: { exists: true } }, expectKey: "owner", expectExistsFallback: true },
    { where: { kind: "task" }, expectKey: "kind", expectValue: "task" },
  ];

  for (const c of whereCases) {
    await t.test(`applies match.where defaults (${JSON.stringify(c.where)})`, async () => {
      const { collection } = makeCompatCollection(
        taskType("tasks/{title}", {
          match: { where: c.where },
          fields: {
            owner: { type: "string" },
            kind: { type: "string" },
          },
        }),
      );

      const result = await fixedNow("2026-02-20T10:20:30.000Z", async () =>
        createTaskWithCompat(collection, MAPPING, { title: "Default check" }),
      );

      assert.equal(result.error, undefined);
      const written = result.frontmatter;
      assert.ok(written);

      if (Object.prototype.hasOwnProperty.call(c, "expectValue")) {
        assert.equal(written[c.expectKey], c.expectValue);
      }
      if (Object.prototype.hasOwnProperty.call(c, "expectContains")) {
        const tags = written[c.expectKey];
        assert.equal(Array.isArray(tags), true);
        assert.equal(tags.includes(c.expectContains), true);
      }
      if (c.expectExistsFallback) {
        assert.equal(written[c.expectKey], true);
      }
    });
  }

  const defaultCases = [
    {
      fields: { status: { type: "enum", default: "open" } },
      frontmatter: { title: "A" },
      key: "status",
      expected: "open",
    },
    {
      fields: { priority: { type: "enum", default: "normal" } },
      frontmatter: { title: "B" },
      key: "priority",
      expected: "normal",
    },
    {
      fields: { customFlag: { type: "string", default: "yes" } },
      frontmatter: { title: "C" },
      key: "customFlag",
      expected: "yes",
    },
    {
      fields: { customFlag: { type: "string", default: "yes" } },
      frontmatter: { title: "D", customFlag: "no" },
      key: "customFlag",
      expected: "no",
    },
  ];

  for (const c of defaultCases) {
    await t.test(`applies field defaults (${c.key})`, async () => {
      const { collection } = makeCompatCollection(
        taskType("tasks/{title}", { fields: c.fields }),
      );

      const result = await fixedNow("2026-02-20T10:20:30.000Z", async () =>
        createTaskWithCompat(collection, MAPPING, c.frontmatter),
      );

      assert.equal(result.error, undefined);
      assert.equal(result.frontmatter[c.key], c.expected);
      assert.match(result.frontmatter.dateCreated, /^2026-02-20T10:20:30.000Z$/);
      assert.match(result.frontmatter.dateModified, /^2026-02-20T10:20:30.000Z$/);
    });
  }
});

test("create-compat conformance: missing template variable diagnostics", async (t) => {
  const missingCases = [
    "tasks/{missingVar}/{title}",
    "tasks/{year}/{missingVar}/{title}",
    "tasks/{missingVarOne}/{missingVarTwo}/{title}",
    "tasks/{title}/{missingVar}",
    "tasks/{status}/{missingVar}/{titleKebab}",
    "tasks/{priority}/{missingVar}/{timestamp}",
    "tasks/{missingVar}/{missingVar2}/{missingVar3}",
    "tasks/{missingVar}/nested/{title}",
    "tasks/static/{missingVar}/file",
    "tasks/{missingVar}.md",
  ];

  for (const template of missingCases) {
    await t.test(`warns for unresolved template values (${template})`, async () => {
      const { collection } = makeCompatCollection(taskType(template));
      const result = await createTaskWithCompat(collection, MAPPING, {
        title: "Missing template",
        status: "open",
      });

      assert.ok(result.error);
      assert.equal(Array.isArray(result.warnings), true);
      assert.equal(result.warnings.length > 0, true);
      assert.match(result.warnings[0], /Cannot resolve path_pattern/);
      assert.match(result.warnings[0], /missing template values for/);
    });
  }
});

test("create-compat conformance: missing path_pattern diagnostics", async (t) => {
  await t.test("explains path_glob cannot create a path", async () => {
    const { collection, calls } = makeCompatCollection({
      fields: {
        title: { type: "string", required: true },
      },
      match: {
        path_glob: "calendar/{{year}}/**/*.md",
      },
    });

    const result = await createTaskWithCompat(collection, MAPPING, {
      title: "Needs path pattern",
    });

    assert.ok(result.error);
    assert.equal(calls.length, 1);
    assert.match(result.error.message, /match\.path_glob/);
    assert.match(result.error.message, /not a template for creating new files/);
    assert.match(result.error.message, /path_pattern:/);
  });
});

test("create-compat conformance: passthrough behavior when create does not return path_required", async (t) => {
  const passthroughErrors = ["validation_error", "unknown", "permission_denied", "already_exists"]; 

  for (const code of passthroughErrors) {
    await t.test(`returns first error directly for code=${code}`, async () => {
      const { collection, calls } = makeCompatCollection(taskType("tasks/{title}"), {
        forceCreateError: code,
      });

      const result = await createTaskWithCompat(collection, MAPPING, { title: "Err case" });
      assert.ok(result.error);
      assert.equal(result.error.code, code);
      assert.equal(calls.length, 1);
    });
  }
});
