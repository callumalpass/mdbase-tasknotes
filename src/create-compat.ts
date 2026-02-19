import { format } from "date-fns";
import type { Collection } from "@callumalpass/mdbase";
import type { FieldMapping } from "./field-mapping.js";
import { denormalizeFrontmatter, resolveField } from "./field-mapping.js";

type UnknownRecord = Record<string, unknown>;

interface TaskTypeDefLike {
  path_pattern?: string;
  match?: {
    path_glob?: string;
    where?: Record<string, unknown>;
  };
  fields?: Record<string, { type?: string; default?: unknown }>;
}

interface CreateInputLike {
  type: string;
  frontmatter: UnknownRecord;
  body?: string;
  path?: string;
}

interface CreateResultLike {
  path?: string;
  frontmatter?: UnknownRecord;
  error?: {
    code?: string;
    message: string;
  };
  warnings?: string[];
}

export async function createTaskWithCompat(
  collection: Collection,
  mapping: FieldMapping,
  roleFrontmatter: UnknownRecord,
  body?: string,
): Promise<CreateResultLike> {
  const taskType = getTaskTypeDef(collection);
  const denormalized = denormalizeFrontmatter(roleFrontmatter, mapping);

  applyFieldDefaults(denormalized, taskType);
  applyTimestampDefaults(denormalized, mapping, taskType);
  applyMatchDefaults(denormalized, taskType);

  const input: CreateInputLike = {
    type: "task",
    frontmatter: denormalized,
    body,
  };

  const firstAttempt = await (collection as any).create(input) as CreateResultLike;
  if (!firstAttempt.error || firstAttempt.error.code !== "path_required") {
    return firstAttempt;
  }

  const pathResolution = derivePathFromType(
    taskType,
    denormalized,
    mapping,
    new Date(),
  );
  if (!pathResolution.path) {
    if (pathResolution.missingKeys && pathResolution.missingKeys.length > 0) {
      const missing = pathResolution.missingKeys.join(", ");
      return {
        ...firstAttempt,
        warnings: [
          `Cannot resolve path_pattern "${pathResolution.template}": missing template values for ${missing}.`,
        ],
      };
    }
    return firstAttempt;
  }

  return await (collection as any).create({
    ...input,
    path: pathResolution.path,
  }) as CreateResultLike;
}

function getTaskTypeDef(collection: Collection): TaskTypeDefLike | undefined {
  const maybeCollection = collection as unknown as { typeDefs?: Map<string, TaskTypeDefLike> };
  if (!maybeCollection.typeDefs || typeof maybeCollection.typeDefs.get !== "function") {
    return undefined;
  }
  return maybeCollection.typeDefs.get("task");
}

function applyTimestampDefaults(
  frontmatter: UnknownRecord,
  mapping: FieldMapping,
  taskType: TaskTypeDefLike | undefined,
): void {
  const fields = taskType?.fields;
  if (!fields) return;

  const nowIso = new Date().toISOString();

  const createdField = resolveField(mapping, "dateCreated");
  if (fields[createdField] && !hasValue(frontmatter[createdField])) {
    frontmatter[createdField] = nowIso;
  }

  const modifiedField = resolveField(mapping, "dateModified");
  if (fields[modifiedField] && !hasValue(frontmatter[modifiedField])) {
    frontmatter[modifiedField] = nowIso;
  }
}

function applyFieldDefaults(
  frontmatter: UnknownRecord,
  taskType: TaskTypeDefLike | undefined,
): void {
  const fields = taskType?.fields;
  if (!fields) return;

  for (const [fieldName, fieldDef] of Object.entries(fields)) {
    if (fieldDef.default !== undefined && !hasValue(frontmatter[fieldName])) {
      frontmatter[fieldName] = fieldDef.default;
    }
  }
}

