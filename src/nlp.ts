import { loadConfig, getType } from "@callumalpass/mdbase";
import {
  NaturalLanguageParserCore,
  type StatusConfig,
  type PriorityConfig,
} from "tasknotes-nlp-core";
import { resolveCollectionPath } from "./config.js";
import { validateDateString } from "./date.js";
import { buildFieldMapping } from "./field-mapping.js";

export async function createParser(flagPath?: string): Promise<NaturalLanguageParserCore> {
  const collectionPath = resolveCollectionPath(flagPath);

  // Load the task type definition to extract status and priority enums
  const configResult = await loadConfig(collectionPath);
  if (!configResult.valid || !configResult.config) {
    throw new Error(`Failed to load mdbase config at ${collectionPath}: ${configResult.error?.message}`);
  }

  const typeResult = await getType(collectionPath, configResult.config, "task");
  if (!typeResult.valid || !typeResult.type) {
    throw new Error(`Failed to load task type definition: ${typeResult.error?.message}`);
  }

  const fields = typeResult.type.fields || {};
  const mapping = buildFieldMapping(fields);

  // Build StatusConfig from status enum values
  const statusConfigs: StatusConfig[] = [];
  const statusField = fields[mapping.roleToField.status];
  const completedSet = new Set(mapping.completedStatuses);
  if (statusField?.values) {
    statusField.values.forEach((value: string, index: number) => {
      const isCompleted = completedSet.has(value);
      statusConfigs.push({
        id: value,
        value,
        label: value.charAt(0).toUpperCase() + value.slice(1).replace(/-/g, " "),
        color: isCompleted ? "#888888" : "#ffffff",
        isCompleted,
        order: index,
        autoArchive: false,
        autoArchiveDelay: 0,
      });
    });
  }

  // Build PriorityConfig from priority enum values
  const priorityConfigs: PriorityConfig[] = [];
  const priorityField = fields[mapping.roleToField.priority];
  if (priorityField?.values) {
    priorityField.values.forEach((value: string, index: number) => {
      priorityConfigs.push({
        id: value,
        value,
        label: value.charAt(0).toUpperCase() + value.slice(1),
        color: "#ffffff",
        weight: index,
      });
    });
  }

  return new NaturalLanguageParserCore(statusConfigs, priorityConfigs, true, "en");
}

export async function resolveDueDateExpression(input: string, flagPath?: string): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Due date cannot be empty.");
  }

  try {
    return validateDateString(trimmed);
  } catch {
    // Fall through to natural-language parsing.
  }

  const parser = await createParser(flagPath);
  const direct = parser.parseInput(trimmed);
  if (direct.dueDate) {
    return validateDateString(direct.dueDate);
  }

  const forcedDue = parser.parseInput(`due ${trimmed}`);
  if (forcedDue.dueDate) {
    return validateDateString(forcedDue.dueDate);
  }

  if (direct.scheduledDate) {
    return validateDateString(direct.scheduledDate);
  }

  throw new Error(
    `Could not parse due date "${input}". Try YYYY-MM-DD or a natural-language date like "tomorrow".`,
  );
}
