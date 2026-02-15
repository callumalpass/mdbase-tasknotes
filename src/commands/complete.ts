import { format } from "date-fns";
import { withCollection, resolveTaskPath } from "../collection.js";
import { showError, showSuccess } from "../format.js";
import { normalizeFrontmatter, denormalizeFrontmatter } from "../field-mapping.js";

export async function completeCommand(
  pathOrTitle: string,
  options: { path?: string },
): Promise<void> {
  try {
    await withCollection(async (collection, mapping) => {
      const taskPath = await resolveTaskPath(collection, pathOrTitle, mapping);
      const read = await collection.read(taskPath);

      if (read.error) {
        showError(`Failed to read task: ${read.error.message}`);
        process.exit(1);
      }

      const fm = normalizeFrontmatter(read.frontmatter as Record<string, unknown>, mapping);
      if (fm.status === "done") {
        showSuccess(`Task "${fm.title}" is already completed.`);
        return;
      }

      const today = format(new Date(), "yyyy-MM-dd");
      const result = await collection.update({
        path: taskPath,
        fields: denormalizeFrontmatter({
          status: "done",
          completedDate: today,
        }, mapping),
      });

      if (result.error) {
        showError(`Failed to complete task: ${result.error.message}`);
        process.exit(1);
      }

      showSuccess(`Completed: ${fm.title}`);
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}
