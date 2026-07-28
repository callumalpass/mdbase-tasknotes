import * as fs from "node:fs";
import * as path from "node:path";
import { buildTaskNotesMdbaseResources } from "@tasknotes/model/mdbase";
import { resolveUserPath } from "./config.js";

export interface InitOptions {
  tasksFolder?: string;
  statuses?: string[];
  priorities?: string[];
  defaultStatus?: string;
  defaultPriority?: string;
}

const DEFAULTS: Required<InitOptions> = {
  tasksFolder: "tasks",
  statuses: ["open", "in-progress", "done", "cancelled"],
  priorities: ["low", "normal", "high", "urgent"],
  defaultStatus: "open",
  defaultPriority: "normal",
};

export function buildMdbaseYaml(): string {
  return buildInitResources().configDocument;
}

export function buildTaskTypeDef(opts: InitOptions = {}): string {
  const o = { ...DEFAULTS, ...opts };
  return buildInitResources(o).typeDocument;
}

function buildInitResources(opts: InitOptions = {}) {
  const o = { ...DEFAULTS, ...opts };
  return buildTaskNotesMdbaseResources({
    tasksFolder: o.tasksFolder,
    collection: {
      name: "TaskNotes",
      description: "Task collection managed by mdbase-tasknotes",
      validation: "warn",
    },
    path: {
      template: "{{title}}",
      runtime: "tasknotes",
      generatedBy: "tasknotes.filename.create",
    },
    title: {
      filenameFormat: "title",
    },
    modelConfig: {
      fieldMapping: {
        recurrenceAnchor: "recurrenceAnchor",
        recurrenceParent: "recurrenceParent",
        occurrenceDate: "occurrenceDate",
        occurrenceMaterialization: "occurrenceMaterialization",
        occurrenceNextTrigger: "occurrenceNextTrigger",
        occurrenceTemplate: "occurrenceTemplate",
        occurrencePastHorizon: "occurrencePastHorizon",
        occurrenceFutureHorizon: "occurrenceFutureHorizon",
        completeInstances: "completeInstances",
        skippedInstances: "skippedInstances",
      },
      statuses: o.statuses.map((value, order) => {
        const lower = value.toLowerCase();
        const isCompleted =
          lower.includes("done") ||
          lower.includes("complete");
        const isSkipped = lower.includes("cancel") || lower.includes("skip");
        return {
          id: value,
          value,
          label: value,
          color: "",
          isCompleted,
          ...(isSkipped ? { isSkipped: true } : {}),
          order,
          autoArchive: false,
          autoArchiveDelay: 0,
        };
      }),
      priorities: o.priorities.map((value, weight) => ({
        id: value,
        value,
        label: value,
        color: "",
        weight,
      })),
      defaults: {
        status: o.defaultStatus,
        priority: o.defaultPriority,
      },
    },
  });
}

function writeCollectionResources(
  targetPath: string,
  force: boolean,
): { created: string[] } {
  const absPath = resolveUserPath(targetPath);
  const resources = buildInitResources();
  const files = [
    [resources.paths.config, resources.configDocument],
    [resources.paths.contract, resources.contractDocument],
    [resources.paths.type, resources.typeDocument],
    [resources.paths.taskSchema, resources.taskSchemaDocument],
    [resources.paths.bindingSchema, resources.bindingSchemaDocument],
  ] as const;

  if (!force) {
    const existing = files.find(([relativePath]) =>
      fs.existsSync(path.join(absPath, relativePath))
    );
    if (existing) {
      throw new Error(
        `${existing[0]} already exists at ${absPath}. Use --force to overwrite.`,
      );
    }
  }

  fs.mkdirSync(absPath, { recursive: true });
  for (const [relativePath, document] of files) {
    const destination = path.join(absPath, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, document);
  }

  fs.mkdirSync(path.join(absPath, resources.paths.records), { recursive: true });
  return {
    created: [
      ...files.map(([relativePath]) => relativePath),
      `${resources.paths.records}/`,
    ],
  };
}

export async function initCollection(targetPath: string): Promise<{ created: string[] }> {
  return writeCollectionResources(targetPath, false);
}

export async function initCollectionForce(targetPath: string): Promise<{ created: string[] }> {
  return writeCollectionResources(targetPath, true);
}
