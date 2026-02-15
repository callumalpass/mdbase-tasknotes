import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { CLIConfig } from "./types.js";

const CONFIG_DIR = path.join(
  os.homedir(),
  ".config",
  "mdbase-tasknotes",
);
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: CLIConfig = {
  collectionPath: null,
  language: "en",
};

function load(): CLIConfig {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function save(config: CLIConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
}

export function getConfig(): CLIConfig {
  return load();
}

export function setConfig(key: string, value: string | null): void {
  const config = load();
  if (key === "collectionPath") {
    config.collectionPath = value;
  } else if (key === "language") {
    config.language = value ?? "en";
  }
  save(config);
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function resolveCollectionPath(flagPath?: string): string {
  if (flagPath) return path.resolve(flagPath);
  const envPath = process.env.MDBASE_TASKNOTES_PATH;
  if (envPath) return path.resolve(envPath);
  const config = load();
  if (config.collectionPath) return path.resolve(config.collectionPath);
  return process.cwd();
}