function applyMatchDefaults(
  frontmatter: UnknownRecord,
  taskType: TaskTypeDefLike | undefined,
): void {
  const where = taskType?.match?.where;
  if (!where || typeof where !== "object") return;

  for (const [field, condition] of Object.entries(where)) {
    if (condition === null || condition === undefined) continue;

    if (typeof condition !== "object" || Array.isArray(condition)) {
      if (!hasValue(frontmatter[field])) {
        frontmatter[field] = condition;
      }
      continue;
    }

    const ops = condition as Record<string, unknown>;
    if ("eq" in ops && !hasValue(frontmatter[field])) {
      frontmatter[field] = ops.eq;
      continue;
    }

    if ("contains" in ops) {
      const expected = ops.contains;
      const current = frontmatter[field];
      if (Array.isArray(current)) {
        if (!current.some((v) => String(v) === String(expected))) {
          current.push(expected);
          frontmatter[field] = current;
        }
        continue;
      }
      if (typeof current === "string") {
        if (!current.includes(String(expected))) {
          frontmatter[field] = `${current} ${String(expected)}`.trim();
        }
        continue;
      }
      if (!hasValue(current)) {
        frontmatter[field] = [expected];
      }
      continue;
    }

    if ("exists" in ops && ops.exists === true && !hasValue(frontmatter[field])) {
      frontmatter[field] = true;
    }
  }
}

function derivePathFromType(
  taskType: TaskTypeDefLike | undefined,
  frontmatter: UnknownRecord,
  mapping: FieldMapping,
  now: Date,
): { path?: string; missingKeys?: string[]; template?: string } {
  if (!taskType || typeof taskType.path_pattern !== "string" || taskType.path_pattern.trim().length === 0) {
    return {};
  }

  const values = buildTemplateValues(frontmatter, mapping, now);
  const renderedPattern = renderTemplate(taskType.path_pattern, values);
  if (renderedPattern.path) {
    return { path: ensureMarkdownExt(renderedPattern.path), template: taskType.path_pattern };
  }
  return {
    template: taskType.path_pattern,
    missingKeys: renderedPattern.missingKeys,
  };
}

function renderTemplate(
  template: string,
  values: Record<string, string>,
): { path?: string; missingKeys: string[] } {
  const missingKeys = new Set<string>();

  const rendered = template.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (_, a: string, b: string) => {
    const key = a ?? b;
    const value = values[key];
    if (value === undefined || value === null || String(value).trim().length === 0) {
      missingKeys.add(key);
      return "";
    }
    return String(value);
  });

  if (missingKeys.size > 0) {
    return { missingKeys: Array.from(missingKeys).sort() };
  }

  const normalized = normalizeRelativePath(rendered);
  if (!normalized || normalized.includes("..") || normalized.includes("\0")) {
    return { missingKeys: [] };
  }
  return { path: normalized, missingKeys: [] };
}

