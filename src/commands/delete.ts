import { withCollection, resolveTaskPath } from "../collection.js";
import { showError, showSuccess, showWarning } from "../format.js";

export async function deleteCommand(
  pathOrTitle: string,
  options: { path?: string; force?: boolean },
): Promise<void> {
  try {
    await withCollection(async (collection) => {
      const taskPath = await resolveTaskPath(collection, pathOrTitle);

      // Check backlinks unless forced
      if (!options.force) {
        const result = await collection.delete(taskPath, { check_backlinks: true });

        if (result.broken_links && result.broken_links.length > 0) {
          showWarning(`Task has ${result.broken_links.length} backlink(s):`);
          for (const link of result.broken_links) {
            console.log(`  - ${link.path}`);
          }
          showError("Use --force to delete anyway.");
          process.exit(1);
        }

        if (result.error) {
          showError(`Failed to delete task: ${result.error.message}`);
          process.exit(1);
        }

        showSuccess(`Deleted: ${taskPath}`);
      } else {
        const result = await collection.delete(taskPath);

        if (result.error) {
          showError(`Failed to delete task: ${result.error.message}`);
          process.exit(1);
        }

        showSuccess(`Deleted: ${taskPath}`);
      }
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}
