import chalk from "chalk";
import { parseISO, differenceInMinutes } from "date-fns";
import { withCollection } from "../collection.js";
import { formatDuration, showError } from "../format.js";
import { normalizeFrontmatter, isCompletedStatus } from "../field-mapping.js";
import { getCurrentDateString, isBeforeDateSafe } from "../date.js";
import type { TaskResult, TaskFrontmatter } from "../types.js";

export async function statsCommand(
  options: { path?: string },
): Promise<void> {
  try {
    await withCollection(async (collection, mapping) => {
      const result = await collection.query({
        types: ["task"],
        limit: 1000,
      });

      const rawTasks = (result.results || []) as TaskResult[];
      const tasks = rawTasks.map((t) => ({
        ...t,
        frontmatter: normalizeFrontmatter(t.frontmatter as Record<string, unknown>, mapping) as any as TaskFrontmatter,
      }));
      const total = tasks.length;

      if (total === 0) {
        console.log(chalk.dim("No tasks found."));
        return;
      }

      // By status
      const byStatus = new Map<string, number>();
      for (const task of tasks) {
        const s = task.frontmatter.status || "unknown";
        byStatus.set(s, (byStatus.get(s) || 0) + 1);
      }

      // By priority
      const byPriority = new Map<string, number>();
      for (const task of tasks) {
        const p = task.frontmatter.priority || "unset";
        byPriority.set(p, (byPriority.get(p) || 0) + 1);
      }

      // Overdue
      const today = getCurrentDateString();
      const overdue = tasks.filter(
        (t) =>
          t.frontmatter.due &&
          isBeforeDateSafe(t.frontmatter.due, today) &&
          !isCompletedStatus(mapping, t.frontmatter.status),
      ).length;

      // Completion rate
      const completedCount = tasks.filter((t) => isCompletedStatus(mapping, t.frontmatter.status)).length;
      const completionRate = Math.round((completedCount / total) * 100);

      // Time tracked
      let totalMinutes = 0;
      for (const task of tasks) {
        const entries = task.frontmatter.timeEntries || [];
        for (const entry of entries) {
          if (entry.endTime) totalMinutes += differenceInMinutes(parseISO(entry.endTime), parseISO(entry.startTime));
        }
      }

      // Display
      console.log(chalk.bold("Task Statistics\n"));
      console.log(`  Total tasks:     ${total}`);
      console.log(`  Completion rate: ${completionRate}%`);
      console.log(`  Overdue:         ${overdue > 0 ? chalk.red(String(overdue)) : "0"}`);

      console.log(chalk.dim("\n  By status:"));
      for (const [status, count] of [...byStatus.entries()].sort()) {
        const bar = "█".repeat(Math.ceil((count / total) * 30));
        console.log(`    ${status.padEnd(14)} ${String(count).padStart(4)}  ${chalk.dim(bar)}`);
      }

      console.log(chalk.dim("\n  By priority:"));
      for (const [priority, count] of [...byPriority.entries()].sort()) {
        const bar = "█".repeat(Math.ceil((count / total) * 30));
        console.log(`    ${priority.padEnd(14)} ${String(count).padStart(4)}  ${chalk.dim(bar)}`);
      }

      if (totalMinutes > 0) {
        console.log(`\n  Time tracked:    ${formatDuration(totalMinutes)}`);
      }
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}
