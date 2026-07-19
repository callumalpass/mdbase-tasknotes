import { Collection } from "@callumalpass/mdbase";
import { basename } from "node:path";
import { resolveCollectionPath } from "./config.js";
import { type FieldMapping, loadFieldMapping, resolveField } from "./field-mapping.js";

export async function openCollection(
  flagPath?: string,
): Promise<Collection> {
  const collectionPath = resolveCollectionPath(flagPath);
  const { collection, error } = await Collection.open(collectionPath);
  if (error) {
    throw new Error(`Failed to open collection at ${collectionPath}: ${error.message}`);
  }
  return collection!;
}

export async function withCollection<T>(
  fn: (collection: Collection, mapping: FieldMapping) => Promise<T>,
  flagPath?: string,
): Promise<T> {
  const collection = await openCollection(flagPath);
  const mapping = await loadFieldMapping(flagPath);
  try {
    return await fn(collection, mapping);
  } finally {
    await collection.close();
  }
}

export async function resolveTaskPath(
  collection: Collection,
  pathOrTitle: string,
  mapping: FieldMapping,
): Promise<string> {
  // If it looks like a path, use directly
  if (pathOrTitle.includes("/") || pathOrTitle.endsWith(".md")) {
    return pathOrTitle;
  }

  const titleField = resolveField(mapping, "title");
  const query = pathOrTitle.trim();
  const escaped = query.replace(/"/g, '\\"');

  // Try exact title match
  const exact = await queryTasks(collection, `${titleField} == "${escaped}"`, 20);

  if (exact.length === 1) {
    return exact[0].path;
  }
  if (exact.length > 1) {
    throw new Error(formatAmbiguousTaskError(query, exact, titleField));
  }

  // Fallback for filename-based title mode
  const exactBasename = dedupeByPath([
    ...await queryTasks(collection, `file.basename == "${escaped}"`, 20),
    ...await queryTasks(collection, `file.name == "${escaped}.md"`, 20),
  ]);
  if (exactBasename.length === 1) {
    return exactBasename[0].path;
  }
  if (exactBasename.length > 1) {
    throw new Error(formatAmbiguousTaskError(query, exactBasename, titleField));
  }

  // Try fuzzy title/basename match
  const fuzzyTitle = await queryTasks(collection, `${titleField}.contains("${escaped}")`, 20);
  const fuzzyBasename = dedupeByPath([
    ...await queryTasks(collection, `file.basename.contains("${escaped}")`, 20),
    ...await queryTasks(collection, `file.name.contains("${escaped}")`, 20),
  ]);
  const fuzzy = dedupeByPath([...fuzzyTitle, ...fuzzyBasename]);

  if (fuzzy.length === 1) {
    return fuzzy[0].path;
  }

  if (fuzzy.length > 1) {
    throw new Error(
      formatAmbiguousTaskError(
        query,
        rankCandidates(query, fuzzy, titleField),
        titleField,
      ),
    );
  }

  throw new Error(`No task found matching "${query}"`);
}

interface TaskQueryResult {
  path: string;
  frontmatter?: Record<string, unknown>;
}

async function queryTasks(
  collection: Collection,
  where: string,
  limit: number,
): Promise<TaskQueryResult[]> {
  try {
    const result = await collection.query({
      types: ["task"],
      where,
      limit,
    });
    return (result.results || []) as TaskQueryResult[];
  } catch {
    return [];
  }
}

function dedupeByPath(candidates: TaskQueryResult[]): TaskQueryResult[] {
  const seen = new Set<string>();
  const deduped: TaskQueryResult[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    deduped.push(candidate);
  }
  return deduped;
}

function rankCandidates(
  query: string,
  candidates: TaskQueryResult[],
  titleField: string,
): TaskQueryResult[] {
  const q = query.toLowerCase();
  return [...candidates].sort((a, b) => {
    const scoreA = scoreCandidate(q, a, titleField);
    const scoreB = scoreCandidate(q, b, titleField);
    if (scoreA !== scoreB) return scoreB - scoreA;

    const titleA = getTaskTitle(a, titleField).toLowerCase();
    const titleB = getTaskTitle(b, titleField).toLowerCase();
    if (titleA !== titleB) return titleA.localeCompare(titleB);
    return a.path.localeCompare(b.path);
  });
}

function scoreCandidate(
  query: string,
  candidate: TaskQueryResult,
  titleField: string,
): number {
  const title = getTaskTitle(candidate, titleField).toLowerCase();
  const path = candidate.path.toLowerCase();
  let score = 0;
  if (title === query) score += 100;
  if (title.startsWith(query)) score += 50;
  if (title.includes(query)) score += 25;
  if (path.includes(query)) score += 10;
  score += Math.max(0, 10 - Math.abs(title.length - query.length));
  return score;
}

function formatAmbiguousTaskError(
  query: string,
  candidates: TaskQueryResult[],
  titleField: string,
): string {
  const preview = candidates.slice(0, 5).map((candidate, index) => {
    const title = getTaskTitle(candidate, titleField);
    return `  ${index + 1}. ${title} (${candidate.path})`;
  }).join("\n");
  const more = candidates.length > 5 ? `\n  ...and ${candidates.length - 5} more` : "";
  const examplePath = candidates[0]?.path || "tasks/<task>.md";

  return [
    `Ambiguous task reference "${query}".`,
    "Matches (best first):",
    `${preview}${more}`,
    `Use a full path to disambiguate (for example: ${examplePath}).`,
  ].join("\n");
}

function getTaskTitle(candidate: TaskQueryResult, titleField: string): string {
  if (candidate.frontmatter && titleField) {
    const raw = candidate.frontmatter[titleField];
    if (typeof raw === "string" && raw.trim().length > 0) {
      return raw;
    }
  }

  const fromPath = basename(candidate.path, ".md").trim();
  return fromPath.length > 0 ? fromPath : candidate.path;
}
