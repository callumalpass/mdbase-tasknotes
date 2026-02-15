import * as readline from "node:readline";
import chalk from "chalk";
import { withCollection } from "../collection.js";
import { createParser } from "../nlp.js";
import { mapToFrontmatter } from "../mapper.js";
import { formatTask, showError, showSuccess } from "../format.js";
import { denormalizeFrontmatter, normalizeFrontmatter } from "../field-mapping.js";
import type { NaturalLanguageParserCore } from "tasknotes-nlp-core";
import type { Collection } from "@callumalpass/mdbase";
import type { FieldMapping } from "../field-mapping.js";
import type { TaskResult } from "../types.js";

let lastInput = "";
let previewTimer: ReturnType<typeof setTimeout> | null = null;
let lastPreviewText = "";
let lastKeyTime = 0;

function getAdaptiveDelay(
  str: string | undefined,
  key: readline.Key | undefined,
  timeSinceLastKey: number,
): number {
  if (str === "@" || str === "#" || str === "+" || str === "!") return 50;
  if (str === " ") return 100;
  if (key && (key.name === "backspace" || key.name === "delete")) return 150;
  if (timeSinceLastKey < 100) return 300;
  if (timeSinceLastKey < 300) return 180;
  return 120;
}

function formatPreviewInline(
  parser: NaturalLanguageParserCore,
  input: string,
): string {
  const parsed = parser.parseInput(input);
  const parts: string[] = [];

  if (parsed.title) parts.push(chalk.cyan(`"${parsed.title}"`));
  if (parsed.status) parts.push(chalk.yellow(`[${parsed.status}]`));
  if (parsed.priority) parts.push(chalk.red(`[${parsed.priority}]`));
  if (parsed.tags?.length) parts.push(parsed.tags.map((t) => chalk.cyan(`#${t}`)).join(" "));
  if (parsed.contexts?.length) parts.push(parsed.contexts.map((c) => chalk.magenta(`@${c}`)).join(" "));
  if (parsed.projects?.length) parts.push(parsed.projects.map((p) => chalk.blue(`+${p}`)).join(" "));
  if (parsed.dueDate) parts.push(chalk.yellow(`due:${parsed.dueDate}`));
  if (parsed.scheduledDate) parts.push(chalk.cyan(`scheduled:${parsed.scheduledDate}`));
  if (parsed.estimate) parts.push(chalk.dim(`~${parsed.estimate}m`));
  if (parsed.recurrence) parts.push(chalk.green(`recur:${parsed.recurrence}`));

  return parts.join(" ");
}

function updatePreview(text: string): void {
  process.stdout.write("\x1b[s"); // Save cursor
  process.stdout.write("\x1b[3A"); // Move up 3 lines
  process.stdout.write("\r\x1b[K"); // Clear line
  process.stdout.write(chalk.dim("Preview: ") + text);
  process.stdout.write("\x1b[u"); // Restore cursor
}

export async function interactiveCommand(
  options: { path?: string },
): Promise<void> {
  try {
    const parser = await createParser(options.path);

    await withCollection(async (collection, mapping) => {
      console.log(chalk.bold("mdbase-tasknotes Interactive Mode"));
      console.log(chalk.dim("Type a task description and press Enter to create"));
      console.log(chalk.dim("Press Ctrl+C to exit"));
      console.log("─".repeat(process.stdout.columns || 80));
      console.log(chalk.dim("Preview: (will appear here as you type)"));
      console.log("─".repeat(process.stdout.columns || 80));
      console.log("");

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk.green("Task: "),
      });

      rl.prompt();

      rl.on("line", async (input) => {
        const trimmed = input.trim();
        if (!trimmed) {
          rl.prompt();
          return;
        }

        process.stdout.write("\r\x1b[K");
        console.log(chalk.dim("Creating task..."));

        try {
          const parsed = parser.parseInput(trimmed);
          const { frontmatter, body } = mapToFrontmatter(parsed);

          const result = await collection.create({
            type: "task",
            frontmatter: denormalizeFrontmatter(frontmatter as Record<string, unknown>, mapping),
            body,
          });

          if (result.error) {
            showError(`Failed to create task: ${result.error.message}`);
          } else {
            const fm = normalizeFrontmatter(result.frontmatter as Record<string, unknown>, mapping);
            const task: TaskResult = {
              path: result.path!,
              frontmatter: fm as any,
            };
            showSuccess("Task created");
            console.log(formatTask(task));
            console.log(chalk.dim(`  → ${result.path}`));
          }
        } catch (err) {
          showError((err as Error).message);
        }

        console.log("\n" + "─".repeat(process.stdout.columns || 80));
        console.log(chalk.dim("Preview: (will appear here as you type)"));
        console.log("─".repeat(process.stdout.columns || 80));
        console.log("");

        lastInput = "";
        lastPreviewText = "";
        lastKeyTime = 0;
        rl.prompt();
      });

      rl.on("close", () => {
        console.log("\nGoodbye!");
        process.exit(0);
      });

      // Keypress handler for live preview
      process.stdin.on("keypress", (str: string, key: readline.Key) => {
        if (key && (key.ctrl || key.meta || key.name === "return" || key.name === "enter")) {
          return;
        }

        const now = Date.now();
        const timeSinceLastKey = now - lastKeyTime;
        lastKeyTime = now;

        if (previewTimer) clearTimeout(previewTimer);

        const delay = getAdaptiveDelay(str, key, timeSinceLastKey);

        previewTimer = setTimeout(() => {
          const currentInput = (rl as any).line ? (rl as any).line.trim() : "";
          if (currentInput && currentInput !== lastInput) {
            lastInput = currentInput;
            const preview = formatPreviewInline(parser, currentInput);
            if (preview !== lastPreviewText) {
              lastPreviewText = preview;
              updatePreview(preview);
            }
          } else if (!currentInput && lastPreviewText) {
            updatePreview("(will appear here as you type)");
            lastPreviewText = "";
          }
        }, delay);
      });

      // Keep the process alive
      await new Promise<void>(() => {});
    }, options.path);
  } catch (err) {
    showError((err as Error).message);
    process.exit(1);
  }
}
