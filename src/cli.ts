import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { createCommand } from "./commands/create.js";
import { listCommand } from "./commands/list.js";
import { showCommand } from "./commands/show.js";
import { completeCommand } from "./commands/complete.js";
import { updateCommand } from "./commands/update.js";
import { deleteCommand } from "./commands/delete.js";
import { archiveCommand } from "./commands/archive.js";
import { searchCommand } from "./commands/search.js";
import {
  timerStartCommand,
  timerStopCommand,
  timerStatusCommand,
  timerLogCommand,
} from "./commands/timer.js";
import { projectsListCommand, projectsShowCommand } from "./commands/projects.js";
import { statsCommand } from "./commands/stats.js";
import { interactiveCommand } from "./commands/interactive.js";
import { configCommand } from "./commands/config.js";
import { skipCommand, unskipCommand } from "./commands/skip.js";

const program = new Command();

program
  .name("mtn")
  .description("Standalone CLI for managing markdown tasks via mdbase")
  .version("0.1.2")
  .option("-p, --path <path>", "Path to mdbase collection");

// Init
program
  .command("init [path]")
  .description("Initialize a new mdbase-tasknotes collection")
  .option("-f, --force", "Overwrite existing files")
  .action(initCommand);

// Create
program
  .command("create <text...>")
  .description("Create a task from natural language text")
  .action((text: string[], opts: any) => {
    const parentOpts = program.opts();
    return createCommand(text, { path: parentOpts.path });
  });

// List
program
  .command("list")
  .alias("ls")
  .description("List tasks with optional filters")
  .option("-s, --status <status>", "Filter by status")
  .option("--priority <priority>", "Filter by priority")
  .option("-t, --tag <tag>", "Filter by tag")
  .option("-d, --due <date>", "Filter by due date")
  .option("--overdue", "Show overdue tasks")
  .option("-w, --where <expr>", "Raw mdbase where expression")
  .option("--on <date>", "Evaluate recurring instance state on date (YYYY-MM-DD)")
  .option("-l, --limit <n>", "Maximum results")
  .option("--json", "Output as JSON")
  .action((opts: any) => {
    const parentOpts = program.opts();
    return listCommand({ ...opts, path: parentOpts.path });
  });

// Show
program
  .command("show <pathOrTitle>")
  .description("Show full task detail")
  .option("--on <date>", "Show recurring instance state on date (YYYY-MM-DD)")
  .action((pathOrTitle: string, opts: any) => {
    const parentOpts = program.opts();
    return showCommand(pathOrTitle, { ...opts, path: parentOpts.path });
  });

// Complete
program
  .command("complete <pathOrTitle>")
  .alias("done")
  .description("Mark a task as completed")
  .option("-d, --date <date>", "Recurring instance date in YYYY-MM-DD (default: today)")
  .action((pathOrTitle: string, opts: any) => {
    const parentOpts = program.opts();
    return completeCommand(pathOrTitle, { ...opts, path: parentOpts.path });
  });

// Update
program
  .command("update <pathOrTitle>")
  .description("Update task fields")
  .option("-s, --status <status>", "Set status")
  .option("--priority <priority>", "Set priority")
  .option("-d, --due <date>", "Set due date")
  .option("--scheduled <date>", "Set scheduled date")
  .option("-t, --title <title>", "Set title")
  .option("--add-tag <tag>", "Add a tag", collect, [])
  .option("--remove-tag <tag>", "Remove a tag", collect, [])
  .option("--add-context <ctx>", "Add a context", collect, [])
  .option("--remove-context <ctx>", "Remove a context", collect, [])
  .action((pathOrTitle: string, opts: any) => {
    const parentOpts = program.opts();
    return updateCommand(pathOrTitle, {
      ...opts,
      path: parentOpts.path,
      addTag: opts.addTag?.length ? opts.addTag : undefined,
      removeTag: opts.removeTag?.length ? opts.removeTag : undefined,
      addContext: opts.addContext?.length ? opts.addContext : undefined,
      removeContext: opts.removeContext?.length ? opts.removeContext : undefined,
    });
  });

