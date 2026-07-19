import * as fs from "node:fs";
import * as path from "node:path";
import { SUPPORTED_SPEC_VERSION } from "@callumalpass/mdbase";
import YAML from "yaml";
import { resolveUserPath } from "./config.js";

export interface InitOptions {
  tasksFolder?: string;
  statuses?: string[];
  priorities?: string[];
  defaultStatus?: string;
  defaultPriority?: string;
}

const DEFAULTS: Required<InitOptions> = {
  tasksFolder: "tasks",
  statuses: ["open", "in-progress", "done", "cancelled"],
  priorities: ["low", "normal", "high", "urgent"],
  defaultStatus: "open",
  defaultPriority: "normal",
};

export function buildMdbaseYaml(): string {
  return YAML.stringify({
    spec_version: SUPPORTED_SPEC_VERSION,
    name: "TaskNotes",
    description: "Task collection managed by mdbase-tasknotes",
    settings: {
      types_folder: "_types",
      validation: "warn",
      explicit_type_keys: ["type", "types"],
    },
  }, { lineWidth: 0 });
}

export function buildTaskTypeDef(opts: InitOptions = {}): string {
  const o = { ...DEFAULTS, ...opts };
  const completedStatuses = o.statuses.filter((s) => {
    const lower = s.toLowerCase();
    return lower.includes("done") || lower.includes("complete") || lower.includes("cancel");
  });
  const roleNames = [
    "title", "status", "priority", "due", "scheduled", "completedDate",
    "tags", "contexts", "projects", "timeEstimate", "dateCreated",
    "dateModified", "recurrence", "recurrenceAnchor", "completeInstances",
    "skippedInstances", "timeEntries",
  ];
  const fieldRoles = Object.fromEntries(roleNames.map((role) => [role, role]));
  const dateArray = { type: "array", items: { type: "string", format: "date" } };
  const frontmatter = {
    kind: "mdbase.type",
    name: "task",
    version: 1,
    description: "A task managed by mdbase-tasknotes.",
    match: { path_glob: `${o.tasksFolder}/**/*.md` },
    schema: {
      dialect: "json-schema-2020-12",
      value: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        additionalProperties: true,
        required: ["type", "title", "status", "dateCreated"],
        properties: {
          type: { const: "task" },
          title: { type: "string", minLength: 1 },
          status: { enum: o.statuses, default: o.defaultStatus },
          priority: { enum: o.priorities, default: o.defaultPriority },
          due: { type: "string", format: "date" },
          scheduled: { type: "string", format: "date" },
          completedDate: { type: "string", format: "date" },
          tags: { type: "array", items: { type: "string" } },
          contexts: { type: "array", items: { type: "string" } },
          projects: {
            type: "array",
            items: { type: "string" },
            description: "Wikilinks to related project notes.",
          },
          timeEstimate: {
            type: "integer",
            minimum: 0,
            description: "Estimated time in minutes.",
          },
          dateCreated: { type: "string", format: "date-time" },
          dateModified: { type: "string", format: "date-time" },
          recurrence: { type: "string" },
          recurrenceAnchor: { enum: ["scheduled", "completion"] },
          completeInstances: dateArray,
          skippedInstances: dateArray,
          timeEntries: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                startTime: { type: "string", format: "date-time" },
                endTime: { type: "string", format: "date-time" },
                description: { type: "string" },
                duration: { type: "integer" },
              },
            },
          },
        },
      },
    },
    collection: {
      display: { name_field: "title" },
      read_defaults: {
        status: o.defaultStatus,
        priority: o.defaultPriority,
      },
      links: {
        "projects[]": { target_type: "any", validate_exists: false },
      },
      path: { pattern: `${o.tasksFolder}/{title}.md` },
    },
    lifecycle: {
      on_create: {
        set: {
          dateCreated: { now: true },
          dateModified: { now: true },
        },
      },
      on_update: { set: { dateModified: { now: true } } },
    },
    "x-tasknotes": {
      contract: "tasknotes.task",
      version: 1,
      field_roles: fieldRoles,
      status: {
        completed_values: completedStatuses,
        default: o.defaultStatus,
      },
      priority: { default: o.defaultPriority },
      archive: { tags_field: "tags", archived_tag: "archived" },
    },
  };

  return [
    "---",
    YAML.stringify(frontmatter, { lineWidth: 0 }).trimEnd(),
    "---",
    "",
    "# Task",
    "",
    "Type definition for tasks managed by mdbase-tasknotes.",
    "",
  ].join("\n");
}

export async function initCollection(targetPath: string): Promise<{ created: string[] }> {
  const absPath = resolveUserPath(targetPath);
  const typesDir = path.join(absPath, "_types");
  const mdbaseYamlPath = path.join(absPath, "mdbase.yaml");
  const taskTypeDefPath = path.join(typesDir, "task.md");

  const created: string[] = [];

  // Create directories
  fs.mkdirSync(absPath, { recursive: true });
  fs.mkdirSync(typesDir, { recursive: true });

  // Create tasks folder
  const tasksDir = path.join(absPath, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });

  // Write mdbase.yaml
  if (fs.existsSync(mdbaseYamlPath)) {
    throw new Error(`mdbase.yaml already exists at ${absPath}. Use --force to overwrite.`);
  }
  fs.writeFileSync(mdbaseYamlPath, buildMdbaseYaml());
  created.push("mdbase.yaml");

  // Write _types/task.md
  if (fs.existsSync(taskTypeDefPath)) {
    throw new Error(`_types/task.md already exists at ${absPath}. Use --force to overwrite.`);
  }
  fs.writeFileSync(taskTypeDefPath, buildTaskTypeDef());
  created.push("_types/task.md");

  created.push("tasks/");

  return { created };
}

export async function initCollectionForce(targetPath: string): Promise<{ created: string[] }> {
  const absPath = resolveUserPath(targetPath);
  const typesDir = path.join(absPath, "_types");
  const mdbaseYamlPath = path.join(absPath, "mdbase.yaml");
  const taskTypeDefPath = path.join(typesDir, "task.md");

  const created: string[] = [];

  fs.mkdirSync(absPath, { recursive: true });
  fs.mkdirSync(typesDir, { recursive: true });
  fs.mkdirSync(path.join(absPath, "tasks"), { recursive: true });

  fs.writeFileSync(mdbaseYamlPath, buildMdbaseYaml());
  created.push("mdbase.yaml");

  fs.writeFileSync(taskTypeDefPath, buildTaskTypeDef());
  created.push("_types/task.md");

  created.push("tasks/");

  return { created };
}
