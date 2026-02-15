import { withCollection, resolveTaskPath } from "../collection.js";
import { showError, showSuccess } from "../format.js";

export async function archiveCommand(
  pathOrTitle: string,
  options: { path?: string },
): Promise<void> {
  try {
    await withCollection(async (collection) => {
      const taskPath = await resolveTaskPath(collection, pathOrTitle);
      const read = await collection.read(taskPath);

      if (read.error) {
        showError(`Failed to read task: ${read.error.message}`);
        process.exit(1);
      }

      const fm = read.frontmatter as Record<string, unknown>;
      const tags = Array.isArray(fm.tags) ? [...(fm.tags as string[])] : [];

      if (tags.includes("archive")) {
        showSuccess(`Task "${fm.title}" is already archived.`);
        return;
      }

      tags.push("archive");

      const result = await collection.update({
        path: taskPath,
        fields: { tags },
      });

      if (result.error) {
        showError(`Failed to archive task: ${result.error.message}`);
        process.exit(1);
      }

      showSuccess(`Archived: ${fm.title}`);
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}
