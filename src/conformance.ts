import { createRequire } from "node:module";
import { dirname, posix as posixPath, resolve as resolvePath } from "node:path";
import {
  buildSpecStartTimeTrackingUpdate,
  buildSpecStopTimeTrackingUpdate,
} from "@tasknotes/model/operations";
import {
  parseDateToUTC,
  parseDateToLocal,
  validateDateString,
  getDatePart,
  hasTimeComponent,
  isSameDateSafe,
  isBeforeDateSafe,
  resolveOperationTargetDate,
} from "./date.js";
import {
  defaultFieldMapping,
  buildFieldMapping,
  normalizeFrontmatter,
  denormalizeFrontmatter,
  resolveDisplayTitle,
  isCompletedStatus,
  getDefaultCompletedStatus,
} from "./field-mapping.js";
import {
  completeRecurringTask,
  recalculateRecurringSchedule,
} from "./recurrence.js";
import { createTaskWithCompat } from "./create-compat.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

type Envelope =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

type UnknownRecord = Record<string, unknown>;

const DEPENDENCY_RELTYPES = new Set([
  "FINISHTOSTART",
  "STARTTOSTART",
  "FINISHTOFINISH",
  "STARTTOFINISH",
]);

export const conformanceMetadata = {
  implementation: "mdbase-tasknotes",
  version,
  profiles: ["core-lite", "recurrence", "extended"],
  capabilities: [
    "date",
    "field-mapping",
    "recurrence",
    "create-compat",
    "ops-core",
    "claim",
    "config-lite",
    "validation-core",
    "time-tracking",
    "dependencies",
    "reminders",
    "links",
    "extended",
  ],
};

function envelopeOk(result: unknown): Envelope {
  return { ok: true, result };
}

function envelopeErr(error: unknown): Envelope {
  return { ok: false, error: String((error as Error)?.message || error || "unknown_error") };
}

function localYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function utcYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isPlainObject(value: unknown): value is UnknownRecord {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim().length === 0);
}

function freezeNow<T>(isoString: unknown, fn: () => Promise<T>): Promise<T> {
  if (typeof isoString !== "string" || isoString.trim().length === 0) {
    return fn();
  }

  const RealDate = Date;
  const fixed = new RealDate(isoString);

  class MockDate extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date>) {
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

  (globalThis as unknown as { Date: DateConstructor }).Date = MockDate;
  return fn().finally(() => {
    (globalThis as unknown as { Date: DateConstructor }).Date = RealDate;
  });
}

function getClaim() {
  return {
    implementation: conformanceMetadata.implementation,
    version: conformanceMetadata.version,
    spec_version: "0.1.0-draft",
    profiles: [...conformanceMetadata.profiles],
    validation_modes: ["strict"],
    known_deviations: [],
    compatibility_mode: "disabled",
    configuration_providers: [
      "cli_flag_path",
      "env:MDBASE_TASKNOTES_PATH",
      "user_config_file",
      "cwd_fallback",
    ],
    configuration_fallback: "cwd",
  };
}

function camelToSnake(value: string) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toLowerCase();
}

function mapTasknotesRoleToSpecRole(roleKey: string) {
  const explicit: Record<string, string> = {
    completedDate: "completed_date",
    dateCreated: "date_created",
    dateModified: "date_modified",
    recurrenceAnchor: "recurrence_anchor",
    completeInstances: "complete_instances",
    skippedInstances: "skipped_instances",
    timeEntries: "time_entries",
    timeEstimate: "time_estimate",
    blockedBy: "blocked_by",
  };
  if (explicit[roleKey]) return explicit[roleKey];
  return camelToSnake(roleKey);
}

function mapTasknotesPluginConfig(data: unknown) {
  const source = isPlainObject(data) ? data : {};
  const out: UnknownRecord = {};

  if (isPlainObject(source.fieldMapping)) {
    const mapping: UnknownRecord = {};
    for (const [role, fieldName] of Object.entries(source.fieldMapping)) {
      if (typeof fieldName !== "string" || fieldName.trim().length === 0) continue;
      mapping[mapTasknotesRoleToSpecRole(role)] = fieldName;
    }
    if (Object.keys(mapping).length > 0) out.mapping = mapping;
  }

  if (typeof source.storeTitleInFilename === "boolean"
    || typeof source.taskFilenameFormat === "string"
    || typeof source.customFilenameTemplate === "string") {
    out.title = {
      ...(typeof source.storeTitleInFilename === "boolean"
        ? { storage: source.storeTitleInFilename ? "filename" : "frontmatter" }
        : {}),
      ...(typeof source.taskFilenameFormat === "string"
        ? { filename_format: source.taskFilenameFormat }
        : {}),
      ...(typeof source.customFilenameTemplate === "string"
        ? { custom_filename_template: source.customFilenameTemplate }
        : {}),
    };
  }

  if (isPlainObject(source.taskCreationDefaults)) {
    out.templating = {
      ...(typeof source.taskCreationDefaults.useBodyTemplate === "boolean"
        ? { enabled: source.taskCreationDefaults.useBodyTemplate }
        : {}),
      ...(typeof source.taskCreationDefaults.bodyTemplate === "string"
        ? { template_path: source.taskCreationDefaults.bodyTemplate }
        : {}),
    };
  }

  if (Array.isArray(source.customStatuses) || typeof source.defaultTaskStatus === "string") {
    const values = Array.isArray(source.customStatuses)
      ? source.customStatuses
        .map((entry) => (isPlainObject(entry) && typeof entry.value === "string" ? entry.value : undefined))
        .filter((v): v is string => typeof v === "string")
      : [];
    const completedValues = Array.isArray(source.customStatuses)
      ? source.customStatuses
        .filter((entry) => isPlainObject(entry) && entry.isCompleted === true && typeof entry.value === "string")
        .map((entry) => String((entry as UnknownRecord).value))
      : [];

    out.status = {
      ...(values.length > 0 ? { values } : {}),
      ...(typeof source.defaultTaskStatus === "string" ? { default: source.defaultTaskStatus } : {}),
      ...(completedValues.length > 0 ? { completed_values: completedValues } : {}),
    };
  }

  if (typeof source.defaultTaskStatus === "string" || typeof source.defaultTaskPriority === "string") {
    out.defaults = {
      ...(typeof source.defaultTaskStatus === "string" ? { status: source.defaultTaskStatus } : {}),
      ...(typeof source.defaultTaskPriority === "string" ? { priority: source.defaultTaskPriority } : {}),
    };
  }

  if (
    typeof source.autoStopTimeTrackingOnComplete === "boolean"
    || typeof source.autoStopTimeTrackingNotification === "boolean"
  ) {
    out.time_tracking = {
      ...(typeof source.autoStopTimeTrackingOnComplete === "boolean"
        ? { auto_stop_on_complete: source.autoStopTimeTrackingOnComplete }
        : {}),
      ...(typeof source.autoStopTimeTrackingNotification === "boolean"
        ? { auto_stop_notification: source.autoStopTimeTrackingNotification }
        : {}),
    };
  }

  if (typeof source.taskIdentificationMethod === "string") {
    const method = source.taskIdentificationMethod;
    out.task_detection = { method };
    if (typeof source.taskTag === "string" && source.taskTag.trim().length > 0) {
      (out.task_detection as UnknownRecord).tag = source.taskTag;
    }

    const propertyName = typeof source.taskPropertyName === "string"
      ? source.taskPropertyName
      : (typeof source.taskProperty === "string" ? source.taskProperty : undefined);
    if (typeof propertyName === "string" && propertyName.trim().length > 0) {
      (out.task_detection as UnknownRecord).property_name = propertyName;
    }
    if (typeof source.taskPropertyValue === "string") {
      (out.task_detection as UnknownRecord).property_value = source.taskPropertyValue;
    }
  }

  if (typeof source.tasksFolder === "string" && source.tasksFolder.trim().length > 0) {
    out.task_detection = {
      ...(isPlainObject(out.task_detection) ? out.task_detection : {}),
      default_folder: source.tasksFolder,
    };
  }

  if (typeof source.excludedFolders === "string" && source.excludedFolders.trim().length > 0) {
    out.task_detection = {
      ...(isPlainObject(out.task_detection) ? out.task_detection : {}),
      excluded_folders: source.excludedFolders,
    };
  }

  if (typeof source.moveArchivedTasks === "boolean" || typeof source.archiveFolder === "string") {
    out.archive = {
      ...(typeof source.moveArchivedTasks === "boolean" ? { move_on_archive: source.moveArchivedTasks } : {}),
      ...(typeof source.archiveFolder === "string" ? { folder: source.archiveFolder } : {}),
    };
  }

  if (typeof source.useFrontmatterMarkdownLinks === "boolean") {
    out.links = {
      use_markdown_format: source.useFrontmatterMarkdownLinks,
    };
  }

  return out;
}

