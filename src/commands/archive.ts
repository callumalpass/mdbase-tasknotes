import { withCollection, resolveTaskPath } from "../collection.js";
import { showError, showSuccess } from "../format.js";
import {
  normalizeFrontmatter,
  denormalizeFrontmatter,
  resolveDisplayTitle,
  loadArchiveTag,
} from "../field-mapping.js";

export async function archiveCommand(
  pathOrTitle: string,
  options: { path?: string },
): Promise<void> {
  try {
    const archiveTag = await loadArchiveTag(options.path);
    await withCollection(async (collection, mapping) => {
      const taskPath = await resolveTaskPath(collection, pathOrTitle, mapping);
      const read = await collection.read(taskPath);

      if (read.error) {
        showError(`Failed to read task: ${read.error.message}`);
        process.exit(1);
      }

      const fm = normalizeFrontmatter(read.frontmatter as Record<string, unknown>, mapping);
      const taskTitle = resolveDisplayTitle(fm, mapping, taskPath) || taskPath;
      const tags = Array.isArray(fm.tags) ? [...(fm.tags as string[])] : [];

      if (tags.includes(archiveTag)) {
        showSuccess(`Task "${taskTitle}" is already archived.`);
        return;
      }

      tags.push(archiveTag);

      const result = await collection.update({
        path: taskPath,
        fields: denormalizeFrontmatter({ tags }, mapping),
      });

      if (result.error) {
        showError(`Failed to archive task: ${result.error.message}`);
        process.exit(1);
      }

      showSuccess(`Archived: ${taskTitle}`);
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}
