import chalk from "chalk";
import { format as fmtDate, isPast, parseISO, differenceInMinutes } from "date-fns";
import type { TaskFrontmatter, TaskResult } from "./types.js";
import { extractProjectNames } from "./mapper.js";
import { getCurrentDateString, isSameDateSafe, parseDateToLocal } from "./date.js";

const STATUS_ICONS: Record<string, string> = {
  open: "☐",
  "in-progress": "◐",
  done: "☑",
  cancelled: "☒",
};

const PRIORITY_COLORS: Record<string, (s: string) => string> = {
  urgent: chalk.red,
  high: chalk.red,
  normal: chalk.yellow,
  low: chalk.green,
};

export function getStatusIcon(status: string): string {
  return STATUS_ICONS[status] || "•";
}

function priorityColor(priority: string): (s: string) => string {
  return PRIORITY_COLORS[priority] || chalk.white;
}

function statusColor(status: string): (s: string) => string {
  switch (status) {
    case "open":
      return chalk.blue;
    case "in-progress":
      return chalk.yellow;
    case "done":
      return chalk.green;
    case "cancelled":
      return chalk.gray;
    default:
      return chalk.white;
  }
}

export function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "";
  try {
    if (isSameDateSafe(dateStr, getCurrentDateString())) return chalk.cyan("today");
    const date = parseDateToLocal(dateStr);
    if (isPast(date)) return chalk.red(fmtDate(date, "yyyy-MM-dd"));
    return fmtDate(date, "yyyy-MM-dd");
  } catch {
    return dateStr;
  }
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatTask(task: TaskResult): string {
  return formatTaskForDate(task, todayString());
}

export function formatTaskForDate(task: TaskResult, date: string): string {
  const fm = task.frontmatter;
  const parts: string[] = [];
  const effectiveStatus = getEffectiveStatus(fm, date);

  // Status icon
  parts.push(getStatusIcon(effectiveStatus));

  // Priority badge
  if (fm.priority && fm.priority !== "normal") {
    const color = priorityColor(fm.priority);
    parts.push(color(`[${fm.priority}]`));
  }

  // Title
  parts.push(fm.title);

  // Due date
  if (fm.due) {
    parts.push(chalk.dim("due:") + formatDate(fm.due));
  }

  // Scheduled date
  if (fm.scheduled) {
    parts.push(chalk.dim("scheduled:") + formatDate(fm.scheduled));
  }

  // Tags
  if (fm.tags && fm.tags.length > 0) {
    parts.push(chalk.cyan(fm.tags.map((t) => `#${t}`).join(" ")));
  }

  // Contexts
  if (fm.contexts && fm.contexts.length > 0) {
    parts.push(chalk.magenta(fm.contexts.map((c) => `@${c}`).join(" ")));
  }

  // Projects
  const projects = extractProjectNames(fm.projects as string[] | undefined);
  if (projects.length > 0) {
    parts.push(chalk.blue(projects.map((p) => `+${p}`).join(" ")));
  }

  // Time estimate
  if (fm.timeEstimate) {
    parts.push(chalk.dim(`~${formatDuration(fm.timeEstimate)}`));
  }

  return parts.join(" ");
}

export function formatTaskDetail(task: TaskResult): string {
  return formatTaskDetailForDate(task, todayString());
}

export function formatTaskDetailForDate(task: TaskResult, date?: string): string {
  const asOfDate = date ?? todayString();
  return formatTaskDetailInternal(task, asOfDate);
}

