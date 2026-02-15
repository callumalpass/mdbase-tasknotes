import chalk from "chalk";
import { withCollection } from "../collection.js";
import { formatTask, showError } from "../format.js";
import { extractProjectNames } from "../mapper.js";
import { normalizeFrontmatter } from "../field-mapping.js";
import type { TaskResult } from "../types.js";

export async function searchCommand(
  query: string[],
  options: { path?: string; limit?: string },
): Promise<void> {
  const searchTerm = query.join(" ").trim().toLowerCase();
  if (!searchTerm) {
    showError("Please provide a search query.");
    process.exit(1);
  }

  try {
    await withCollection(async (collection, mapping) => {
      const result = await collection.query({
        types: ["task"],
        include_body: true,
        limit: 200,
      });

      const tasks = (result.results || []) as TaskResult[];

      // Client-side full-text search
      const scored = tasks
        .map((task) => {
          const fm = normalizeFrontmatter(task.frontmatter as Record<string, unknown>, mapping);
          let score = 0;

          const title = ((fm.title as string) || "").toLowerCase();
          const body = (task.body || "").toLowerCase();
          const tags = ((fm.tags as string[]) || []).join(" ").toLowerCase();
          const contexts = ((fm.contexts as string[]) || []).join(" ").toLowerCase();
          const projects = extractProjectNames(fm.projects as string[] | undefined)
            .join(" ")
            .toLowerCase();

          // Title match (highest weight)
          if (title.includes(searchTerm)) score += 10;
          // Tag match
          if (tags.includes(searchTerm)) score += 5;
          // Context match
          if (contexts.includes(searchTerm)) score += 5;
          // Project match
          if (projects.includes(searchTerm)) score += 5;
          // Body match
          if (body.includes(searchTerm)) score += 2;

          return { task: { ...task, frontmatter: fm as any }, score };
        })
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score);

      const limit = options.limit ? parseInt(options.limit, 10) : 20;
      const results = scored.slice(0, limit);

      if (results.length === 0) {
        console.log(chalk.dim(`No tasks matching "${searchTerm}".`));
        return;
      }

      console.log(chalk.dim(`${results.length} result(s) for "${searchTerm}":\n`));
      for (const { task } of results) {
        console.log(formatTask(task));
      }
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}