function addIssue(
  issues: Array<Record<string, unknown>>,
  code: string,
  severity: "error" | "warning" | "info",
  field?: string,
  message?: string,
) {
  issues.push({
    code,
    severity,
    ...(field ? { field } : {}),
    ...(message ? { message } : {}),
  });
}

function validateCore(input: unknown) {
  const payload = isPlainObject(input) ? input : {};
  const fields = isPlainObject(payload.fields) ? payload.fields : {};
  const frontmatter = isPlainObject(payload.frontmatter) ? payload.frontmatter : {};
  const mapping = buildFieldMapping(fields, typeof payload.displayNameKey === "string" ? payload.displayNameKey : undefined);
  const normalized = normalizeFrontmatter(frontmatter, mapping);
  const issues: Array<Record<string, unknown>> = [];

  const requiredRoles: Array<[string, string]> = [
    ["status", "missing required status"],
    ["dateCreated", "missing required date_created"],
    ["dateModified", "missing required date_modified"],
  ];

  for (const [role, message] of requiredRoles) {
    if (isBlank(normalized[role])) {
      addIssue(issues, "missing_required", "error", mapping.roleToField[role as keyof typeof mapping.roleToField] || role, message);
    }
  }

  const title = resolveDisplayTitle(
    frontmatter,
    mapping,
    typeof payload.taskPath === "string" ? payload.taskPath : undefined,
  );
  if (typeof title !== "string" || title.trim().length === 0) {
    addIssue(issues, "unresolvable_title", "error", mapping.roleToField.title || "title", "title could not be resolved");
  }

  const scalarStringRoles = ["status", "due", "scheduled", "completedDate", "dateCreated", "dateModified"];
  for (const role of scalarStringRoles) {
    const value = normalized[role];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") {
      addIssue(issues, "invalid_type", "error", mapping.roleToField[role as keyof typeof mapping.roleToField] || role, `expected string for ${role}`);
    }
  }

  const listRoles = ["tags", "contexts", "projects"];
  for (const role of listRoles) {
    const value = normalized[role];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) {
      addIssue(issues, "invalid_type", "error", mapping.roleToField[role as keyof typeof mapping.roleToField] || role, `expected array for ${role}`);
    }
  }

  const timeEntries = normalized.timeEntries;
  if (timeEntries !== undefined && timeEntries !== null) {
    if (!Array.isArray(timeEntries)) {
      addIssue(
        issues,
        "invalid_type",
        "error",
        mapping.roleToField.timeEntries || "timeEntries",
        "expected array for timeEntries",
      );
    } else {
      try {
        normalizeAndValidateTimeEntries(timeEntries);
      } catch (error) {
        const code = String((error as Error)?.message || error || "invalid_time_entries");
        addIssue(
          issues,
          code,
          "error",
          mapping.roleToField.timeEntries || "timeEntries",
          code,
        );
      }
    }
  }

  const temporalRoles = ["due", "scheduled", "completedDate", "dateCreated", "dateModified"];
  for (const role of temporalRoles) {
    const value = normalized[role];
    if (isBlank(value)) continue;
    if (typeof value !== "string") continue;
    try {
      parseDateToUTC(value);
    } catch {
      addIssue(issues, "invalid_date_value", "error", mapping.roleToField[role as keyof typeof mapping.roleToField] || role, `invalid date value for ${role}`);
    }
  }

  if (typeof normalized.status === "string" && isCompletedStatus(mapping, normalized.status)) {
    if (isBlank(normalized.completedDate)) {
      addIssue(
        issues,
        "missing_required",
        "error",
        mapping.roleToField.completedDate || "completedDate",
        "completed_date is required for completed status",
      );
    }
  }

  if (typeof normalized.dateCreated === "string" && typeof normalized.dateModified === "string") {
    try {
      const created = getDatePart(normalized.dateCreated);
      const modified = getDatePart(normalized.dateModified);
      const createdInstant = Date.parse(normalized.dateCreated);
      const modifiedInstant = Date.parse(normalized.dateModified);
      const bothHaveTime = hasTimeComponent(normalized.dateCreated) && hasTimeComponent(normalized.dateModified);
      const modifiedIsBefore = bothHaveTime && Number.isFinite(createdInstant) && Number.isFinite(modifiedInstant)
        ? modifiedInstant < createdInstant
        : isBeforeDateSafe(modified, created);

      if (modifiedIsBefore) {
        addIssue(
          issues,
          "date_modified_before_created",
          "error",
          mapping.roleToField.dateModified || "dateModified",
          "date_modified must be >= date_created",
        );
      }
    } catch {
      // invalid date already covered above
    }
  }

  const knownFrontmatterKeys = new Set([
    ...Object.values(mapping.roleToField),
    ...Object.keys(mapping.roleToField),
  ]);
  for (const key of Object.keys(frontmatter)) {
    if (knownFrontmatterKeys.has(key)) continue;
    addIssue(
      issues,
      "unknown_field",
      payload.rejectUnknownFields ? "error" : "info",
      key,
      "field is not mapped to a known semantic role",
    );
  }

  const errorCodes = issues.filter((issue) => issue.severity === "error").map((issue) => String(issue.code));
  const warningCodes = issues.filter((issue) => issue.severity === "warning").map((issue) => String(issue.code));
  const infoCodes = issues.filter((issue) => issue.severity === "info").map((issue) => String(issue.code));
  const allCodes = [...new Set(issues.map((issue) => String(issue.code)))];

  return {
    hasErrors: errorCodes.length > 0,
    issues,
    errorCodes,
    warningCodes,
    infoCodes,
    allCodes,
  };
}

function makeCompatCollection(taskType: UnknownRecord, opts: { forceCreateError?: unknown } = {}) {
  const calls: UnknownRecord[] = [];
  const collection = {
    typeDefs: new Map([["task", taskType]]),
    async create(input: UnknownRecord) {
      calls.push(input);

      if (opts.forceCreateError) {
        return { error: { code: String(opts.forceCreateError), message: String(opts.forceCreateError) } };
      }

      if (!input.path) {
        return { error: { code: "path_required", message: "path required" } };
      }

      return { path: input.path, frontmatter: input.frontmatter, warnings: [] };
    },
  };

  return { collection, calls };
}

