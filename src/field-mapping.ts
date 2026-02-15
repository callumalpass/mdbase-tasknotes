import { loadConfig, getType } from "@callumalpass/mdbase";
import { resolveCollectionPath } from "./config.js";

export type FieldRole =
  | "title"
  | "status"
  | "priority"
  | "due"
  | "scheduled"
  | "completedDate"
  | "tags"
  | "contexts"
  | "projects"
  | "timeEstimate"
  | "dateCreated"
  | "dateModified"
  | "recurrence"
  | "recurrenceAnchor"
  | "timeEntries";

const ALL_ROLES: FieldRole[] = [
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
  "timeEntries",
];

export interface FieldMapping {
  roleToField: Record<FieldRole, string>;
  fieldToRole: Record<string, FieldRole>;
}

/**
 * Identity mapping where every role maps to a field of the same name.
 */
export function defaultFieldMapping(): FieldMapping {
  const roleToField = {} as Record<FieldRole, string>;
  const fieldToRole = {} as Record<string, FieldRole>;

  for (const role of ALL_ROLES) {
    roleToField[role] = role;
    fieldToRole[role] = role;
  }

  return { roleToField, fieldToRole };
}

/**
 * Scan type definition fields for `tn_role` annotations and build a
 * bidirectional mapping. Falls back to identity if the field name itself
 * matches a known role.
 */
export function buildFieldMapping(fields: Record<string, any>): FieldMapping {
  const roleToField = {} as Record<FieldRole, string>;
  const fieldToRole = {} as Record<string, FieldRole>;
  const rolesSet = new Set<string>(ALL_ROLES);

  // First pass: explicit tn_role annotations
  for (const [fieldName, def] of Object.entries(fields)) {
    if (def && typeof def === "object" && typeof def.tn_role === "string") {
      const role = def.tn_role as FieldRole;
      if (!rolesSet.has(role)) continue;
      if (roleToField[role] !== undefined) {
        console.warn(`[mtn] Duplicate tn_role "${role}" on field "${fieldName}", ignoring.`);
        continue;
      }
      roleToField[role] = fieldName;
      fieldToRole[fieldName] = role;
    }
  }

  // Second pass: identity fallback for roles not yet assigned
  for (const role of ALL_ROLES) {
    if (roleToField[role] === undefined) {
      if (fields[role] !== undefined) {
        // Field name matches role name — use identity mapping
        roleToField[role] = role;
        if (fieldToRole[role] === undefined) {
          fieldToRole[role] = role;
        }
      } else {
        // No matching field at all — still use identity so code doesn't break
        roleToField[role] = role;
      }
    }
  }

  return { roleToField, fieldToRole };
}

/**
 * Load the field mapping from the task type definition in the collection.
 * Returns default (identity) mapping on failure.
 */
export async function loadFieldMapping(flagPath?: string): Promise<FieldMapping> {
  try {
    const collectionPath = resolveCollectionPath(flagPath);
    const configResult = await loadConfig(collectionPath);
    if (!configResult.valid || !configResult.config) {
      return defaultFieldMapping();
    }
    const typeResult = await getType(collectionPath, configResult.config, "task");
    if (!typeResult.valid || !typeResult.type) {
      return defaultFieldMapping();
    }
    return buildFieldMapping(typeResult.type.fields || {});
  } catch {
    return defaultFieldMapping();
  }
}

/**
 * Translate actual frontmatter field names to role names.
 * Unknown keys are passed through unchanged.
 */
export function normalizeFrontmatter(
  raw: Record<string, unknown>,
  mapping: FieldMapping,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const role = mapping.fieldToRole[key];
    result[role ?? key] = value;
  }
  return result;
}

/**
 * Translate role-keyed data to actual field names.
 * Unknown keys are passed through unchanged.
 */
export function denormalizeFrontmatter(
  roleData: Record<string, unknown>,
  mapping: FieldMapping,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const rolesSet = new Set<string>(ALL_ROLES);
  for (const [key, value] of Object.entries(roleData)) {
    if (rolesSet.has(key)) {
      result[mapping.roleToField[key as FieldRole]] = value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Shorthand to get the actual field name for a role.
 */
export function resolveField(mapping: FieldMapping, role: FieldRole): string {
  return mapping.roleToField[role];
}
