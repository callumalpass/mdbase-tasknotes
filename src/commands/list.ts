import chalk from "chalk";
import { format } from "date-fns";
import { withCollection } from "../collection.js";
import { formatTask, showError } from "../format.js";
import type { TaskResult } from "../types.js";

export async function listCommand(options: {
  path?: string;
  status?: string;
  priority?: string;
  tag?: string;
  due?: string;
  overdue?: boolean;
  where?: string;
  limit?: string;
  json?: boolean;
}): Promise<void> {
  try {
    await withCollection(async (collection) => {
      // Build where expression from flags
      const conditions: string[] = [];

      if (options.where) {
        conditions.push(options.where);
      } else {
        if (options.status) {
          conditions.push(`status == "${options.status}"`);
        } else if (!options.overdue) {
          // Default: non-completed tasks
          conditions.push(`status != "done" && status != "cancelled"`);
        }

        if (options.priority) {
          conditions.push(`priority == "${options.priority}"`);
        }

        if (options.tag) {
          conditions.push(`tags.contains("${options.tag}")`);
        }

        if (options.due) {
          conditions.push(`due == "${options.due}"`);
        }

        if (options.overdue) {
          const today = format(new Date(), "yyyy-MM-dd");
          conditions.push(`due < "${today}" && status != "done" && status != "cancelled"`);
        }
      }

      const where = conditions.length > 0 ? conditions.join(" && ") : undefined;
      const limit = options.limit ? parseInt(options.limit, 10) : 50;

      const result = await collection.query({
        types: ["task"],
        where,
        order_by: [{ field: "due", direction: "asc" }],
        limit,
      });

      const tasks = (result.results || []) as TaskResult[];

      if (options.json) {
        const clean = tasks.map((t: any) => ({
          path: t.path,
          ...t.frontmatter,
        }));
        console.log(JSON.stringify(clean, null, 2));
        return;
      }

      if (tasks.length === 0) {
        console.log(chalk.dim("No tasks found."));
        return;
      }

      for (const task of tasks) {
        console.log(formatTask(task));
      }

      if (result.meta?.has_more) {
        console.log(chalk.dim(`\n  ... and more (use --limit to show more)`));
      }
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}
