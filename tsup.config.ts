import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: false,
  noExternal: ["tasknotes-nlp-core"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