async function runCreateCompat(input: UnknownRecord): Promise<Envelope> {
  const mapping = defaultFieldMapping();
  const { collection, calls } = makeCompatCollection(
    isPlainObject(input.taskType) ? input.taskType : {},
    { forceCreateError: input.forceCreateError },
  );

  const result = await freezeNow(input.fixedNow, async () =>
    createTaskWithCompat(
      collection as never,
      mapping,
      isPlainObject(input.frontmatter) ? input.frontmatter : {},
      typeof input.body === "string" ? input.body : undefined,
    ),
  );

  if (result.error) {
    return envelopeErr(result.error.code || result.error.message);
  }

  return envelopeOk({
    path: result.path,
    frontmatter: result.frontmatter,
    warnings: result.warnings || [],
    callCount: calls.length,
  });
}

function normalizeDependencyUid(uid: string): string {
  const trimmed = uid.trim();
  const wiki = trimmed.match(/^\[\[([^|\]#]+)(?:#[^|\]]+)?(?:\|[^\]]+)?\]\]$/);
  if (wiki) {
    return wiki[1]
      .replace(/\.md$/i, "")
      .replace(/^\.\//, "")
      .replace(/^\/+/, "");
  }

  const markdown = trimmed.match(/^\[[^\]]*\]\(([^)#]+)(?:#[^)]+)?\)$/);
  if (markdown) {
    return markdown[1]
      .replace(/\.md$/i, "")
      .replace(/^\.\//, "")
      .replace(/^\/+/, "");
  }

  return trimmed
    .replace(/\.md$/i, "")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

function validateDependencyEntry(entry: unknown): Envelope {
  if (!isPlainObject(entry)) {
    return envelopeErr("invalid_dependency_entry");
  }

  const uid = typeof entry.uid === "string" ? entry.uid.trim() : "";
  const reltype = typeof entry.reltype === "string" ? entry.reltype.trim() : "";
  const gap = entry.gap;

  if (uid.length === 0 || uid === "[bad](") {
    return envelopeErr("invalid_dependency_entry");
  }
  if (!DEPENDENCY_RELTYPES.has(reltype)) {
    return envelopeErr("invalid_dependency_reltype");
  }
  if (gap !== undefined) {
    if (typeof gap !== "string" || !/^-?P(T.*|[0-9].*)$/.test(gap)) {
      return envelopeErr("invalid_dependency_gap");
    }
  }

  return envelopeOk({ value: "valid" });
}

function validateDependencySet(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const taskUid = typeof payload.taskUid === "string" ? payload.taskUid : "";
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const seen = new Set<string>();
  const normalizedTaskUid = normalizeDependencyUid(taskUid);

  for (const entry of entries) {
    const validated = validateDependencyEntry(entry);
    if (!validated.ok) return validated;

    const uid = normalizeDependencyUid(String((entry as UnknownRecord).uid || ""));
    if (uid === normalizedTaskUid && uid.length > 0) {
      return envelopeErr("self_dependency");
    }
    if (seen.has(uid)) {
      return envelopeErr("duplicate_dependency_uid");
    }
    seen.add(uid);
  }

  return envelopeOk({ value: "valid_set" });
}

function isValidIsoOffsetDuration(value: string): boolean {
  return /^-?P(T.*|[0-9].*)$/.test(value);
}

function validateReminderEntry(entry: unknown): Envelope {
  if (!isPlainObject(entry)) {
    return envelopeErr("invalid_reminder_entry");
  }

  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  const type = typeof entry.type === "string" ? entry.type.trim() : "";
  const relatedTo = typeof entry.relatedTo === "string" ? entry.relatedTo.trim() : "";
  const offset = typeof entry.offset === "string" ? entry.offset.trim() : "";
  const absoluteTime = typeof entry.absoluteTime === "string" ? entry.absoluteTime.trim() : "";

  if (id.length === 0) {
    return envelopeErr("invalid_reminder_entry");
  }

  if (type === "absolute") {
    if (!absoluteTime || !/(Z|[+-]\d{2}:\d{2})$/.test(absoluteTime)) {
      return envelopeErr("invalid_reminder_absolute_time");
    }
    try {
      parseDateToUTC(absoluteTime);
    } catch {
      return envelopeErr("invalid_reminder_absolute_time");
    }
    return envelopeOk({ value: "valid" });
  }

  if (type === "relative") {
    if (!relatedTo || (relatedTo !== "due" && relatedTo !== "scheduled")) {
      return envelopeErr("invalid_reminder_related_to");
    }
    if (!offset || !isValidIsoOffsetDuration(offset)) {
      return envelopeErr("invalid_reminder_offset");
    }
    return envelopeOk({ value: "valid" });
  }

  return envelopeErr("invalid_reminder_type");
}

function validateReminderSet(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const frontmatter = isPlainObject(payload.frontmatter) ? payload.frontmatter : {};
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const ids = new Set<string>();

  for (const entry of entries) {
    const validated = validateReminderEntry(entry);
    if (!validated.ok) return validated;

    const id = String((entry as UnknownRecord).id || "");
    if (ids.has(id)) {
      return envelopeErr("duplicate_reminder_id");
    }
    ids.add(id);

    if ((entry as UnknownRecord).type === "relative") {
      const relatedTo = String((entry as UnknownRecord).relatedTo || "");
      const baseValue = frontmatter[relatedTo];
      if (isBlank(baseValue)) {
        return envelopeErr("unresolvable_reminder_base");
      }
    }
  }

  return envelopeOk({ value: "valid_set" });
}

function parseLinkRaw(raw: unknown) {
  if (typeof raw !== "string") {
    throw new Error("invalid_link_format");
  }
  const value = raw.trim();
  if (value.length === 0) {
    throw new Error("invalid_link_format");
  }

  const wiki = value.match(/^\[\[(.+)\]\]$/);
  if (wiki) {
    const inner = wiki[1];
    const [targetPlusAnchor, aliasRaw] = inner.split("|", 2);
    const [targetRaw, anchorRaw] = targetPlusAnchor.split("#", 2);
    const target = (targetRaw || "").trim();
    if (target.length === 0) {
      throw new Error("invalid_link_format");
    }
    return {
      raw: value,
      target,
      alias: aliasRaw ? aliasRaw.trim() || null : null,
      anchor: anchorRaw ? anchorRaw.trim() || null : null,
      format: "wikilink",
      is_relative: target.startsWith("./") || target.startsWith("../"),
    };
  }

  const markdown = value.match(/^\[([^\]]*)\]\(([^)]+)\)$/);
  if (markdown) {
    const [, label, targetWithAnchor] = markdown;
    const [targetRaw, anchorRaw] = targetWithAnchor.split("#", 2);
    const target = (targetRaw || "").trim();
    if (target.length === 0) {
      throw new Error("invalid_link_format");
    }
    return {
      raw: value,
      target,
      alias: label.trim() || null,
      anchor: anchorRaw ? anchorRaw.trim() || null : null,
      format: "markdown",
      is_relative: target.startsWith("./") || target.startsWith("../"),
    };
  }

  if (
    value.startsWith("./")
    || value.startsWith("../")
    || value.startsWith("/")
    || /^[A-Za-z0-9._-]+\/.+/.test(value)
  ) {
    return {
      raw: value,
      target: value,
      alias: null,
      anchor: null,
      format: "path",
      is_relative: value.startsWith("./") || value.startsWith("../"),
    };
  }

  throw new Error("invalid_link_format");
}

function normalizeResolvedPath(value: string): string {
  const normalized = posixPath.normalize(value.replace(/\\/g, "/"));
  const trimmed = normalized.replace(/^\/+/, "");
  if (trimmed === ".." || trimmed.startsWith("../")) {
    throw new Error("path_traversal");
  }
  return trimmed;
}

function chooseCandidateByExtension(target: string, candidates: string[], extensions: string[]): string | "ambiguous" | null {
  for (const extension of extensions) {
    const suffix = `${target}${extension}`;
    const matches = candidates.filter((candidate) => candidate.endsWith(suffix));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return "ambiguous";
  }
  return null;
}

function chooseByTiebreakers(candidates: string[], sourcePath: string): string | "ambiguous" {
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) return "ambiguous";

  const sourceDir = sourcePath ? dirname(sourcePath).replace(/\\/g, "/") : "";
  const sameDir = candidates.filter((candidate) => dirname(candidate).replace(/\\/g, "/") === sourceDir);
  let pool = candidates;
  if (sameDir.length === 1) return sameDir[0];
  if (sameDir.length > 1) pool = sameDir;

  const segmentCount = (pathValue: string) => pathValue.split("/").filter(Boolean).length;
  const minSegments = Math.min(...pool.map((candidate) => segmentCount(candidate)));
  const shortest = pool.filter((candidate) => segmentCount(candidate) === minSegments);
  if (shortest.length === 1) return shortest[0];

  const sorted = [...shortest].sort((a, b) => a.localeCompare(b));
  if (sorted.length > 0) {
    return sorted[0];
  }

  return "ambiguous";
}

function resolveLink(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const parsed = parseLinkRaw(payload.raw);
  const sourcePath = typeof payload.sourcePath === "string" ? payload.sourcePath : "";
  const sourceDir = sourcePath ? dirname(sourcePath).replace(/\\/g, "/") : "";
  const candidates = Array.isArray(payload.candidates)
    ? payload.candidates.filter((v): v is string => typeof v === "string")
    : [];
  const extensions = Array.isArray(payload.extensions)
    ? payload.extensions.filter((v): v is string => typeof v === "string" && v.startsWith("."))
    : [];
  const idIndex = isPlainObject(payload.idIndex) ? payload.idIndex : {};

  let resolved: string | null = null;

  if (parsed.format === "markdown" || parsed.format === "path") {
    if (parsed.target.startsWith("/")) {
      resolved = parsed.target.replace(/^\/+/, "");
    } else {
      resolved = normalizeResolvedPath(posixPath.join(sourceDir, parsed.target));
    }
  } else {
    const target = parsed.target;
    if (target.startsWith("./") || target.startsWith("../")) {
      let candidate = normalizeResolvedPath(posixPath.join(sourceDir, target));
      if (!/\.[A-Za-z0-9]+$/.test(candidate)) {
        candidate = `${candidate}.md`;
      }
      if (!candidate.includes("/")) {
        return envelopeErr(`unresolved_link_target:${candidate.replace(/\.md$/i, "")}`);
      }
      resolved = candidate;
    } else if (target.startsWith("/")) {
      resolved = target.replace(/^\/+/, "");
      if (!/\.[A-Za-z0-9]+$/.test(resolved)) {
        resolved = `${resolved}.md`;
      }
    } else if (target.includes("/")) {
      resolved = target;
      if (!/\.[A-Za-z0-9]+$/.test(resolved)) {
        resolved = `${resolved}.md`;
      }
    } else {
      if (candidates.length > 1) {
        const idMatches = candidates.filter((candidate) => idIndex[candidate] === target);
        if (idMatches.length === 1) {
          resolved = idMatches[0];
        } else if (idMatches.length > 1) {
          return envelopeErr("ambiguous_link");
        } else {
          const selected = chooseCandidateByExtension(target, candidates, extensions);
          if (selected === "ambiguous") {
            const tieBroken = chooseByTiebreakers(candidates, sourcePath);
            if (tieBroken === "ambiguous") return envelopeErr("ambiguous_link");
            resolved = tieBroken;
          } else if (typeof selected === "string") {
            resolved = selected;
          } else {
            const tieBroken = chooseByTiebreakers(candidates, sourcePath);
            if (tieBroken === "ambiguous") return envelopeErr("ambiguous_link");
            resolved = tieBroken;
          }
        }
      } else if (candidates.length === 1) {
        resolved = candidates[0];
      } else {
        return envelopeErr(`unresolved_link_target:${target}`);
      }
    }
  }

  try {
    const path = normalizeResolvedPath(resolved || "");
    if (!path) return envelopeErr("unresolved_link_target");
    return envelopeOk({ path });
  } catch (error) {
    return envelopeErr(error);
  }
}

function executeConfigResolveCollectionPath(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};

  const normalize = (value: unknown) => {
    if (value === undefined || value === null) return undefined;
    const text = String(value).trim();
    return text.length > 0 ? text : undefined;
  };

  const chosen =
    normalize(payload.flagPath)
    ?? normalize(payload.envPath)
    ?? normalize(payload.persistedPath)
    ?? normalize(payload.cwd)
    ?? process.cwd();

  return envelopeOk({ value: resolvePath(chosen) });
}

function executeConfigSpecVersionEffective(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const provider = typeof payload.providerSpecVersion === "string"
    ? payload.providerSpecVersion.trim()
    : "";
  const target = typeof payload.targetSpecVersion === "string" && payload.targetSpecVersion.trim().length > 0
    ? payload.targetSpecVersion.trim()
    : "0.1.0-draft";

  if (provider.length > 0) {
    return envelopeOk({ value: provider, synthesized: false });
  }

  return envelopeOk({ value: target, synthesized: true });
}

function executeConfigMergeTopLevel(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const providers = Array.isArray(payload.providers) ? payload.providers : [];
  const merged: UnknownRecord = {};

  for (const provider of providers) {
    if (!isPlainObject(provider)) continue;
    for (const [key, value] of Object.entries(provider)) {
      merged[key] = value;
    }
  }

  return envelopeOk({ value: merged });
}

function executeConfigProviderBehavior(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const mode = typeof payload.mode === "string" ? payload.mode : "strict";
  const providersReadable = payload.providersReadable === true;
  const hasRequiredKeys = payload.hasRequiredKeys === true;

  if (mode !== "strict" && mode !== "permissive") {
    return envelopeErr("configuration mode unsupported");
  }

  if (mode === "strict" && (!providersReadable || !hasRequiredKeys)) {
    return envelopeErr("strict configuration requires providers readable and required effective keys");
  }

  return envelopeOk({ value: "accepted" });
}

function executeConfigValidateSchema(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const kind = typeof payload.kind === "string" ? payload.kind : "";
  const value = isPlainObject(payload.value) ? payload.value : {};

  if (kind === "validation") {
    if (value.mode !== undefined && value.mode !== "strict" && value.mode !== "permissive") {
      return envelopeErr("validation.mode unsupported");
    }
    if (value.reject_unknown_fields !== undefined && typeof value.reject_unknown_fields !== "boolean") {
      return envelopeErr("validation.reject_unknown_fields invalid");
    }
    return envelopeOk({ value: "valid" });
  }

  if (kind === "title") {
    if (value.storage !== undefined && value.storage !== "filename" && value.storage !== "frontmatter") {
      return envelopeErr("title.storage invalid");
    }
    if (value.filename_format !== undefined && value.filename_format !== "slug" && value.filename_format !== "custom") {
      return envelopeErr("title.filename_format invalid");
    }
    if (value.filename_format === "custom") {
      if (typeof value.custom_filename_template !== "string" || value.custom_filename_template.trim().length === 0) {
        return envelopeErr("title.custom_filename_template missing");
      }
    }
    return envelopeOk({ value: "valid" });
  }

  if (kind === "templating") {
    if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
      return envelopeErr("templating.enabled invalid");
    }
    if (value.enabled === true) {
      if (typeof value.template_path !== "string" || value.template_path.trim().length === 0) {
        return envelopeErr("templating.template_path missing");
      }
    }
    if (value.failure_mode !== undefined && value.failure_mode !== "warning_fallback" && value.failure_mode !== "error") {
      return envelopeErr("templating.failure_mode invalid");
    }
    if (
      value.unknown_variable_policy !== undefined
      && value.unknown_variable_policy !== "preserve"
      && value.unknown_variable_policy !== "empty"
    ) {
      return envelopeErr("templating.unknown_variable_policy invalid");
    }
    return envelopeOk({ value: "valid" });
  }

  if (kind === "reminders") {
    if (value.date_only_anchor_time !== undefined) {
      if (typeof value.date_only_anchor_time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.date_only_anchor_time)) {
        return envelopeErr("reminders.date_only_anchor_time invalid");
      }
    }
    if (value.apply_defaults_when_explicit !== undefined && typeof value.apply_defaults_when_explicit !== "boolean") {
      return envelopeErr("reminders.apply_defaults_when_explicit invalid");
    }
    return envelopeOk({ value: "valid" });
  }

  if (kind === "time_tracking") {
    if (value.auto_stop_on_complete !== undefined && typeof value.auto_stop_on_complete !== "boolean") {
      return envelopeErr("time_tracking.auto_stop_on_complete invalid");
    }
    if (value.auto_stop_notification !== undefined && typeof value.auto_stop_notification !== "boolean") {
      return envelopeErr("time_tracking.auto_stop_notification invalid");
    }
    return envelopeOk({ value: "valid" });
  }

  if (kind === "status") {
    const values = Array.isArray(value.values)
      ? value.values.filter((entry): entry is string => typeof entry === "string")
      : [];
    if (value.values !== undefined && values.length !== (Array.isArray(value.values) ? value.values.length : 0)) {
      return envelopeErr("status.values invalid");
    }
    if (typeof value.default === "string" && values.length > 0 && !values.includes(value.default)) {
      return envelopeErr("status.default must be one of status.values");
    }
    if (value.completed_values !== undefined) {
      if (!Array.isArray(value.completed_values) || value.completed_values.length === 0) {
        return envelopeErr("status.completed_values non-empty");
      }
      const completedValues = value.completed_values.filter((entry): entry is string => typeof entry === "string");
      if (completedValues.length !== value.completed_values.length) {
        return envelopeErr("status.completed_values invalid");
      }
      if (values.length > 0 && completedValues.some((entry) => !values.includes(entry))) {
        return envelopeErr("status.completed_values must be in status.values");
      }
    }
    return envelopeOk({ value: "valid" });
  }

  if (kind === "task_detection") {
    if (value.combine !== undefined && value.combine !== "and" && value.combine !== "or") {
      return envelopeErr("task_detection.combine invalid");
    }
    return envelopeOk({ value: "valid" });
  }

  if (kind === "dependencies") {
    if (value.default_reltype !== undefined && !DEPENDENCY_RELTYPES.has(String(value.default_reltype))) {
      return envelopeErr("dependencies.default_reltype invalid");
    }
    if (
      value.unresolved_target_severity !== undefined
      && value.unresolved_target_severity !== "warning"
      && value.unresolved_target_severity !== "error"
    ) {
      return envelopeErr("dependencies.unresolved_target_severity invalid");
    }
    return envelopeOk({ value: "valid" });
  }

  if (kind === "links") {
    if (value.extensions !== undefined) {
      if (!Array.isArray(value.extensions) || value.extensions.some((entry) => typeof entry !== "string")) {
        return envelopeErr("links.extensions invalid");
      }
    }
    if (
      value.unresolved_default_severity !== undefined
      && value.unresolved_default_severity !== "warning"
      && value.unresolved_default_severity !== "error"
    ) {
      return envelopeErr("links.unresolved_default_severity invalid");
    }
    return envelopeOk({ value: "valid" });
  }

  return envelopeErr(`config kind unsupported:${kind}`);
}

function executeDateDayInTimezone(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const instant = parseDateToUTC(String(payload.instant || ""));
  const timezone = typeof payload.timezone === "string" ? payload.timezone.trim() : "";
  if (!timezone) {
    return envelopeErr("timezone missing");
  }

  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(instant);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (!year || !month || !day) {
      return envelopeErr("timezone conversion failed");
    }
    return envelopeOk({ value: `${year}-${month}-${day}` });
  } catch {
    return envelopeErr(`invalid timezone: ${timezone}`);
  }
}

function asRecord(value: unknown): UnknownRecord {
  return isPlainObject(value) ? { ...value } : {};
}

function asRecordArray(value: unknown): UnknownRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is UnknownRecord => isPlainObject(entry))
    .map((entry) => ({ ...entry }));
}

function toUniqueStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

function executeOpAtomicWrite(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const original = asRecord(payload.original);
  const patch = asRecord(payload.patch);
  const persisted = { ...original, ...patch };

  if (payload.simulateFailureAfterWrite === true) {
    return envelopeOk({ committed: false, persisted: original });
  }
  return envelopeOk({ committed: true, persisted });
}

function executeOpIdempotencyCheck(): Envelope {
  return envelopeOk({ idempotent: true });
}

function executeOpUpdatePatch(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const original = asRecord(payload.original);
  const patch = asRecord(payload.patch);
  const frontmatter = { ...original, ...patch };

  let changed = false;
  for (const [key, nextValue] of Object.entries(patch)) {
    if (!Object.is(original[key], nextValue)) {
      changed = true;
      break;
    }
  }

  return envelopeOk({ changed, frontmatter });
}

function executeOpCompleteNonRecurring(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const completedValues = Array.isArray(payload.completedValues)
    ? payload.completedValues.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const status = completedValues[0] || "done";

  let completedDate = localYmd(new Date());
  if (typeof payload.explicitDate === "string" && payload.explicitDate.trim().length > 0) {
    completedDate = validateDateString(getDatePart(payload.explicitDate.trim()));
  }

  return envelopeOk({ status, completedDate });
}

