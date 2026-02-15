import type { ParsedTaskData } from "tasknotes-nlp-core";
import type { TaskFrontmatter } from "./types.js";

/**
 * Map NLP ParsedTaskData to mdbase task frontmatter fields.
 * Projects are wrapped as wikilinks: "projectName" → "[[projects/projectName]]"
 */
export function mapToFrontmatter(parsed: ParsedTaskData): {
  frontmatter: Partial<TaskFrontmatter>;
  body?: string;
} {
  const fm: Partial<TaskFrontmatter> = {};

  fm.title = parsed.title;

  if (parsed.dueDate) fm.due = parsed.dueDate;
  if (parsed.scheduledDate) fm.scheduled = parsed.scheduledDate;
  if (parsed.priority) fm.priority = parsed.priority;
  if (parsed.status) fm.status = parsed.status;
  if (parsed.tags && parsed.tags.length > 0) fm.tags = parsed.tags;
  if (parsed.contexts && parsed.contexts.length > 0) fm.contexts = parsed.contexts;
  if (parsed.projects && parsed.projects.length > 0) {
    fm.projects = parsed.projects.map((p) => `[[projects/${p}]]`);
  }
  if (parsed.recurrence) fm.recurrence = parsed.recurrence;
  if (parsed.estimate) fm.timeEstimate = parsed.estimate;

  const body = parsed.details || undefined;

  return { frontmatter: fm, body };
}

/**
 * Map frontmatter back to a display-friendly object for showing tasks.
 * Extracts project names from wikilinks.
 */
export function extractProjectNames(projects?: string[]): string[] {
  if (!projects) return [];
  return projects.map((p) => {
    const match = p.match(/\[\[(?:.*\/)?([^\]]+)\]\]/);
    return match ? match[1] : p;
  });
}
