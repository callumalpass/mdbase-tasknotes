import { Collection } from "@callumalpass/mdbase";
import { resolveCollectionPath } from "./config.js";

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
  fn: (collection: Collection) => Promise<T>,
  flagPath?: string,
): Promise<T> {
  const collection = await openCollection(flagPath);
  try {
    return await fn(collection);
  } finally {
    await collection.close();
  }
}

export async function resolveTaskPath(
  collection: Collection,
  pathOrTitle: string,
): Promise<string> {
  // If it looks like a path, use directly
  if (pathOrTitle.includes("/") || pathOrTitle.endsWith(".md")) {
    return pathOrTitle;
  }

  // Try exact title match
  const exact = await collection.query({
    types: ["task"],
    where: `title == "${pathOrTitle.replace(/"/g, '\\"')}"`,
    limit: 2,
  });

  if (exact.results && exact.results.length === 1) {
    return exact.results[0].path;
  }

  // Try contains match
  const fuzzy = await collection.query({
    types: ["task"],
    where: `title.contains("${pathOrTitle.replace(/"/g, '\\"')}")`,
    limit: 5,
  });

  if (fuzzy.results && fuzzy.results.length === 1) {
    return fuzzy.results[0].path;
  }

  if (fuzzy.results && fuzzy.results.length > 1) {
    const titles = fuzzy.results.map((r) => `  - ${r.path}`).join("\n");
    throw new Error(`Ambiguous title "${pathOrTitle}". Matches:\n${titles}`);
  }

  throw new Error(`No task found matching "${pathOrTitle}"`);
}
