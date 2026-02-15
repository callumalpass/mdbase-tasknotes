import chalk from "chalk";
import { initCollection, initCollectionForce } from "../init.js";

export async function initCommand(
  targetPath: string | undefined,
  options: { force?: boolean },
): Promise<void> {
  const target = targetPath || process.cwd();

  try {
    const init = options.force ? initCollectionForce : initCollection;
    const { created } = await init(target);

    console.log(chalk.green("✓") + " Initialized mdbase-tasknotes collection:");
    for (const file of created) {
      console.log(chalk.dim("  " + file));
    }
    console.log("");
    console.log(`Collection path: ${chalk.cyan(target)}`);
    console.log(`Create tasks with: ${chalk.cyan("mtn create \"Buy groceries tomorrow #shopping\"")}`);
  } catch (err) {
    console.error(chalk.red("✗") + ` ${(err as Error).message}`);
    process.exit(1);
  }
}
