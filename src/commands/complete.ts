import { buildSpecCompleteTaskUpdate } from "@tasknotes/model/operations";
import { withCollection, resolveTaskPath } from "../collection.js";
import { showError, showSuccess } from "../format.js";
import {
  normalizeFrontmatter,
  denormalizeFrontmatter,
  getDefaultCompletedStatus,
  isCompletedStatus,
  resolveDisplayTitle,
} from "../field-mapping.js";
import { resolveDateOrToday, resolveOperationTargetDate } from "../date.js";

export async function completeCommand(
  pathOrTitle: string,
  options: { path?: string; date?: string },
): Promise<void> {
  try {
    await withCollection(async (collection, mapping) => {
      const taskPath = await resolveTaskPath(collection, pathOrTitle, mapping);
      const read = await collection.read(taskPath);

      if (read.error) {
        showError(`Failed to read task: ${read.error.message}`);
        process.exit(1);
      }

      const fm = normalizeFrontmatter(read.frontmatter as Record<string, unknown>, mapping);
      const taskTitle = resolveDisplayTitle(fm, mapping, taskPath) || taskPath;
      const isRecurring = typeof fm.recurrence === "string" && fm.recurrence.trim().length > 0;
      const completionStatus = getDefaultCompletedStatus(mapping);

      if (!isRecurring && isCompletedStatus(mapping, typeof fm.status === "string" ? fm.status : undefined)) {
        showSuccess(`Task "${taskTitle}" is already completed.`);
        return;
      }

      if (isRecurring) {
        const targetDate = resolveOperationTargetDate(
          options.date,
          typeof fm.scheduled === "string" ? fm.scheduled : undefined,
          typeof fm.due === "string" ? fm.due : undefined,
        );
        const plan = buildSpecCompleteTaskUpdate({
          frontmatter: fm,
          targetDate,
          completedStatus: completionStatus,
          path: taskPath,
        });
        if (!plan.changed) {
          showSuccess(`Recurring instance already completed on ${targetDate}: ${taskTitle}`);
          return;
        }

        const nextScheduled = typeof plan.metadata?.nextScheduled === "string"
          ? plan.metadata.nextScheduled
          : undefined;
        if (!nextScheduled) {
          const result = await collection.update({
            path: taskPath,
            fields: denormalizeFrontmatter(plan.fields, mapping),
          });

          if (result.error) {
            showError(`Failed to complete task: ${result.error.message}`);
            process.exit(1);
          }

          showSuccess(`Completed: ${taskTitle}`);
          return;
        }

        const result = await collection.update({
          path: taskPath,
          fields: denormalizeFrontmatter(plan.fields, mapping),
        });

        if (result.error) {
          showError(`Failed to complete recurring task: ${result.error.message}`);
          process.exit(1);
        }

        showSuccess(`Completed recurring instance: ${taskTitle} → next ${nextScheduled}`);
        return;
      }

      const today = resolveDateOrToday(options.date);
      const plan = buildSpecCompleteTaskUpdate({
        frontmatter: fm,
        targetDate: today,
        completedStatus: completionStatus,
        path: taskPath,
      });

      const result = await collection.update({
        path: taskPath,
        fields: denormalizeFrontmatter(plan.fields, mapping),
      });

      if (result.error) {
        showError(`Failed to complete task: ${result.error.message}`);
        process.exit(1);
      }

      showSuccess(`Completed: ${taskTitle}`);
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}
