import chalk from "chalk";
import { getConfig, setConfig, getConfigPath } from "../config.js";
import { showError, showSuccess } from "../format.js";

export function configCommand(options: {
  set?: string;
  get?: string;
  list?: boolean;
}): void {
  if (options.set) {
    const eqIndex = options.set.indexOf("=");
    if (eqIndex === -1) {
      showError('Invalid format. Use --set key=value (e.g., --set collectionPath=/path/to/vault)');
      process.exit(1);
    }
    const key = options.set.slice(0, eqIndex);
    const value = options.set.slice(eqIndex + 1);

    if (key !== "collectionPath" && key !== "language") {
      showError(`Unknown config key: ${key}. Valid keys: collectionPath, language`);
      process.exit(1);
    }

    setConfig(key, value || null);
    showSuccess(`Set ${key} = ${value || "(null)"}`);
    return;
  }

  if (options.get) {
    const config = getConfig();
    const key = options.get as keyof typeof config;
    if (!(key in config)) {
      showError(`Unknown config key: ${key}. Valid keys: collectionPath, language`);
      process.exit(1);
    }
    console.log(config[key] ?? "(not set)");
    return;
  }

  // Default: list all
  const config = getConfig();
  console.log(chalk.dim(`Config file: ${getConfigPath()}\n`));
  for (const [key, value] of Object.entries(config)) {
    console.log(`  ${key}: ${value ?? chalk.dim("(not set)")}`);
  }
}
