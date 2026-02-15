import * as fs from "node:fs";
import * as path from "node:path";

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
  return [
    'spec_version: "0.2.0"',
    'name: "TaskNotes"',
    'description: "Task collection managed by mdbase-tasknotes"',
    "settings:",
    '  types_folder: "_types"',
    "  default_strict: false",
    "  exclude:",
    '    - "_types"',
    "",
  ].join("\n");
}

export function buildTaskTypeDef(opts: InitOptions = {}): string {
  const o = { ...DEFAULTS, ...opts };
  const lines: string[] = [];

  lines.push("---");
  lines.push("name: task");
  lines.push("description: A task managed by mdbase-tasknotes.");
  lines.push("display_name_key: title");
  lines.push("strict: false");
  lines.push("");
  lines.push(`path_pattern: "${o.tasksFolder}/{title}.md"`);
  lines.push("");
  lines.push("match:");
  lines.push(`  path_glob: "${o.tasksFolder}/**/*.md"`);
  lines.push("");
  lines.push("fields:");

  // title
  lines.push("  title:");
  lines.push("    type: string");
  lines.push("    required: true");
  lines.push("    tn_role: title");

  // status
  lines.push("  status:");
  lines.push("    type: enum");
  lines.push("    required: true");
  lines.push(`    values: [${o.statuses.join(", ")}]`);
  lines.push(`    default: ${o.defaultStatus}`);
  lines.push("    tn_role: status");

  // priority
  lines.push("  priority:");
  lines.push("    type: enum");
  lines.push(`    values: [${o.priorities.join(", ")}]`);
  lines.push(`    default: ${o.defaultPriority}`);
  lines.push("    tn_role: priority");

  // date fields
  lines.push("  due:");
  lines.push("    type: date");
  lines.push("    tn_role: due");
  lines.push("  scheduled:");
  lines.push("    type: date");
  lines.push("    tn_role: scheduled");
  lines.push("  completedDate:");
  lines.push("    type: date");
  lines.push("    tn_role: completedDate");

  // list fields
  lines.push("  tags:");
  lines.push("    type: list");
  lines.push("    items:");
  lines.push("      type: string");
  lines.push("    tn_role: tags");
  lines.push("  contexts:");
  lines.push("    type: list");
  lines.push("    items:");
  lines.push("      type: string");
  lines.push("    tn_role: contexts");
  lines.push("  projects:");
  lines.push("    type: list");
  lines.push("    items:");
  lines.push("      type: link");
  lines.push('    description: "Wikilinks to related project notes."');
  lines.push("    tn_role: projects");

  // time estimate
  lines.push("  timeEstimate:");
  lines.push("    type: integer");
  lines.push("    min: 0");
  lines.push('    description: "Estimated time in minutes."');
  lines.push("    tn_role: timeEstimate");

  // timestamps
  lines.push("  dateCreated:");
  lines.push("    type: datetime");
  lines.push("    required: true");
  lines.push('    generated: "now"');
  lines.push("    tn_role: dateCreated");
  lines.push("  dateModified:");
  lines.push("    type: datetime");
  lines.push('    generated: "now_on_write"');
  lines.push("    tn_role: dateModified");

  // recurrence
  lines.push("  recurrence:");
  lines.push("    type: string");
  lines.push("    tn_role: recurrence");
  lines.push("  recurrenceAnchor:");
  lines.push("    type: enum");
  lines.push("    values: [scheduled, completion]");
  lines.push("    default: scheduled");
  lines.push("    tn_role: recurrenceAnchor");

  // time entries
  lines.push("  timeEntries:");
  lines.push("    type: list");
  lines.push("    tn_role: timeEntries");
  lines.push("    items:");
  lines.push("      type: object");
  lines.push("      fields:");
  lines.push("        startTime:");
  lines.push("          type: datetime");
  lines.push("        endTime:");
  lines.push("          type: datetime");
  lines.push("        description:");
  lines.push("          type: string");
  lines.push("        duration:");
  lines.push("          type: integer");

  lines.push("---");
  lines.push("");
  lines.push("# Task");
  lines.push("");
  lines.push("Type definition for tasks managed by mdbase-tasknotes.");
  lines.push("");

  return lines.join("\n");
}

export async function initCollection(targetPath: string): Promise<{ created: string[] }> {
  const absPath = path.resolve(targetPath);
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
  const absPath = path.resolve(targetPath);
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