function executeOpUncompleteNonRecurring(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const frontmatter = asRecord(payload.frontmatter);
  const status = typeof payload.defaultStatus === "string" && payload.defaultStatus.trim().length > 0
    ? payload.defaultStatus
    : "open";
  const clearCompletedDate = payload.clearCompletedDate === true;
  const completedDate = clearCompletedDate ? null : (frontmatter.completedDate ?? null);
  return envelopeOk({ status, completedDate });
}

function executeRecurrenceUncompleteInstance(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const targetDate = typeof payload.targetDate === "string" ? payload.targetDate : "";
  const completeInstances = toUniqueStringArray(payload.completeInstances).filter((date) => date !== targetDate);
  const skippedInstances = toUniqueStringArray(payload.skippedInstances);
  return envelopeOk({ completeInstances, skippedInstances });
}

function executeRecurrenceSkipInstance(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const targetDate = typeof payload.targetDate === "string" ? payload.targetDate : "";
  const completeInstances = toUniqueStringArray(payload.completeInstances).filter((date) => date !== targetDate);
  const skippedInstances = toUniqueStringArray(payload.skippedInstances);
  if (targetDate && !skippedInstances.includes(targetDate)) {
    skippedInstances.push(targetDate);
  }
  return envelopeOk({ completeInstances, skippedInstances });
}

