import { loadConfig, getType } from "@callumalpass/mdbase";
import {
	buildSpecFieldMapping,
	defaultSpecFieldMapping,
	denormalizeSpecFrontmatter,
	getDefaultSpecCompletedStatus,
	isSpecCompletedStatus,
	normalizeSpecFrontmatter,
	resolveDisplayTitle,
} from "@tasknotes/model/config";
import type { FieldRole, SpecFieldMapping } from "@tasknotes/model";
import { resolveCollectionPath } from "./config.js";

export type { FieldRole };
export type FieldMapping = SpecFieldMapping;

export interface NormalizedTaskType {
	fields: Record<string, Record<string, unknown>>;
	displayNameKey?: string;
	/** `implements[tasknotes.task].binding.archive.archived_tag`, when set. */
	archiveTag?: string;
}

/** The tag `mtn archive` adds when the task type does not bind one. */
export const DEFAULT_ARCHIVE_TAG = "archive";

export function defaultFieldMapping(): FieldMapping {
	return defaultSpecFieldMapping();
}

export function buildFieldMapping(
	fields: Record<string, unknown>,
	displayNameKey?: string
): FieldMapping {
	return buildSpecFieldMapping(fields, displayNameKey);
}

export function normalizeTaskTypeDefinition(value: unknown): NormalizedTaskType {
	if (!isRecord(value)) return { fields: {} };

	const legacyFields = isRecord(value.fields) ? value.fields : undefined;
	if (legacyFields) {
		return {
			fields: legacyFields as Record<string, Record<string, unknown>>,
			displayNameKey:
				typeString(value.display_name_key) ?? typeString(value.displayNameKey),
		};
	}

	const schema = isRecord(value.schema) && isRecord(value.schema.value)
		? value.schema.value
		: {};
	const properties = isRecord(schema.properties) ? schema.properties : {};
	const fields: Record<string, Record<string, unknown>> = {};
	for (const [fieldName, property] of Object.entries(properties)) {
		fields[fieldName] = jsonSchemaToLegacyField(property);
	}

	const collection = isRecord(value.collection) ? value.collection : {};
	const readDefaults = isRecord(collection.read_defaults) ? collection.read_defaults : {};
	for (const [fieldName, defaultValue] of Object.entries(readDefaults)) {
		fields[fieldName] ??= {};
		fields[fieldName].default = defaultValue;
	}

	const implementation = Array.isArray(value.implements)
		? value.implements.find((candidate) =>
				isRecord(candidate) &&
				candidate.contract === "tasknotes.task" &&
				typeof candidate.version === "string"
			)
		: undefined;
	const roles = isRecord(implementation) && isRecord(implementation.fields)
		? implementation.fields
		: {};
	for (const [role, fieldNameValue] of Object.entries(roles)) {
		const fieldName = typeString(fieldNameValue);
		if (!fieldName) continue;
		fields[fieldName] ??= {};
		fields[fieldName].tn_role = role;
	}

	const binding = isRecord(implementation) && isRecord(implementation.binding)
		? implementation.binding
		: {};
	const status = isRecord(binding.status) ? binding.status : {};
	const statusField = typeString(roles.status);
	if (statusField && Array.isArray(status.completed_values)) {
		fields[statusField] ??= {};
		fields[statusField].tn_completed_values = status.completed_values;
	}

	const archive = isRecord(binding.archive) ? binding.archive : {};
	const archiveTag = typeString(archive.archived_tag)?.trim();

	const display = isRecord(collection.display) ? collection.display : {};
	return {
		fields,
		displayNameKey: typeString(display.name_field),
		...(archiveTag ? { archiveTag } : {}),
	};
}

export function isCompletedStatus(
	mapping: FieldMapping,
	status: string | undefined
): boolean {
	return isSpecCompletedStatus(mapping, status);
}

export function getDefaultCompletedStatus(mapping: FieldMapping): string {
	return getDefaultSpecCompletedStatus(mapping);
}

/** The `task` type definition as mdbase loads it, before normalization. */
export async function loadRawTaskType(flagPath?: string): Promise<Record<string, unknown> | undefined> {
	try {
		const collectionPath = resolveCollectionPath(flagPath);
		const configResult = await loadConfig(collectionPath);
		if (!configResult.valid || !configResult.config) return undefined;
		const typeResult = await getType(collectionPath, configResult.config, "task");
		if (!typeResult.valid || !typeResult.type) return undefined;
		return isRecord(typeResult.type) ? typeResult.type : undefined;
	} catch {
		return undefined;
	}
}

async function loadTaskType(flagPath?: string): Promise<NormalizedTaskType | undefined> {
	const raw = await loadRawTaskType(flagPath);
	return raw ? normalizeTaskTypeDefinition(raw) : undefined;
}

/** The type's `implements` entry for the tasknotes.task contract, if any. */
export function findTaskNotesImplementation(
	type: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
	if (!type || !Array.isArray(type.implements)) return undefined;
	const found = type.implements.find((candidate) =>
		isRecord(candidate) &&
		candidate.contract === "tasknotes.task" &&
		typeof candidate.version === "string"
	);
	return isRecord(found) ? found : undefined;
}

export async function loadFieldMapping(flagPath?: string): Promise<FieldMapping> {
	const normalized = await loadTaskType(flagPath);
	return normalized
		? buildFieldMapping(normalized.fields, normalized.displayNameKey)
		: defaultFieldMapping();
}

/** The archive tag the task type binds, or DEFAULT_ARCHIVE_TAG. */
export async function loadArchiveTag(flagPath?: string): Promise<string> {
	return (await loadTaskType(flagPath))?.archiveTag ?? DEFAULT_ARCHIVE_TAG;
}

export function normalizeFrontmatter(
	raw: Record<string, unknown>,
	mapping: FieldMapping
): Record<string, unknown> {
	return normalizeSpecFrontmatter(raw, mapping);
}

export function denormalizeFrontmatter(
	roleData: Record<string, unknown>,
	mapping: FieldMapping
): Record<string, unknown> {
	return denormalizeSpecFrontmatter(roleData, mapping);
}

export function resolveField(mapping: FieldMapping, role: FieldRole): string {
	return mapping.roleToField[role];
}

export { resolveDisplayTitle };

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function typeString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function jsonSchemaToLegacyField(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) return {};
	const field: Record<string, unknown> = {};
	if (Array.isArray(value.enum)) {
		field.type = "enum";
		field.values = value.enum;
	} else {
		switch (value.type) {
			case "string":
				field.type = value.format === "date"
					? "date"
					: value.format === "date-time"
						? "datetime"
						: value.format === "time"
							? "time"
							: "string";
				break;
			case "integer":
			case "number":
			case "boolean":
				field.type = value.type;
				break;
			case "array":
				field.type = "list";
				field.items = jsonSchemaToLegacyField(value.items);
				break;
			case "object": {
				field.type = "object";
				const properties = isRecord(value.properties) ? value.properties : {};
				field.fields = Object.fromEntries(
					Object.entries(properties).map(([name, property]) => [
						name,
						jsonSchemaToLegacyField(property),
					]),
				);
				break;
			}
			default:
				field.type = "any";
		}
	}
	if (value.default !== undefined) field.default = value.default;
	if (value.description !== undefined) field.description = value.description;
	return field;
}
