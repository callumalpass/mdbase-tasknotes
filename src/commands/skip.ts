import { buildSpecRecurringSkipUpdate } from "@tasknotes/model/operations";
import { withCollection, resolveTaskPath } from "../collection.js";
import { showError, showSuccess } from "../format.js";
import { normalizeFrontmatter, denormalizeFrontmatter, resolveDisplayTitle } from "../field-mapping.js";
import { resolveOperationTargetDate } from "../date.js";

export async function skipCommand(
  pathOrTitle: string,
  options: { path?: string; date?: string },
): Promise<void> {
  await setSkipState(pathOrTitle, { ...options, skip: true });
}

export async function unskipCommand(
  pathOrTitle: string,
  options: { path?: string; date?: string },
): Promise<void> {
  await setSkipState(pathOrTitle, { ...options, skip: false });
}

async function setSkipState(
  pathOrTitle: string,
  options: { path?: string; date?: string; skip: boolean },
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
      if (typeof fm.recurrence !== "string" || fm.recurrence.trim().length === 0) {
        showError("Skip/unskip is only supported for recurring tasks.");
        process.exit(1);
      }

      const targetDate = resolveOperationTargetDate(
        options.date,
        typeof fm.scheduled === "string" ? fm.scheduled : undefined,
        typeof fm.due === "string" ? fm.due : undefined,
      );
      const plan = buildSpecRecurringSkipUpdate({
        frontmatter: fm,
        targetDate,
        skip: options.skip,
        path: taskPath,
      });
      if (!plan.changed) {
        showSuccess(
          `Recurring instance already ${options.skip ? "skipped" : "unskipped"} on ${targetDate}: ${taskTitle}`,
        );
        return;
      }

      const result = await collection.update({
        path: taskPath,
        fields: denormalizeFrontmatter(plan.fields, mapping),
      });

      if (result.error) {
        showError(`Failed to ${options.skip ? "skip" : "unskip"} recurring instance: ${result.error.message}`);
        process.exit(1);
      }

      const verb = options.skip ? "Skipped" : "Unskipped";
      const nextScheduled = typeof plan.metadata?.nextScheduled === "string"
        ? plan.metadata.nextScheduled
        : undefined;
      const nextInfo = nextScheduled ? ` → next ${nextScheduled}` : "";
      showSuccess(`${verb} recurring instance (${targetDate}): ${taskTitle}${nextInfo}`);
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}
