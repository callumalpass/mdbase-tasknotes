import { withCollection, resolveTaskPath } from "../collection.js";
import { formatTaskDetail, showError } from "../format.js";
import { normalizeFrontmatter } from "../field-mapping.js";
import type { TaskResult } from "../types.js";

export async function showCommand(
  pathOrTitle: string,
  options: { path?: string },
): Promise<void> {
  try {
    await withCollection(async (collection, mapping) => {
      const taskPath = await resolveTaskPath(collection, pathOrTitle, mapping);
      const result = await collection.read(taskPath);

      if (result.error) {
        showError(`Failed to read task: ${result.error.message}`);
        process.exit(1);
      }

      const fm = normalizeFrontmatter(result.frontmatter as Record<string, unknown>, mapping);

      const task: TaskResult = {
        path: taskPath,
        frontmatter: fm as any,
        body: result.body,
      };

      console.log(formatTaskDetail(task));
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}
