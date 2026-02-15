import chalk from "chalk";
import { withCollection } from "../collection.js";
import { createParser } from "../nlp.js";
import { mapToFrontmatter } from "../mapper.js";
import { formatTask, showError, showSuccess } from "../format.js";
import { denormalizeFrontmatter, normalizeFrontmatter } from "../field-mapping.js";
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
      const result = await collection.create({
        type: "task",
        frontmatter: denormalizeFrontmatter(frontmatter as Record<string, unknown>, mapping),
        body,
      });

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
