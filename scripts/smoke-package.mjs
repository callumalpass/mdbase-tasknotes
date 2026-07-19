import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "..");
const tempRoot = mkdtempSync(join(tmpdir(), "mdbase-tasknotes-package-smoke-"));
let tarball;

function runNpm(args, options) {
  if (process.env.npm_execpath) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], options);
  }
  return execFileSync("npm", args, { ...options, shell: process.platform === "win32" });
}

try {
  const packed = JSON.parse(
    runNpm(["pack", "--json"], {
      cwd: packageRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  );
  tarball = resolve(packageRoot, packed[0].filename);

  writeFileSync(
    join(tempRoot, "package.json"),
    JSON.stringify({ name: "mdbase-tasknotes-package-smoke", private: true }),
  );
  runNpm(["install", "--ignore-scripts", tarball], {
    cwd: tempRoot,
    stdio: "inherit",
  });

  const cli = join(tempRoot, "node_modules", "mdbase-tasknotes", "dist", "cli.js");
  const version = execFileSync(process.execPath, [cli, "--version"], {
    cwd: tempRoot,
    encoding: "utf8",
  }).trim();
  if (version !== "0.2.0-rc.1") {
    throw new Error(`Unexpected installed CLI version: ${version}`);
  }
} finally {
  if (tarball) rmSync(tarball, { force: true });
  rmSync(tempRoot, { recursive: true, force: true });
}
