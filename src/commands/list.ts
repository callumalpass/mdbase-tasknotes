import chalk from "chalk";
import { withCollection } from "../collection.js";
import { formatTask, formatTaskForDate, showError } from "../format.js";
import {
  normalizeFrontmatter,
  resolveDisplayTitle,
  resolveField,
  isCompletedStatus,
} from "../field-mapping.js";
import type { TaskResult } from "../types.js";
import { isBeforeDateSafe, resolveDateOrToday, validateDateString } from "../date.js";

export async function listCommand(options: {
  path?: string;
  status?: string;
  priority?: string;
  tag?: string;
  due?: string;
  overdue?: boolean;
  where?: string;
  on?: string;
  limit?: string;
  json?: boolean;
}): Promise<void> {
  try {
    const asOfDate = options.on ? validateDateString(options.on) : resolveDateOrToday();
    const requestedTag = typeof options.tag === "string" ? options.tag.trim().toLowerCase() : "";
    const wantsArchivedTag = requestedTag === "archive" || requestedTag === "archived";
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

        const completedStatuses = mapping.completedStatuses;

        if (options.status && !options.on) {
          if (!isCompletedStatus(mapping, options.status)) {
            conditions.push(`${statusField} == "${options.status}"`);
          }
        } else if (!options.overdue) {
          // Default: non-completed tasks. Recurring tasks are handled in post-filtering.
          for (const status of completedStatuses) {
            const escaped = status.replace(/"/g, '\\"');
            conditions.push(`${statusField} != "${escaped}"`);
          }
        }

        if (options.priority) {
          conditions.push(`${priorityField} == "${options.priority}"`);
        }

        if (options.tag) {
          conditions.push(`${tagsField}.contains("${options.tag}")`);
        }

        if (!options.status && !options.overdue && !wantsArchivedTag) {
          conditions.push(`!${tagsField}.contains("archive")`);
          conditions.push(`!${tagsField}.contains("archived")`);
        }

        if (options.due) {
          conditions.push(`${dueField} == "${options.due}"`);
        }

        if (options.overdue) {
          conditions.push(`${dueField} != null`);
          for (const status of completedStatuses) {
            const escaped = status.replace(/"/g, '\\"');
            conditions.push(`${statusField} != "${escaped}"`);
          }
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

      const rawTasks = (result.results || []) as TaskResult[];
      const today = asOfDate;
      const tasks = rawTasks.filter((task) => {
        const fm = normalizeFrontmatter(task.frontmatter as Record<string, unknown>, mapping);
        if (options.overdue) {
          if (isCompletedStatus(mapping, typeof fm.status === "string" ? fm.status : undefined)) return false;
          if (typeof fm.due !== "string" || fm.due.trim().length === 0) return false;
          if (!isBeforeDateSafe(fm.due, today)) return false;
        }

        const isRecurring = typeof fm.recurrence === "string" && fm.recurrence.trim().length > 0;
        if (!isRecurring) {
          if (!options.status) return true;
          return String(fm.status || "") === options.status;
        }

        const completeInstances = Array.isArray(fm.completeInstances)
          ? (fm.completeInstances as string[])
          : [];
        const skippedInstances = Array.isArray(fm.skippedInstances)
          ? (fm.skippedInstances as string[])
          : [];
        const effectiveStatus = completeInstances.includes(today)
          ? "done"
          : skippedInstances.includes(today)
            ? "cancelled"
            : "open";

        if (options.status) {
          if (isCompletedStatus(mapping, options.status)) {
            return effectiveStatus === "done" || effectiveStatus === "cancelled";
          }
          if (effectiveStatus !== "open") return false;
          return String(fm.status || "") === options.status;
        }

        return effectiveStatus !== "done" && effectiveStatus !== "cancelled";
      });

      if (options.json) {
        const clean = tasks.map((t: any) => {
          const fm = normalizeFrontmatter(t.frontmatter as Record<string, unknown>, mapping);
          const displayTitle = resolveDisplayTitle(fm, mapping, t.path);
          if (displayTitle) {
            fm.title = displayTitle;
          }
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
        const displayTitle = resolveDisplayTitle(fm, mapping, task.path);
        if (displayTitle) {
          fm.title = displayTitle;
        }
        if (options.on) {
          console.log(formatTaskForDate({ ...task, frontmatter: fm as any }, asOfDate));
        } else {
          console.log(formatTask({ ...task, frontmatter: fm as any }));
        }
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