// Delete
program
  .command("delete <pathOrTitle>")
  .alias("rm")
  .description("Delete a task")
  .option("-f, --force", "Skip backlink check")
  .action((pathOrTitle: string, opts: any) => {
    const parentOpts = program.opts();
    return deleteCommand(pathOrTitle, { ...opts, path: parentOpts.path });
  });

// Archive
program
  .command("archive <pathOrTitle>")
  .description("Archive a task (add archive tag)")
  .action((pathOrTitle: string) => {
    const parentOpts = program.opts();
    return archiveCommand(pathOrTitle, { path: parentOpts.path });
  });

// Skip recurring instance
program
  .command("skip <pathOrTitle>")
  .description("Skip a recurring task instance")
  .option("-d, --date <date>", "Instance date in YYYY-MM-DD (default: today)")
  .action((pathOrTitle: string, opts: any) => {
    const parentOpts = program.opts();
    return skipCommand(pathOrTitle, { ...opts, path: parentOpts.path });
  });

// Unskip recurring instance
program
  .command("unskip <pathOrTitle>")
  .description("Unskip a recurring task instance")
  .option("-d, --date <date>", "Instance date in YYYY-MM-DD (default: today)")
  .action((pathOrTitle: string, opts: any) => {
    const parentOpts = program.opts();
    return unskipCommand(pathOrTitle, { ...opts, path: parentOpts.path });
  });

// Search
program
  .command("search <query...>")
  .description("Full-text search across tasks")
  .option("-l, --limit <n>", "Maximum results")
  .action((query: string[], opts: any) => {
    const parentOpts = program.opts();
    return searchCommand(query, { ...opts, path: parentOpts.path });
  });

// Timer
const timer = program
  .command("timer")
  .description("Time tracking commands");

timer
  .command("start <pathOrTitle>")
  .description("Start a timer for a task")
  .option("-d, --description <desc>", "Timer description")
  .action((pathOrTitle: string, opts: any) => {
    const parentOpts = program.opts();
    return timerStartCommand(pathOrTitle, { ...opts, path: parentOpts.path });
  });

timer
  .command("stop")
  .description("Stop the running timer")
  .action(() => {
    const parentOpts = program.opts();
    return timerStopCommand({ path: parentOpts.path });
  });

timer
  .command("status")
  .description("Show active timers")
  .action(() => {
    const parentOpts = program.opts();
    return timerStatusCommand({ path: parentOpts.path });
  });

timer
  .command("log")
  .description("Show time entry log")
  .option("--from <date>", "Start date filter")
  .option("--to <date>", "End date filter")
  .option("--period <period>", "Predefined period (today, week)")
  .action((opts: any) => {
    const parentOpts = program.opts();
    return timerLogCommand({ ...opts, path: parentOpts.path });
  });

// Projects
const projects = program
  .command("projects")
  .description("Project management commands");

projects
  .command("list")
  .alias("ls")
  .description("List all projects")
  .option("--stats", "Show completion statistics")
  .action((opts: any) => {
    const parentOpts = program.opts();
    return projectsListCommand({ ...opts, path: parentOpts.path });
  });

projects
  .command("show <name>")
  .description("Show tasks for a project")
  .action((name: string) => {
    const parentOpts = program.opts();
    return projectsShowCommand(name, { path: parentOpts.path });
  });

// Make `projects` without subcommand default to list
projects.action((opts: any) => {
  const parentOpts = program.opts();
  return projectsListCommand({ ...opts, path: parentOpts.path });
});

// Stats
program
  .command("stats")
  .description("Show task statistics")
  .action(() => {
    const parentOpts = program.opts();
    return statsCommand({ path: parentOpts.path });
  });

// Interactive
program
  .command("interactive")
  .alias("i")
  .description("Interactive REPL with live NLP preview")
  .action(() => {
    const parentOpts = program.opts();
    return interactiveCommand({ path: parentOpts.path });
  });

// Config
program
  .command("config")
  .description("Manage CLI configuration")
  .option("--set <key=value>", "Set a config value")
  .option("--get <key>", "Get a config value")
  .option("--list", "List all config values")
  .action(configCommand);

// Helper for collecting repeated options
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

program.parse();