function buildTemplateValues(
  frontmatter: UnknownRecord,
  mapping: FieldMapping,
  now: Date,
): Record<string, string> {
  const values: Record<string, string> = {};

  const titleField = resolveField(mapping, "title");
  const priorityField = resolveField(mapping, "priority");
  const statusField = resolveField(mapping, "status");
  const dueField = resolveField(mapping, "due");
  const scheduledField = resolveField(mapping, "scheduled");
  const contextsField = resolveField(mapping, "contexts");
  const projectsField = resolveField(mapping, "projects");
  const tagsField = resolveField(mapping, "tags");
  const estimateField = resolveField(mapping, "timeEstimate");

  const rawTitle = readString(frontmatter[titleField]) || readString(frontmatter.title) || "task";
  const title = sanitizeForPathSegment(rawTitle);
  const priority = sanitizeForPathSegment(
    readString(frontmatter[priorityField]) || readString(frontmatter.priority) || "normal",
  );
  const status = sanitizeForPathSegment(
    readString(frontmatter[statusField]) || readString(frontmatter.status) || "open",
  );

  const dueDate = readString(frontmatter[dueField]) || readString(frontmatter.due) || "";
  const scheduledDate = readString(frontmatter[scheduledField]) || readString(frontmatter.scheduled) || "";

  const contexts = readStringList(frontmatter[contextsField] ?? frontmatter.contexts)
    .map((v) => sanitizeForPathSegment(v))
    .filter(Boolean);

  const projects = readStringList(frontmatter[projectsField] ?? frontmatter.projects)
    .map(extractProjectName)
    .map((v) => sanitizeForPathSegment(v))
    .filter(Boolean);

  const tags = readStringList(frontmatter[tagsField] ?? frontmatter.tags)
    .map((v) => sanitizeForPathSegment(v))
    .filter(Boolean);

  const timeEstimate = frontmatter[estimateField] ?? frontmatter.timeEstimate;

  const zettel = generateZettel(now);

  const titleLower = title.toLowerCase();
  const titleUpper = title.toUpperCase();
  const titleSnake = titleLower.replace(/\s+/g, "_");
  const titleKebab = titleLower.replace(/\s+/g, "-");
  const titleCamel = toCamelCase(title, false);
  const titlePascal = toCamelCase(title, true);

  const base = {
    title,
    priority,
    status,
    dueDate,
    scheduledDate,
    context: contexts[0] ?? "",
    contexts: contexts.join("/"),
    project: projects[0] ?? "",
    projects: projects.join("/"),
    tags: tags.join(", "),
    hashtags: tags.map((t) => `#${t}`).join(" "),
    timeEstimate: timeEstimate != null ? String(timeEstimate) : "",
    details: "",
    parentNote: "",
    date: format(now, "yyyy-MM-dd"),
    time: format(now, "HHmmss"),
    timestamp: format(now, "yyyy-MM-dd-HHmmss"),
    dateTime: format(now, "yyyy-MM-dd-HHmm"),
    year: format(now, "yyyy"),
    month: format(now, "MM"),
    day: format(now, "dd"),
    hour: format(now, "HH"),
    minute: format(now, "mm"),
    second: format(now, "ss"),
    shortDate: format(now, "yyMMdd"),
    shortYear: format(now, "yy"),
    monthName: format(now, "MMMM"),
    monthNameShort: format(now, "MMM"),
    dayName: format(now, "EEEE"),
    dayNameShort: format(now, "EEE"),
    week: format(now, "ww"),
    quarter: format(now, "q"),
    time12: sanitizeForPathSegment(format(now, "hh:mm a")),
    time24: sanitizeForPathSegment(format(now, "HH:mm")),
    hourPadded: format(now, "HH"),
    hour12: format(now, "hh"),
    ampm: format(now, "a"),
    unix: String(Math.floor(now.getTime() / 1000)),
    unixMs: String(now.getTime()),
    milliseconds: format(now, "SSS"),
    ms: format(now, "SSS"),
    timezone: sanitizeForPathSegment(format(now, "xxx")),
    timezoneShort: sanitizeForPathSegment(format(now, "xx")),
    utcOffset: sanitizeForPathSegment(format(now, "xxx")),
    utcOffsetShort: sanitizeForPathSegment(format(now, "xx")),
    utcZ: "Z",
    priorityShort: priority ? priority.substring(0, 1).toUpperCase() : "",
    statusShort: status ? status.substring(0, 1).toUpperCase() : "",
    titleLower,
    titleUpper,
    titleSnake,
    titleKebab,
    titleCamel,
    titlePascal,
    zettel,
    nano: `${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
  };

  Object.assign(values, base);

  // Support direct placeholders for mapped field names in path_pattern.
  values[titleField] = title;
  values[priorityField] = priority;
  values[statusField] = status;
  values[dueField] = dueDate;
  values[scheduledField] = scheduledDate;

  for (const [key, value] of Object.entries(frontmatter)) {
    if (values[key] !== undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      values[key] = sanitizeForPathSegment(String(value));
    }
  }

  return values;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
}

function extractProjectName(project: string): string {
  const wiki = project.match(/\[\[(?:.*\/)?([^\]|]+)(?:\|[^\]]+)?\]\]/);
  if (wiki) return wiki[1];
  return project;
}

function toCamelCase(value: string, pascal: boolean): string {
  const words = value
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "";
  return words.map((word, index) => {
    const lower = word.toLowerCase();
    if (index === 0 && !pascal) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join("");
}

function generateZettel(now: Date): string {
  const datePart = format(now, "yyMMdd");
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const secondsSinceMidnight = Math.floor((now.getTime() - midnight.getTime()) / 1000);
  return `${datePart}${secondsSinceMidnight.toString(36)}`;
}

function sanitizeForPathSegment(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[<>:"/\\|?*#[\]]/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/^\.+|\.+$/g, "")
    .trim();
}

function normalizeRelativePath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .trim();
}

function ensureMarkdownExt(pathValue: string): string {
  const normalized = normalizeRelativePath(pathValue);
  if (!normalized) return normalized;
  if (normalized.toLowerCase().endsWith(".md")) return normalized;
  return `${normalized}.md`;
}

function joinPath(folder: string, fileName: string): string {
  if (!folder) return fileName;
  return `${normalizeRelativePath(folder)}/${fileName}`;
}

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined;
}
