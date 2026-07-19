import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultFieldMapping,
  buildFieldMapping,
  normalizeFrontmatter,
  denormalizeFrontmatter,
  resolveField,
  isCompletedStatus,
  getDefaultCompletedStatus,
  normalizeTaskTypeDefinition,
  resolveDisplayTitle,
} from "../../dist/field-mapping.js";

const ROLES = [
  "title",
  "status",
  "priority",
  "due",
  "scheduled",
  "completedDate",
  "tags",
  "contexts",
  "projects",
  "timeEstimate",
  "dateCreated",
  "dateModified",
  "recurrence",
  "recurrenceAnchor",
  "completeInstances",
  "skippedInstances",
  "timeEntries",
];

function makeTypeFieldsByRole() {
  const fields = {};
  for (const role of ROLES) {
    fields[`custom_${role}`] = { type: "string", tn_role: role };
  }
  return fields;
}

test("field mapping conformance: default mapping behavior", async (t) => {
  const mapping = defaultFieldMapping();

  for (const role of ROLES) {
    await t.test(`default roleToField identity: ${role}`, () => {
      assert.equal(mapping.roleToField[role], role);
    });

    await t.test(`default fieldToRole identity: ${role}`, () => {
      assert.equal(mapping.fieldToRole[role], role);
    });

    await t.test(`resolveField identity: ${role}`, () => {
      assert.equal(resolveField(mapping, role), role);
    });
  }

  await t.test("default displayNameKey is title", () => {
    assert.equal(mapping.displayNameKey, "title");
  });

  await t.test("default completed statuses include done", () => {
    assert.equal(mapping.completedStatuses.includes("done"), true);
  });

  await t.test("default completed statuses include cancelled", () => {
    assert.equal(mapping.completedStatuses.includes("cancelled"), true);
  });
});

test("field mapping conformance: buildFieldMapping with tn_role annotations", async (t) => {
  const fields = makeTypeFieldsByRole();
  const mapping = buildFieldMapping(fields, "custom_title");

  for (const role of ROLES) {
    await t.test(`tn_role roleToField for ${role}`, () => {
      assert.equal(mapping.roleToField[role], `custom_${role}`);
    });

    await t.test(`tn_role fieldToRole for ${role}`, () => {
      assert.equal(mapping.fieldToRole[`custom_${role}`], role);
    });

    await t.test(`resolveField follows tn_role for ${role}`, () => {
      assert.equal(resolveField(mapping, role), `custom_${role}`);
    });
  }

  await t.test("displayNameKey uses provided display name key", () => {
    assert.equal(mapping.displayNameKey, "custom_title");
  });
});

test("field mapping conformance: v0.3 task contract normalization", () => {
  const normalized = normalizeTaskTypeDefinition({
    schema: {
      dialect: "json-schema-2020-12",
      value: {
        type: "object",
        properties: {
          taskName: { type: "string" },
          state: { enum: ["todo", "finished"] },
          labels: { type: "array", items: { type: "string" } },
        },
      },
    },
    collection: {
      display: { name_field: "taskName" },
      read_defaults: { state: "todo" },
    },
    domain: {
      "x-tasknotes": {
        field_roles: { title: "taskName", status: "state", tags: "labels" },
        status: { completed_values: ["finished"] },
      },
    },
  });

  assert.equal(normalized.displayNameKey, "taskName");
  assert.deepEqual(normalized.fields.state.values, ["todo", "finished"]);
  assert.equal(normalized.fields.state.default, "todo");
  assert.deepEqual(normalized.fields.state.tn_completed_values, ["finished"]);
  assert.deepEqual(normalized.fields.labels.items, { type: "string" });
  const mapping = buildFieldMapping(normalized.fields, normalized.displayNameKey);
  assert.equal(mapping.roleToField.title, "taskName");
  assert.equal(mapping.roleToField.status, "state");
  assert.deepEqual(mapping.completedStatuses, ["finished"]);
});

test("field mapping conformance: fallback behavior without tn_role", async (t) => {
  const partialFields = {
    title: { type: "string" },
    status: { type: "string", values: ["todo", "doing", "finished"] },
    dateCreated: { type: "datetime" },
    random: { type: "string" },
  };

  const mapping = buildFieldMapping(partialFields);

  await t.test("identity fallback uses title field", () => {
    assert.equal(mapping.roleToField.title, "title");
  });

  await t.test("identity fallback uses status field", () => {
    assert.equal(mapping.roleToField.status, "status");
  });

  await t.test("missing role still has a fallback field name", () => {
    assert.equal(mapping.roleToField.priority, "priority");
  });

  await t.test("displayNameKey defaults to mapped title", () => {
    assert.equal(mapping.displayNameKey, mapping.roleToField.title);
  });

  await t.test("completed statuses inferred by keyword when no tn_completed_values", () => {
    assert.deepEqual(mapping.completedStatuses, ["finished"]);
  });
});

