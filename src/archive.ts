import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { join } from "node:path";
import YAML from "yaml";
import {
	TASKNOTES_SETTINGS_APP,
	appSettingsPath,
	resolveTaskNotesAppSettings,
} from "@tasknotes/model";
import { resolveCollectionPath } from "./config.js";
import {
	DEFAULT_ARCHIVE_TAG,
	findTaskNotesImplementation,
	loadRawTaskType,
} from "./field-mapping.js";

/**
 * TaskNotes' default archive folder, used when moving is on and
 * `archive_folder` is empty (TaskNotes `DEFAULT_SETTINGS.archiveFolder`).
 */
export const DEFAULT_ARCHIVE_FOLDER = "TaskNotes/Archive";

export interface ArchiveSettings {
	/** The tag that marks a task archived. */
	tag: string;
	/** Move the task's file when it is archived or unarchived. */
	move: boolean;
	/** Folder template archived tasks move to. */
	archiveFolder: string;
	/** Folder template unarchived tasks move back to, when the type names one. */
	tasksFolder?: string;
}

/**
 * Archive behaviour for the collection: the tag from the task type's
 * tasknotes.task binding, and the move settings from TaskNotes' settings
 * record (`_settings/dev.tasknotes.md`), falling back to an older binding's
 * `archive.move_on_archive` / `archive.folder`. Types without a
 * tasknotes.task binding (v0.2) tag with "archive" and never move.
 */
export async function loadArchiveSettings(flagPath?: string): Promise<ArchiveSettings> {
	const type = await loadRawTaskType(flagPath);
	const implementation = findTaskNotesImplementation(type);
	const binding = isRecord(implementation?.binding) ? implementation.binding : undefined;
	const archive = isRecord(binding?.archive) ? binding.archive : {};
	const tag = nonEmpty(archive.archived_tag) ?? DEFAULT_ARCHIVE_TAG;

	if (!implementation) {
		return { tag, move: false, archiveFolder: DEFAULT_ARCHIVE_FOLDER };
	}

	const settings = resolveTaskNotesAppSettings(readSettingsRecord(flagPath), {
		legacyBinding: binding,
	}).values;
	const collection = isRecord(type?.collection) ? type.collection : {};
	const path = isRecord(collection.path) ? collection.path : {};

	return {
		tag,
		move: settings.move_on_archive === true,
		archiveFolder: nonEmpty(settings.archive_folder) ?? DEFAULT_ARCHIVE_FOLDER,
		tasksFolder: nonEmpty(path.folder),
	};
}

function readSettingsRecord(flagPath?: string): Record<string, unknown> | undefined {
	try {
		const file = join(resolveCollectionPath(flagPath), appSettingsPath(TASKNOTES_SETTINGS_APP));
		if (!existsSync(file)) return undefined;
		const match = readFileSync(file, "utf8")
			.replace(/^﻿/, "")
			.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
		if (!match) return undefined;
		const parsed = YAML.parse(match[1]);
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/** `folder/basename(path)`, or undefined when the task is already there. */
export function destinationPath(taskPath: string, folder: string): string | undefined {
	const target = folder ? posix.join(folder, posix.basename(taskPath)) : posix.basename(taskPath);
	return target === taskPath ? undefined : target;
}

function nonEmpty(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
