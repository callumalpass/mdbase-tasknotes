import chalk from "chalk";
import { format, parseISO, differenceInMinutes } from "date-fns";
import { withCollection, resolveTaskPath } from "../collection.js";
import { formatDuration, showError, showSuccess, showInfo } from "../format.js";
import type { TimeEntry, TaskResult } from "../types.js";

export async function timerStartCommand(
  pathOrTitle: string,
  options: { path?: string; description?: string },
): Promise<void> {
  try {
    await withCollection(async (collection) => {
      const taskPath = await resolveTaskPath(collection, pathOrTitle);
      const read = await collection.read(taskPath);

      if (read.error) {
        showError(`Failed to read task: ${read.error.message}`);
        process.exit(1);
      }

      const fm = read.frontmatter as Record<string, unknown>;
      const entries: TimeEntry[] = Array.isArray(fm.timeEntries)
        ? [...(fm.timeEntries as TimeEntry[])]
        : [];

      // Check for already-running timer
      const running = entries.find((e) => e.startTime && !e.endTime);
      if (running) {
        showError(`Timer already running since ${running.startTime}. Stop it first.`);
        process.exit(1);
      }

      const newEntry: TimeEntry = {
        startTime: new Date().toISOString(),
      };
      if (options.description) {
        newEntry.description = options.description;
      }
      entries.push(newEntry);

      const result = await collection.update({
        path: taskPath,
        fields: { timeEntries: entries },
      });

      if (result.error) {
        showError(`Failed to start timer: ${result.error.message}`);
        process.exit(1);
      }

      showSuccess(`Timer started for: ${fm.title}`);
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}

export async function timerStopCommand(
  options: { path?: string },
): Promise<void> {
  try {
    await withCollection(async (collection) => {
      // Find the task with a running timer
      const result = await collection.query({
        types: ["task"],
        limit: 200,
      });

      const tasks = (result.results || []) as TaskResult[];
      let found: { task: TaskResult; entryIndex: number } | null = null;

      for (const task of tasks) {
        const entries = task.frontmatter.timeEntries || [];
        const idx = entries.findIndex((e) => e.startTime && !e.endTime);
        if (idx !== -1) {
          found = { task, entryIndex: idx };
          break;
        }
      }

      if (!found) {
        showError("No running timer found.");
        process.exit(1);
      }

      const { task, entryIndex } = found;
      const entries = [...(task.frontmatter.timeEntries || [])];
      const entry = entries[entryIndex];

      const endTime = new Date();
      const startTime = parseISO(entry.startTime);
      const duration = differenceInMinutes(endTime, startTime);

      entries[entryIndex] = {
        ...entry,
        endTime: endTime.toISOString(),
        duration,
      };

      const updateResult = await collection.update({
        path: task.path,
        fields: { timeEntries: entries },
      });

      if (updateResult.error) {
        showError(`Failed to stop timer: ${updateResult.error.message}`);
        process.exit(1);
      }

      showSuccess(`Timer stopped for: ${task.frontmatter.title} (${formatDuration(duration)})`);
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}

export async function timerStatusCommand(
  options: { path?: string },
): Promise<void> {
  try {
    await withCollection(async (collection) => {
      const result = await collection.query({
        types: ["task"],
        limit: 200,
      });

      const tasks = (result.results || []) as TaskResult[];
      let found = false;

      for (const task of tasks) {
        const entries = task.frontmatter.timeEntries || [];
        const running = entries.find((e) => e.startTime && !e.endTime);
        if (running) {
          const elapsed = differenceInMinutes(new Date(), parseISO(running.startTime));
          console.log(
            `${chalk.green("●")} ${task.frontmatter.title} — ${formatDuration(elapsed)} elapsed` +
              (running.description ? chalk.dim(` (${running.description})`) : ""),
          );
          found = true;
        }
      }

      if (!found) {
        console.log(chalk.dim("No active timers."));
      }
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}

export async function timerLogCommand(
  options: { path?: string; from?: string; to?: string; period?: string },
): Promise<void> {
  try {
    await withCollection(async (collection) => {
      const result = await collection.query({
        types: ["task"],
        limit: 500,
      });

      const tasks = (result.results || []) as TaskResult[];

      // Collect all time entries across tasks
      const allEntries: Array<{
        taskTitle: string;
        taskPath: string;
        entry: TimeEntry;
      }> = [];

      for (const task of tasks) {
        const entries = task.frontmatter.timeEntries || [];
        for (const entry of entries) {
          if (!entry.endTime) continue; // Skip running timers
          allEntries.push({
            taskTitle: task.frontmatter.title,
            taskPath: task.path,
            entry,
          });
        }
      }

      // Filter by date range
      let filtered = allEntries;
      if (options.from) {
        filtered = filtered.filter((e) => e.entry.startTime >= options.from!);
      }
      if (options.to) {
        filtered = filtered.filter((e) => e.entry.startTime <= options.to! + "T23:59:59");
      }
      if (options.period === "today") {
        const today = format(new Date(), "yyyy-MM-dd");
        filtered = filtered.filter((e) => e.entry.startTime.startsWith(today));
      } else if (options.period === "week") {
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const weekStr = weekAgo.toISOString();
        filtered = filtered.filter((e) => e.entry.startTime >= weekStr);
      }

      // Sort by start time
      filtered.sort((a, b) => a.entry.startTime.localeCompare(b.entry.startTime));

      if (filtered.length === 0) {
        console.log(chalk.dim("No time entries found."));
        return;
      }

      let totalMinutes = 0;
      for (const { taskTitle, entry } of filtered) {
        const start = format(parseISO(entry.startTime), "yyyy-MM-dd HH:mm");
        const end = entry.endTime
          ? format(parseISO(entry.endTime), "HH:mm")
          : "running";
        const dur = entry.duration || 0;
        totalMinutes += dur;

        console.log(
          `  ${start} → ${end}  ${chalk.dim(formatDuration(dur).padStart(6))}  ${taskTitle}` +
            (entry.description ? chalk.dim(` — ${entry.description}`) : ""),
        );
      }

      console.log(chalk.dim("─".repeat(60)));
      console.log(`  Total: ${chalk.bold(formatDuration(totalMinutes))}`);
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}