test("field mapping conformance: completed status inference precedence", async (t) => {
  const explicit = buildFieldMapping({
    taskStatus: {
      type: "enum",
      tn_role: "status",
      values: ["open", "done", "cancelled"],
      tn_completed_values: ["done", "cancelled"],
    },
  });

  await t.test("uses explicit tn_completed_values when provided", () => {
    assert.deepEqual(explicit.completedStatuses, ["done", "cancelled"]);
  });

  const inferred = buildFieldMapping({
    myStatus: {
      type: "enum",
      tn_role: "status",
      values: ["open", "in-progress", "completed", "cancelled"],
    },
  });

  await t.test("infers completed statuses from value names", () => {
    assert.deepEqual(inferred.completedStatuses, ["completed", "cancelled"]);
  });

  const fallback = buildFieldMapping({
    state: {
      type: "enum",
      tn_role: "status",
      values: ["todo", "doing", "backlog"],
    },
  });

  await t.test("falls back to default completed statuses when inference fails", () => {
    assert.deepEqual(fallback.completedStatuses, ["done", "cancelled"]);
  });

  await t.test("isCompletedStatus matches configured completed values", () => {
    assert.equal(isCompletedStatus(explicit, "done"), true);
    assert.equal(isCompletedStatus(explicit, "cancelled"), true);
    assert.equal(isCompletedStatus(explicit, "open"), false);
  });

  await t.test("getDefaultCompletedStatus returns first configured value", () => {
    assert.equal(getDefaultCompletedStatus(explicit), "done");
  });
});

test("field mapping conformance: normalize/denormalize and unknown-field preservation", async (t) => {
  const mapping = buildFieldMapping({
    myTitle: { tn_role: "title" },
    myStatus: { tn_role: "status" },
    myDue: { tn_role: "due" },
    myTags: { tn_role: "tags" },
    myContexts: { tn_role: "contexts" },
    myProjects: { tn_role: "projects" },
    myCreated: { tn_role: "dateCreated" },
    myModified: { tn_role: "dateModified" },
  });

  const baseFrontmatter = {
    myTitle: "Plan workshop",
    myStatus: "open",
    myDue: "2026-02-20",
    myTags: ["work", "planning"],
    myContexts: ["office"],
    myProjects: ["[[projects/demo]]"],
    myCreated: "2026-02-19T10:00:00Z",
    myModified: "2026-02-19T10:05:00Z",
    vendorField: "ZX-42",
    nested: { a: 1 },
  };

  const normalized = normalizeFrontmatter(baseFrontmatter, mapping);

  const expectedRoleMappings = [
    ["title", "Plan workshop"],
    ["status", "open"],
    ["due", "2026-02-20"],
    ["tags", ["work", "planning"]],
    ["contexts", ["office"]],
    ["projects", ["[[projects/demo]]"]],
    ["dateCreated", "2026-02-19T10:00:00Z"],
    ["dateModified", "2026-02-19T10:05:00Z"],
  ];

  for (const [role, expected] of expectedRoleMappings) {
    await t.test(`normalize maps field to role: ${role}`, () => {
      assert.deepEqual(normalized[role], expected);
    });
  }

  await t.test("normalize preserves unknown scalar field", () => {
    assert.equal(normalized.vendorField, "ZX-42");
  });

  await t.test("normalize preserves unknown object field", () => {
    assert.deepEqual(normalized.nested, { a: 1 });
  });

  const denormalized = denormalizeFrontmatter(normalized, mapping);

  await t.test("denormalize round-trips mapped title field", () => {
    assert.equal(denormalized.myTitle, "Plan workshop");
  });

  await t.test("denormalize round-trips mapped status field", () => {
    assert.equal(denormalized.myStatus, "open");
  });

  await t.test("denormalize round-trips mapped due field", () => {
    assert.equal(denormalized.myDue, "2026-02-20");
  });

  await t.test("denormalize preserves unknown scalar field", () => {
    assert.equal(denormalized.vendorField, "ZX-42");
  });

  await t.test("denormalize preserves unknown object field", () => {
    assert.deepEqual(denormalized.nested, { a: 1 });
  });

  const roleCombos = [
    { title: "A", status: "open", vendor: "x" },
    { title: "B", status: "in-progress", contexts: ["home"], vendor: "y" },
    { title: "C", due: "2026-03-01", tags: ["a", "b"], vendor: "z" },
    { title: "D", projects: ["[[p]]"], vendor: "k" },
    { status: "done", dateCreated: "2026-01-01T00:00:00Z", vendor: "v" },
    { title: "E", dateModified: "2026-01-01T00:00:00Z", vendor: "w" },
    { title: "F", recurrence: "FREQ=DAILY", vendor: "n" },
    { title: "G", completeInstances: ["2026-02-20"], vendor: "m" },
    { title: "H", skippedInstances: ["2026-02-20"], vendor: "q" },
    { title: "I", priority: "high", vendor: "p" },
    { title: "J", timeEstimate: 30, vendor: "e" },
    { title: "K", timeEntries: [{ startTime: "2026-01-01T00:00:00Z" }], vendor: "r" },
  ];

  for (const [index, combo] of roleCombos.entries()) {
    await t.test(`normalize/denormalize preserves unknowns across combo #${index + 1}`, () => {
      const denorm = denormalizeFrontmatter(combo, mapping);
      const renorm = normalizeFrontmatter(denorm, mapping);
      assert.equal(renorm.vendor, combo.vendor);
      if (combo.title !== undefined) assert.equal(renorm.title, combo.title);
      if (combo.status !== undefined) assert.equal(renorm.status, combo.status);
    });
  }
});

