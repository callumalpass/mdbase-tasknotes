import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Collection } from "@callumalpass/mdbase";
import { withCollection, resolveTaskPath } from "../collection.js";
import { resolveCollectionPath } from "../config.js";
import { renderFolderTemplate } from "../create-compat.js";
import { showError, showSuccess } from "../format.js";
import {
  type FieldMapping,
  normalizeFrontmatter,
  denormalizeFrontmatter,
  resolveDisplayTitle,
} from "../field-mapping.js";
import { destinationPath, loadArchiveSettings } from "../archive.js";

type Direction = "archive" | "unarchive";

/**
 * Archive a task: add the archive tag and, when the collection's TaskNotes
 * settings say so (`move_on_archive`), move the file into the archive folder.
 */
export async function archiveCommand(
  pathOrTitle: string,
  options: { path?: string },
): Promise<void> {
  await toggleArchive("archive", pathOrTitle, options);
}

/**
 * Unarchive a task: remove the archive tag and, when moving is on, move the
 * file back to the type's tasks folder.
 */
export async function unarchiveCommand(
  pathOrTitle: string,
  options: { path?: string },
): Promise<void> {
  await toggleArchive("unarchive", pathOrTitle, options);
}

async function toggleArchive(
  direction: Direction,
  pathOrTitle: string,
  options: { path?: string },
): Promise<void> {
  try {
    const settings = await loadArchiveSettings(options.path);
    const root = resolveCollectionPath(options.path);
    await withCollection(async (collection, mapping) => {
      const taskPath = await resolveTaskPath(collection, pathOrTitle, mapping);
      const read = await collection.read(taskPath);

      if (read.error) {
        fail(`Failed to read task: ${read.error.message}`);
      }

      const raw = read.frontmatter as Record<string, unknown>;
      const fm = normalizeFrontmatter(raw, mapping);
      const taskTitle = resolveDisplayTitle(fm, mapping, taskPath) || taskPath;
      const tags = Array.isArray(fm.tags) ? [...(fm.tags as string[])] : [];
      const isArchived = tags.includes(settings.tag);

      if (direction === "archive" && isArchived) {
        showSuccess(`Task "${taskTitle}" is already archived.`);
        return;
      }
      if (direction === "unarchive" && !isArchived) {
        showSuccess(`Task "${taskTitle}" is not archived.`);
        return;
      }

      // Work out the move before writing anything, so a refused move leaves
      // the task unchanged.
      const target = settings.move
        ? planMove(direction, taskPath, raw, mapping, settings, root)
        : undefined;

      const nextTags = direction === "archive"
        ? [...tags, settings.tag]
        : tags.filter((tag) => tag !== settings.tag);
      const result = await collection.update({
        path: taskPath,
        fields: denormalizeFrontmatter({ tags: nextTags }, mapping),
      });
      if (result.error) {
        fail(`Failed to ${direction} task: ${result.error.message}`);
      }

      const verb = direction === "archive" ? "Archived" : "Unarchived";
      if (!target) {
        showSuccess(`${verb}: ${taskTitle}`);
        return;
      }

      const moved = await moveTask(collection, taskPath, target);
      if (moved) {
        fail(`${verb} "${taskTitle}" but could not move it to ${target}: ${moved}`);
      }
      showSuccess(`${verb}: ${taskTitle} → ${target}`);
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}

function planMove(
  direction: Direction,
  taskPath: string,
  frontmatter: Record<string, unknown>,
  mapping: FieldMapping,
  settings: Awaited<ReturnType<typeof loadArchiveSettings>>,
  root: string,
): string | undefined {
  const template = direction === "archive" ? settings.archiveFolder : settings.tasksFolder;
  if (!template) {
    // No tasks folder in the type: leave an unarchived task where it is.
    return undefined;
  }
  const folder = renderFolderTemplate(template, frontmatter, mapping);
  if (folder === undefined) {
    fail(`The ${direction === "archive" ? "archive" : "tasks"} folder "${template}" is not a path inside the collection.`);
  }
  // Unarchive leaves a task that is already somewhere in the tasks folder.
  if (direction === "unarchive" && folder && taskPath.startsWith(`${folder}/`)) {
    return undefined;
  }
  const target = destinationPath(taskPath, folder);
  if (target && existsSync(join(root, target))) {
    fail(`Not ${direction === "archive" ? "archived" : "unarchived"}: ${target} already exists. Rename or move one of the files first.`);
  }
  return target;
}

/** Move the file; links in other notes are not rewritten. Returns an error message on failure. */
async function moveTask(
  collection: Collection,
  from: string,
  to: string,
): Promise<string | undefined> {
  const result = await collection.rename({ from, to, update_refs: false }) as {
    error?: { message?: string };
  };
  return result?.error ? result.error.message ?? "rename failed" : undefined;
}

function fail(message: string): never {
  showError(message);
  process.exit(1);
}
