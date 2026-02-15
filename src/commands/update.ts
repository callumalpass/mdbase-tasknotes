import { withCollection, resolveTaskPath } from "../collection.js";
import { showError, showSuccess } from "../format.js";

export async function updateCommand(
  pathOrTitle: string,
  options: {
    path?: string;
    status?: string;
    priority?: string;
    due?: string;
    scheduled?: string;
    title?: string;
    addTag?: string[];
    removeTag?: string[];
    addContext?: string[];
    removeContext?: string[];
  },
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
      const fields: Record<string, unknown> = {};

      if (options.status) fields.status = options.status;
      if (options.priority) fields.priority = options.priority;
      if (options.due) fields.due = options.due;
      if (options.scheduled) fields.scheduled = options.scheduled;
      if (options.title) fields.title = options.title;

      // Handle tag modifications
      if (options.addTag || options.removeTag) {
        let tags = Array.isArray(fm.tags) ? [...(fm.tags as string[])] : [];
        if (options.addTag) {
          for (const t of options.addTag) {
            if (!tags.includes(t)) tags.push(t);
          }
        }
        if (options.removeTag) {
          tags = tags.filter((t) => !options.removeTag!.includes(t));
        }
        fields.tags = tags;
      }

      // Handle context modifications
      if (options.addContext || options.removeContext) {
        let contexts = Array.isArray(fm.contexts) ? [...(fm.contexts as string[])] : [];
        if (options.addContext) {
          for (const c of options.addContext) {
            if (!contexts.includes(c)) contexts.push(c);
          }
        }
        if (options.removeContext) {
          contexts = contexts.filter((c) => !options.removeContext!.includes(c));
        }
        fields.contexts = contexts;
      }

      if (Object.keys(fields).length === 0) {
        showError("No fields to update. Use flags like --status, --priority, --due, etc.");
        process.exit(1);
      }

      const result = await collection.update({
        path: taskPath,
        fields,
      });

      if (result.error) {
        showError(`Failed to update task: ${result.error.message}`);
        process.exit(1);
      }

      showSuccess(`Updated: ${fm.title || taskPath}`);
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}
