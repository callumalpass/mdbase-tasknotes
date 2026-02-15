import chalk from "chalk";
import { withCollection } from "../collection.js";
import { createParser } from "../nlp.js";
import { mapToFrontmatter } from "../mapper.js";
import { formatTask, showError, showSuccess } from "../format.js";
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

    await withCollection(async (collection) => {
      const result = await collection.create({
        type: "task",
        frontmatter: frontmatter as Record<string, unknown>,
        body,
      });

      if (result.error) {
        showError(`Failed to create task: ${result.error.message}`);
        process.exit(1);
      }

      const task: TaskResult = {
        path: result.path!,
        frontmatter: result.frontmatter as any,
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