test("field mapping conformance: resolveDisplayTitle policy", async (t) => {
  const mapping = buildFieldMapping(
    {
      taskName: { tn_role: "title" },
      status: { tn_role: "status" },
    },
    "taskName",
  );

  const cases = [
    {
      name: "uses configured display_name_key when non-empty",
      fm: { taskName: "Alpha", title: "Fallback" },
      path: "tasks/file-a.md",
      expected: "Alpha",
    },
    {
      name: "falls back to canonical title role",
      fm: { title: "Beta" },
      path: "tasks/file-b.md",
      expected: "Beta",
    },
    {
      name: "falls back to basename when title fields missing",
      fm: { status: "open" },
      path: "tasks/Gamma.md",
      expected: "Gamma",
    },
    {
      name: "trims basename fallback",
      fm: {},
      path: "tasks/  Delta  .md",
      expected: "Delta",
    },
    {
      name: "returns undefined when no values and no path",
      fm: {},
      path: undefined,
      expected: undefined,
    },
    {
      name: "ignores empty configured display name and falls back",
      fm: { taskName: "   ", title: "Eta" },
      path: "tasks/file-e.md",
      expected: "Eta",
    },
    {
      name: "ignores empty title and falls back to path",
      fm: { taskName: "", title: "" },
      path: "tasks/Theta.md",
      expected: "Theta",
    },
    {
      name: "supports non-md path fallback",
      fm: {},
      path: "tasks/Iota.txt",
      expected: "Iota.txt",
    },
    {
      name: "preserves unicode basename fallback",
      fm: {},
      path: "tasks/Задача.md",
      expected: "Задача",
    },
    {
      name: "handles deeply nested path",
      fm: {},
      path: "a/b/c/tasks/Kappa.md",
      expected: "Kappa",
    },
  ];

  for (const tc of cases) {
    await t.test(tc.name, () => {
      assert.equal(resolveDisplayTitle(tc.fm, mapping, tc.path), tc.expected);
    });
  }
});

// Additional generated coverage for role-path variations and display rules.
test("field mapping conformance: generated role/display permutations", async (t) => {
  const displayKeys = ["title", "taskName", "name", "headline"];

  for (const displayKey of displayKeys) {
    const mapping = buildFieldMapping(
      {
        taskName: { tn_role: "title" },
        statusField: { tn_role: "status" },
      },
      displayKey,
    );

    for (const role of ROLES) {
      await t.test(`resolveField returns string for role ${role} (display key ${displayKey})`, () => {
        assert.equal(typeof resolveField(mapping, role), "string");
      });
    }

    const fallbackPaths = [
      "tasks/A.md",
      "tasks/B.md",
      "tasks/C.md",
      "tasks/D.md",
      "tasks/E.md",
      "tasks/F.md",
      "tasks/G.md",
      "tasks/H.md",
      "tasks/I.md",
      "tasks/J.md",
      "tasks/K.md",
      "tasks/L.md",
      "tasks/M.md",
      "tasks/N.md",
      "tasks/O.md",
      "tasks/P.md",
      "tasks/Q.md",
      "tasks/R.md",
      "tasks/S.md",
      "tasks/T.md",
    ];

    for (const path of fallbackPaths) {
      await t.test(`resolveDisplayTitle falls back to basename for ${path} (display key ${displayKey})`, () => {
        const expected = path.split("/").pop().replace(/\.md$/, "");
        assert.equal(resolveDisplayTitle({}, mapping, path), expected);
      });
    }
  }
});