function formatTaskDetailInternal(task: TaskResult, asOfDate: string): string {
  const fm = task.frontmatter;
  const lines: string[] = [];
  const effectiveStatus = getEffectiveStatus(fm, asOfDate);

  // Header
  lines.push(
    `${getStatusIcon(effectiveStatus)} ${chalk.bold(fm.title)}`,
  );
  lines.push(chalk.dim("─".repeat(60)));

  // Status & Priority
  lines.push(
    `  Status:   ${statusColor(effectiveStatus)(effectiveStatus)}`,
  );
  if (fm.priority) {
    lines.push(
      `  Priority: ${priorityColor(fm.priority)(fm.priority)}`,
    );
  }

  // Dates
  if (fm.due) lines.push(`  Due:      ${formatDate(fm.due)}`);
  if (fm.scheduled) lines.push(`  Scheduled: ${formatDate(fm.scheduled)}`);
  if (fm.completedDate) lines.push(`  Completed: ${formatDate(fm.completedDate)}`);
  if (fm.dateCreated) lines.push(`  Created:  ${chalk.dim(fm.dateCreated)}`);

  // Tags, Contexts, Projects
  if (fm.tags && fm.tags.length > 0) {
    lines.push(`  Tags:     ${chalk.cyan(fm.tags.map((t) => `#${t}`).join(" "))}`);
  }
  if (fm.contexts && fm.contexts.length > 0) {
    lines.push(`  Contexts: ${chalk.magenta(fm.contexts.map((c) => `@${c}`).join(" "))}`);
  }
  const projects = extractProjectNames(fm.projects as string[] | undefined);
  if (projects.length > 0) {
    lines.push(`  Projects: ${chalk.blue(projects.map((p) => `+${p}`).join(" "))}`);
  }

  // Time
  if (fm.timeEstimate) {
    lines.push(`  Estimate: ${formatDuration(fm.timeEstimate)}`);
  }
  if (fm.recurrence) {
    lines.push(`  Recurs:   ${fm.recurrence}`);
  }
  if (fm.recurrence && Array.isArray(fm.completeInstances)) {
    const completed = fm.completeInstances.includes(asOfDate);
    const skipped = Array.isArray(fm.skippedInstances) && fm.skippedInstances.includes(asOfDate);
    const label = skipped ? chalk.gray("skipped") : completed ? chalk.green("completed") : chalk.yellow("open");
    lines.push(`  Instance (${asOfDate}): ${label}`);
  }

  // Time entries
  if (fm.timeEntries && fm.timeEntries.length > 0) {
    lines.push("");
    lines.push(chalk.dim("  Time entries:"));
    for (const entry of fm.timeEntries) {
      const start = entry.startTime ? fmtDate(parseISO(entry.startTime), "yyyy-MM-dd HH:mm") : "?";
      const end = entry.endTime ? fmtDate(parseISO(entry.endTime), "HH:mm") : "running";
      const dur = entry.endTime
        ? ` (${formatDuration(differenceInMinutes(parseISO(entry.endTime), parseISO(entry.startTime)))})`
        : "";
      lines.push(`    ${start} → ${end}${dur}`);
    }
  }

  // Path
  lines.push("");
  lines.push(chalk.dim(`  Path: ${task.path}`));

  // Body
  if (task.body) {
    lines.push("");
    lines.push(chalk.dim("─".repeat(60)));
    lines.push(task.body);
  }

  return lines.join("\n");
}

export function showError(msg: string): void {
  console.error(chalk.red("✗") + " " + msg);
}

export function showSuccess(msg: string): void {
  console.log(chalk.green("✓") + " " + msg);
}

export function showWarning(msg: string): void {
  console.log(chalk.yellow("⚠") + " " + msg);
}

export function showInfo(msg: string): void {
  console.log(chalk.blue("ℹ") + " " + msg);
}

function getEffectiveStatus(fm: TaskFrontmatter, date = todayString()): string {
  if (!fm.recurrence) return fm.status;
  const completeInstances = Array.isArray(fm.completeInstances) ? fm.completeInstances : [];
  if (completeInstances.includes(date)) return "done";
  const skippedInstances = Array.isArray(fm.skippedInstances) ? fm.skippedInstances : [];
  if (skippedInstances.includes(date)) return "cancelled";
  return "open";
}

function todayString(): string {
  return getCurrentDateString();
}