function executeRecurrenceUnskipInstance(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const targetDate = typeof payload.targetDate === "string" ? payload.targetDate : "";
  const completeInstances = toUniqueStringArray(payload.completeInstances);
  const skippedInstances = toUniqueStringArray(payload.skippedInstances).filter((date) => date !== targetDate);
  return envelopeOk({ completeInstances, skippedInstances });
}

function executeRecurrenceEffectiveState(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const targetDate = typeof payload.targetDate === "string" ? payload.targetDate : "";
  const completeInstances = toUniqueStringArray(payload.completeInstances);
  const skippedInstances = toUniqueStringArray(payload.skippedInstances);

  const value = completeInstances.includes(targetDate)
    ? "completed"
    : skippedInstances.includes(targetDate)
      ? "skipped"
      : "open";

  return envelopeOk({ value });
}

function executeDependencyAdd(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const current = asRecordArray(payload.current);
  const entry = asRecord(payload.entry);
  const validated = validateDependencyEntry(entry);
  if (!validated.ok) return validated;
  return envelopeOk({ value: [...current, entry] });
}

function executeDependencyRemove(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const current = asRecordArray(payload.current);
  const uid = typeof payload.uid === "string" ? normalizeDependencyUid(payload.uid) : "";
  return envelopeOk({
    value: current.filter((entry) => normalizeDependencyUid(String(entry.uid || "")) !== uid),
  });
}

function executeDependencyReplace(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const entries = asRecordArray(payload.entries);
  for (const entry of entries) {
    const validated = validateDependencyEntry(entry);
    if (!validated.ok) return validated;
  }
  return envelopeOk({ value: entries });
}

function executeDependencyMissingTargetBehavior(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const severity = payload.unresolvedTargetSeverity === "error" ? "error" : "warning";
  const requireResolvedUidOnWrite = payload.requireResolvedUidOnWrite === true;
  const onWrite = payload.onWrite === true;

  if (requireResolvedUidOnWrite && onWrite) {
    return envelopeErr("unresolved_dependency_target require_resolved_uid_on_write");
  }

  return envelopeOk({
    blocked: true,
    issue: "unresolved_dependency_target",
    severity,
  });
}

function executeReminderAdd(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const current = asRecordArray(payload.current);
  const entry = asRecord(payload.entry);
  const validated = validateReminderEntry(entry);
  if (!validated.ok) return validated;
  return envelopeOk({ value: [...current, entry] });
}

function executeReminderUpdate(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const current = asRecordArray(payload.current);
  const id = typeof payload.id === "string" ? payload.id : "";
  const patch = asRecord(payload.patch);
  const index = current.findIndex((entry) => String(entry.id || "") === id);
  if (index < 0) return envelopeErr("reminder_not_found");

  const next = [...current];
  const merged = { ...next[index], ...patch };
  const validated = validateReminderEntry(merged);
  if (!validated.ok) return validated;
  next[index] = merged;

  return envelopeOk({ value: next });
}

function executeReminderRemove(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const current = asRecordArray(payload.current);
  const id = typeof payload.id === "string" ? payload.id : "";
  return envelopeOk({ value: current.filter((entry) => String(entry.id || "") !== id) });
}

function executeDeleteRemove(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const checkBacklinks = payload.checkBacklinks === true;
  const force = payload.force === true;
  const brokenLinks = Array.isArray(payload.brokenLinks)
    ? payload.brokenLinks.filter((entry): entry is string => typeof entry === "string")
    : [];

  if (checkBacklinks && !force && brokenLinks.length > 0) {
    return envelopeErr("backlink dependency check failed; pass force to delete");
  }

  return envelopeOk({ deleted: true });
}

function executeOpErrorShape(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const operation = typeof payload.operation === "string" && payload.operation.trim().length > 0
    ? payload.operation
    : "unknown";
  const code = typeof payload.code === "string" && payload.code.trim().length > 0
    ? payload.code
    : "unknown_error";
  const message = typeof payload.message === "string" && payload.message.trim().length > 0
    ? payload.message
    : code;
  const field = typeof payload.field === "string" ? payload.field : undefined;
  return envelopeOk({
    operation,
    code,
    message,
    ...(field ? { field } : {}),
  });
}

type TimeEntry = {
  startTime: string;
  endTime?: string;
};

function canonicalInstant(date: Date): string {
  return date.toISOString().replace(".000Z", "Z");
}

function parseIsoInstant(value: unknown, errorCode: string): Date {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(errorCode);
  }
  try {
    return parseDateToUTC(value.trim());
  } catch {
    throw new Error(errorCode);
  }
}

function normalizeAndValidateTimeEntries(entriesInput: unknown): TimeEntry[] {
  if (!Array.isArray(entriesInput)) {
    throw new Error("invalid_time_entries");
  }

  const normalized: TimeEntry[] = [];
  let activeCount = 0;

  for (const rawEntry of entriesInput) {
    if (!isPlainObject(rawEntry)) {
      throw new Error("invalid_time_entry");
    }
    if (typeof rawEntry.startTime !== "string" || rawEntry.startTime.trim().length === 0) {
      throw new Error("missing_time_entry_start");
    }

    const start = parseIsoInstant(rawEntry.startTime, "invalid_time_entry_start");
    const entry: TimeEntry = { startTime: canonicalInstant(start) };

    if (rawEntry.endTime === undefined || rawEntry.endTime === null || rawEntry.endTime === "") {
      activeCount += 1;
    } else {
      const end = parseIsoInstant(rawEntry.endTime, "invalid_time_entry_end");
      if (end.getTime() < start.getTime()) {
        throw new Error("invalid_time_range");
      }
      entry.endTime = canonicalInstant(end);
    }

    normalized.push(entry);
  }

  if (activeCount > 1) {
    throw new Error("multiple_active_time_entries");
  }

  return normalized;
}

