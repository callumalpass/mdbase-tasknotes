import chalk from "chalk";
import { withCollection } from "../collection.js";
import { formatTask, showError } from "../format.js";
import { extractProjectNames } from "../mapper.js";
import type { TaskResult } from "../types.js";

export async function projectsListCommand(
  options: { path?: string; stats?: boolean },
): Promise<void> {
  try {
    await withCollection(async (collection) => {
      const result = await collection.query({
        types: ["task"],
        limit: 500,
      });

      const tasks = (result.results || []) as TaskResult[];

      // Extract unique projects and count tasks
      const projectMap = new Map<
        string,
        { total: number; done: number; open: number }
      >();

      for (const task of tasks) {
        const projects = extractProjectNames(task.frontmatter.projects as string[] | undefined);
        for (const project of projects) {
          const entry = projectMap.get(project) || { total: 0, done: 0, open: 0 };
          entry.total++;
          if (
            task.frontmatter.status === "done" ||
            task.frontmatter.status === "cancelled"
          ) {
            entry.done++;
          } else {
            entry.open++;
          }
          projectMap.set(project, entry);
        }
      }

      if (projectMap.size === 0) {
        console.log(chalk.dim("No projects found."));
        return;
      }

      const sorted = [...projectMap.entries()].sort((a, b) =>
        a[0].localeCompare(b[0]),
      );

      for (const [name, counts] of sorted) {
        if (options.stats) {
          const pct =
            counts.total > 0
              ? Math.round((counts.done / counts.total) * 100)
              : 0;
          console.log(
            `  ${chalk.blue(`+${name}`)}  ${counts.open} open, ${counts.done} done (${pct}%)`,
          );
        } else {
          console.log(`  ${chalk.blue(`+${name}`)}`);
        }
      }
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}

export async function projectsShowCommand(
  name: string,
  options: { path?: string },
): Promise<void> {
  try {
    await withCollection(async (collection) => {
      const result = await collection.query({
        types: ["task"],
        limit: 500,
      });

      const tasks = (result.results || []) as TaskResult[];

      const filtered = tasks.filter((task) => {
        const projects = extractProjectNames(task.frontmatter.projects as string[] | undefined);
        return projects.some(
          (p) => p.toLowerCase() === name.toLowerCase(),
        );
      });

      if (filtered.length === 0) {
        console.log(chalk.dim(`No tasks in project "${name}".`));
        return;
      }

      console.log(chalk.bold(`Project: +${name}\n`));
      for (const task of filtered) {
        console.log(formatTask(task));
      }
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}
