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

export function defaultFieldMapping(): FieldMapping {
	return defaultSpecFieldMapping();
}

export function buildFieldMapping(
	fields: Record<string, unknown>,
	displayNameKey?: string
): FieldMapping {
	return buildSpecFieldMapping(fields, displayNameKey);
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
		const typeRecord = typeResult.type as Record<string, unknown>;
		const displayNameKey =
			typeof typeRecord.display_name_key === "string"
				? typeRecord.display_name_key
				: typeof typeRecord.displayNameKey === "string"
					? typeRecord.displayNameKey
					: undefined;
		const fields = isRecord(typeRecord.fields) ? typeRecord.fields : {};

		return buildFieldMapping(fields, displayNameKey);
	} catch {
		return defaultFieldMapping();
	}
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
