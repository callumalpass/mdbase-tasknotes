import chalk from "chalk";
import { withCollection } from "../collection.js";
import { createParser } from "../nlp.js";
import { mapToFrontmatter } from "../mapper.js";
import { formatTask, showError, showSuccess, showWarning } from "../format.js";
import { normalizeFrontmatter } from "../field-mapping.js";
import { createTaskWithCompat } from "../create-compat.js";
import type { TaskResult } from "../types.js";

export async function createCommand(
  text: string[],
  options: { path?: string },
): Promise<void> {
  const input = text.join(" ").trim();
  if (!input) {
    showError("Please provide task text.");
    process.exit(1);
  }

  try {
    const parser = await createParser(options.path);
    const parsed = parser.parseInput(input);
    const { frontmatter, body } = mapToFrontmatter(parsed);

    await withCollection(async (collection, mapping) => {
      const result = await createTaskWithCompat(
        collection,
        mapping,
        frontmatter as Record<string, unknown>,
        body,
      );

      if (result.warnings && result.warnings.length > 0) {
        for (const warning of result.warnings) {
          showWarning(warning);
        }
      }

      if (result.error) {
        showError(`Failed to create task: ${result.error.message}`);
        process.exit(1);
      }

      const fm = normalizeFrontmatter(result.frontmatter as Record<string, unknown>, mapping);

      const task: TaskResult = {
        path: result.path!,
        frontmatter: fm as any,
      };

      showSuccess("Task created");
      console.log(formatTask(task));
      console.log(chalk.dim(`  → ${result.path}`));
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}