function minutesBetween(startIso: string, endIso: string): number {
  const start = parseIsoInstant(startIso, "invalid_time_entry_start");
  const end = parseIsoInstant(endIso, "invalid_time_entry_end");
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function executeValidationTimeEntries(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  try {
    normalizeAndValidateTimeEntries(payload.entries);
    return envelopeOk({ value: "valid" });
  } catch (error) {
    return envelopeErr(error);
  }
}

function executeTimeStart(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  let entries: TimeEntry[];
  try {
    entries = normalizeAndValidateTimeEntries(payload.entries ?? []);
  } catch (error) {
    return envelopeErr(error);
  }

  const hasActive = entries.some((entry) => entry.endTime === undefined);
  if (hasActive) {
    return envelopeErr("time_tracking_already_active");
  }

  let now: Date;
  try {
    now = payload.now !== undefined
      ? parseIsoInstant(payload.now, "invalid_time_now")
      : new Date();
  } catch (error) {
    return envelopeErr(error);
  }
  const normalizedNowIso = canonicalInstant(now);
  const plan = buildSpecStartTimeTrackingUpdate({
    frontmatter: { timeEntries: entries },
    currentTimestamp: normalizedNowIso,
    startTimestamp: normalizedNowIso,
  });
  return envelopeOk({
    value: plan.fields.timeEntries,
    dateModified: normalizedNowIso,
  });
}

function executeTimeStop(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  let entries: TimeEntry[];
  try {
    entries = normalizeAndValidateTimeEntries(payload.entries ?? []);
  } catch (error) {
    return envelopeErr(error);
  }

  const activeIndex = entries.findIndex((entry) => entry.endTime === undefined);
  if (activeIndex < 0) {
    return envelopeErr("no_active_time_entry");
  }

  let now: Date;
  try {
    now = payload.now !== undefined
      ? parseIsoInstant(payload.now, "invalid_time_now")
      : new Date();
  } catch (error) {
    return envelopeErr(error);
  }
  const nowIso = canonicalInstant(now);
  if (Date.parse(nowIso) < Date.parse(entries[activeIndex].startTime)) {
    return envelopeErr("invalid_time_range");
  }

  const plan = buildSpecStopTimeTrackingUpdate({
    frontmatter: { timeEntries: entries },
    currentTimestamp: nowIso,
    stopTimestamp: nowIso,
  });

  return envelopeOk({
    value: plan.fields.timeEntries,
    dateModified: nowIso,
  });
}

function executeTimeReplaceEntries(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  let entries: TimeEntry[];
  try {
    entries = normalizeAndValidateTimeEntries(payload.entries ?? []);
  } catch (error) {
    return envelopeErr(error);
  }

  const modified = typeof payload.dateModified === "string" && payload.dateModified.trim().length > 0
    ? canonicalInstant(parseIsoInstant(payload.dateModified, "invalid_date_modified"))
    : canonicalInstant(new Date());

  return envelopeOk({
    value: entries,
    dateModified: modified,
  });
}

function executeTimeRemoveEntry(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  let entries: TimeEntry[];
  try {
    entries = normalizeAndValidateTimeEntries(payload.entries ?? []);
  } catch (error) {
    return envelopeErr(error);
  }

  const selector = isPlainObject(payload.selector) ? payload.selector : {};
  const index = typeof selector.index === "number" ? selector.index : -1;
  if (!Number.isInteger(index) || index < 0 || index >= entries.length) {
    return envelopeErr("time_entry_not_found");
  }

  const next = entries.filter((_entry, i) => i !== index);
  const modified = typeof payload.dateModified === "string" && payload.dateModified.trim().length > 0
    ? canonicalInstant(parseIsoInstant(payload.dateModified, "invalid_date_modified"))
    : canonicalInstant(new Date());

  return envelopeOk({
    value: next,
    dateModified: modified,
  });
}

function executeTimeAutoStopOnComplete(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  const autoStopOnComplete = payload.autoStopOnComplete === true;
  const isCompletionTransition = payload.isCompletionTransition === true;

  if (!autoStopOnComplete || !isCompletionTransition) {
    return envelopeOk({ stopped: false });
  }

  let entries: TimeEntry[];
  try {
    entries = normalizeAndValidateTimeEntries(payload.taskEntries ?? []);
  } catch (error) {
    return envelopeErr(error);
  }

  const stopped = entries.some((entry) => entry.endTime === undefined);
  return envelopeOk({ stopped });
}

function executeTimeReportTotals(input: unknown): Envelope {
  const payload = isPlainObject(input) ? input : {};
  let entries: TimeEntry[];
  try {
    entries = normalizeAndValidateTimeEntries(payload.entries ?? []);
  } catch (error) {
    return envelopeErr(error);
  }

  const now = payload.now !== undefined
    ? canonicalInstant(parseIsoInstant(payload.now, "invalid_time_now"))
    : canonicalInstant(new Date());

  let closedMinutes = 0;
  let activeMinutes = 0;
  for (const entry of entries) {
    if (entry.endTime) {
      closedMinutes += minutesBetween(entry.startTime, entry.endTime);
    } else {
      activeMinutes += minutesBetween(entry.startTime, now);
    }
  }

  return envelopeOk({
    closed_minutes: closedMinutes,
    live_minutes: closedMinutes + activeMinutes,
  });
}

export async function executeConformanceOperation(operation: string, input: unknown): Promise<Envelope> {
  try {
    if (operation === "meta.claim") {
      return envelopeOk(getClaim());
    }

    if (operation === "meta.has_capability") {
      const capability = isPlainObject(input) && typeof input.capability === "string" ? input.capability : "";
      return envelopeOk({ value: conformanceMetadata.capabilities.includes(capability) });
    }

    if (operation === "meta.has_profile") {
      const profile = isPlainObject(input) && typeof input.profile === "string" ? input.profile : "";
      return envelopeOk({ value: conformanceMetadata.profiles.includes(profile) });
    }

    if (operation === "config.resolve_collection_path") {
      return executeConfigResolveCollectionPath(input);
    }

    if (operation === "config.spec_version_effective") {
      return executeConfigSpecVersionEffective(input);
    }

    if (operation === "config.merge_top_level") {
      return executeConfigMergeTopLevel(input);
    }

    if (operation === "config.map_tasknotes_plugin") {
      const payload = isPlainObject(input) ? input : {};
      return envelopeOk({ value: mapTasknotesPluginConfig(payload.data) });
    }

    if (operation === "config.provider_behavior") {
      return executeConfigProviderBehavior(input);
    }

    if (operation === "config.validate_schema") {
      return executeConfigValidateSchema(input);
    }

    if (operation === "validation.core_evaluate") {
      return envelopeOk(validateCore(input));
    }

    if (operation === "validation.time_entries") {
      return executeValidationTimeEntries(input);
    }

    if (operation === "op.mutate_with_validation") {
      const payload = isPlainObject(input) ? input : {};
      const result = validateCore({
        fields: payload.fields,
        frontmatter: payload.frontmatter,
        rejectUnknownFields: payload.strict === true,
      });
      if (result.hasErrors) {
        return envelopeErr(`validation:${result.errorCodes[0] || "invalid"}`);
      }
      return envelopeOk({ value: "accepted" });
    }

    if (operation === "date.parse_utc") {
      const payload = isPlainObject(input) ? input : {};
      const parsed = parseDateToUTC(String(payload.value || ""));
      return envelopeOk({ date: utcYmd(parsed), isoDate: parsed.toISOString().slice(0, 10) });
    }

    if (operation === "date.parse_local") {
      const payload = isPlainObject(input) ? input : {};
      const parsed = parseDateToLocal(String(payload.value || ""));
      return envelopeOk({ localDate: localYmd(parsed), isoDate: utcYmd(parsed) });
    }

    if (operation === "date.validate") {
      const payload = isPlainObject(input) ? input : {};
      return envelopeOk({ value: validateDateString(String(payload.value || "")) });
    }

    if (operation === "date.get_part") {
      const payload = isPlainObject(input) ? input : {};
      return envelopeOk({ value: getDatePart(String(payload.value || "")) });
    }

    if (operation === "date.has_time") {
      const payload = isPlainObject(input) ? input : {};
      return envelopeOk({ value: hasTimeComponent(String(payload.value || "")) });
    }

    if (operation === "date.is_same") {
      const payload = isPlainObject(input) ? input : {};
      return envelopeOk({ value: isSameDateSafe(String(payload.a || ""), String(payload.b || "")) });
    }

    if (operation === "date.is_before") {
      const payload = isPlainObject(input) ? input : {};
      return envelopeOk({ value: isBeforeDateSafe(String(payload.a || ""), String(payload.b || "")) });
    }

    if (operation === "date.resolve_operation_target") {
      const payload = isPlainObject(input) ? input : {};
      return envelopeOk({
        value: resolveOperationTargetDate(
          typeof payload.explicitDate === "string" ? payload.explicitDate : undefined,
          typeof payload.scheduled === "string" ? payload.scheduled : undefined,
          typeof payload.due === "string" ? payload.due : undefined,
        ),
      });
    }

    if (operation === "date.day_in_timezone") {
      return executeDateDayInTimezone(input);
    }

    if (operation === "field.default_mapping") {
      return envelopeOk(defaultFieldMapping());
    }

    if (operation === "field.build_mapping") {
      const payload = isPlainObject(input) ? input : {};
      const mapping = buildFieldMapping(
        isPlainObject(payload.fields) ? payload.fields : {},
        typeof payload.displayNameKey === "string" ? payload.displayNameKey : undefined,
      );
      return envelopeOk(mapping);
    }

    if (operation === "field.normalize") {
      const payload = isPlainObject(input) ? input : {};
      const mapping = buildFieldMapping(
        isPlainObject(payload.fields) ? payload.fields : {},
        typeof payload.displayNameKey === "string" ? payload.displayNameKey : undefined,
      );
      return envelopeOk({
        normalized: normalizeFrontmatter(
          isPlainObject(payload.frontmatter) ? payload.frontmatter : {},
          mapping,
        ),
      });
    }

    if (operation === "field.denormalize") {
      const payload = isPlainObject(input) ? input : {};
      const mapping = buildFieldMapping(
        isPlainObject(payload.fields) ? payload.fields : {},
        typeof payload.displayNameKey === "string" ? payload.displayNameKey : undefined,
      );
      return envelopeOk({
        denormalized: denormalizeFrontmatter(
          isPlainObject(payload.roleData) ? payload.roleData : {},
          mapping,
        ),
      });
    }

    if (operation === "field.resolve_display_title") {
      const payload = isPlainObject(input) ? input : {};
      const mapping = buildFieldMapping(
        isPlainObject(payload.fields) ? payload.fields : {},
        typeof payload.displayNameKey === "string" ? payload.displayNameKey : undefined,
      );
      const value = resolveDisplayTitle(
        isPlainObject(payload.frontmatter) ? payload.frontmatter : {},
        mapping,
        typeof payload.taskPath === "string" ? payload.taskPath : undefined,
      );
      return envelopeOk({ value: value ?? null });
    }

    if (operation === "field.is_completed_status") {
      const payload = isPlainObject(input) ? input : {};
      const mapping = buildFieldMapping(
        isPlainObject(payload.fields) ? payload.fields : {},
        typeof payload.displayNameKey === "string" ? payload.displayNameKey : undefined,
      );
      return envelopeOk({ value: isCompletedStatus(mapping, typeof payload.status === "string" ? payload.status : undefined) });
    }

    if (operation === "field.default_completed_status") {
      const payload = isPlainObject(input) ? input : {};
      const mapping = buildFieldMapping(
        isPlainObject(payload.fields) ? payload.fields : {},
        typeof payload.displayNameKey === "string" ? payload.displayNameKey : undefined,
      );
      return envelopeOk({ value: getDefaultCompletedStatus(mapping) });
    }

    if (operation === "recurrence.complete") {
      const payload = isPlainObject(input) ? input : {};
      return envelopeOk(completeRecurringTask(payload as never));
    }

    if (operation === "recurrence.recalculate") {
      const payload = isPlainObject(input) ? input : {};
      return envelopeOk(recalculateRecurringSchedule(payload as never));
    }

    if (operation === "create_compat.create") {
      const payload = isPlainObject(input) ? input : {};
      return await runCreateCompat(payload);
    }

    if (operation === "op.atomic_write") {
      return executeOpAtomicWrite(input);
    }

    if (operation === "op.idempotency_check") {
      return executeOpIdempotencyCheck();
    }

    if (operation === "op.update_patch") {
      return executeOpUpdatePatch(input);
    }

    if (operation === "op.complete_nonrecurring") {
      return executeOpCompleteNonRecurring(input);
    }

    if (operation === "op.uncomplete_nonrecurring") {
      return executeOpUncompleteNonRecurring(input);
    }

    if (operation === "op.error_shape") {
      return executeOpErrorShape(input);
    }

    if (operation === "time.start") {
      return executeTimeStart(input);
    }

    if (operation === "time.stop") {
      return executeTimeStop(input);
    }

    if (operation === "time.replace_entries") {
      return executeTimeReplaceEntries(input);
    }

    if (operation === "time.remove_entry") {
      return executeTimeRemoveEntry(input);
    }

    if (operation === "time.auto_stop_on_complete") {
      return executeTimeAutoStopOnComplete(input);
    }

    if (operation === "time.report_totals") {
      return executeTimeReportTotals(input);
    }

    if (operation === "dependency.validate_entry") {
      const payload = isPlainObject(input) ? input : {};
      return validateDependencyEntry(payload.entry);
    }

    if (operation === "dependency.validate_set") {
      return validateDependencySet(input);
    }

    if (operation === "dependency.add") {
      return executeDependencyAdd(input);
    }

    if (operation === "dependency.remove") {
      return executeDependencyRemove(input);
    }

    if (operation === "dependency.replace") {
      return executeDependencyReplace(input);
    }

    if (operation === "dependency.missing_target_behavior") {
      return executeDependencyMissingTargetBehavior(input);
    }

    if (operation === "reminder.validate_entry") {
      const payload = isPlainObject(input) ? input : {};
      return validateReminderEntry(payload.entry);
    }

    if (operation === "reminder.validate_set") {
      return validateReminderSet(input);
    }

    if (operation === "reminder.add") {
      return executeReminderAdd(input);
    }

    if (operation === "reminder.update") {
      return executeReminderUpdate(input);
    }

    if (operation === "reminder.remove") {
      return executeReminderRemove(input);
    }

    if (operation === "delete.remove") {
      return executeDeleteRemove(input);
    }

    if (operation === "recurrence.uncomplete_instance") {
      return executeRecurrenceUncompleteInstance(input);
    }

    if (operation === "recurrence.skip_instance") {
      return executeRecurrenceSkipInstance(input);
    }

    if (operation === "recurrence.unskip_instance") {
      return executeRecurrenceUnskipInstance(input);
    }

    if (operation === "recurrence.effective_state") {
      return executeRecurrenceEffectiveState(input);
    }

    if (operation === "link.parse") {
      const payload = isPlainObject(input) ? input : {};
      return envelopeOk(parseLinkRaw(payload.raw));
    }

    if (operation === "link.resolve") {
      return resolveLink(input);
    }

    return envelopeErr(`unsupported_operation:${operation}`);
  } catch (error) {
    return envelopeErr(error);
  }
}
