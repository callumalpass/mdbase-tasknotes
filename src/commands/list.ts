import chalk from "chalk";
import { format } from "date-fns";
import { withCollection } from "../collection.js";
import { formatTask, showError } from "../format.js";
import { normalizeFrontmatter, resolveField } from "../field-mapping.js";
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
    await withCollection(async (collection, mapping) => {
      // Build where expression from flags
      const conditions: string[] = [];

      if (options.where) {
        // Raw user-supplied expression — NOT translated
        conditions.push(options.where);
      } else {
        const statusField = resolveField(mapping, "status");
        const priorityField = resolveField(mapping, "priority");
        const tagsField = resolveField(mapping, "tags");
        const dueField = resolveField(mapping, "due");

        if (options.status) {
          conditions.push(`${statusField} == "${options.status}"`);
        } else if (!options.overdue) {
          // Default: non-completed tasks
          conditions.push(`${statusField} != "done" && ${statusField} != "cancelled"`);
        }

        if (options.priority) {
          conditions.push(`${priorityField} == "${options.priority}"`);
        }

        if (options.tag) {
          conditions.push(`${tagsField}.contains("${options.tag}")`);
        }

        if (options.due) {
          conditions.push(`${dueField} == "${options.due}"`);
        }

        if (options.overdue) {
          const today = format(new Date(), "yyyy-MM-dd");
          conditions.push(`${dueField} < "${today}" && ${statusField} != "done" && ${statusField} != "cancelled"`);
        }
      }

      const where = conditions.length > 0 ? conditions.join(" && ") : undefined;
      const limit = options.limit ? parseInt(options.limit, 10) : 50;

      const result = await collection.query({
        types: ["task"],
        where,
        order_by: [{ field: resolveField(mapping, "due"), direction: "asc" }],
        limit,
      });

      const tasks = (result.results || []) as TaskResult[];

      if (options.json) {
        const clean = tasks.map((t: any) => {
          const fm = normalizeFrontmatter(t.frontmatter as Record<string, unknown>, mapping);
          return {
            path: t.path,
            ...fm,
          };
        });
        console.log(JSON.stringify(clean, null, 2));
        return;
      }

      if (tasks.length === 0) {
        console.log(chalk.dim("No tasks found."));
        return;
      }

      for (const task of tasks) {
        const fm = normalizeFrontmatter(task.frontmatter as Record<string, unknown>, mapping);
        console.log(formatTask({ ...task, frontmatter: fm as any }));
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
