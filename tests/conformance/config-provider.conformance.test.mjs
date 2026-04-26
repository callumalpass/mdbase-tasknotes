import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function makeTempHome(prefix = "mtn-home-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function loadConfigModule(tempHome, tag) {
  const prevHome = process.env.HOME;
  process.env.HOME = tempHome;
  try {
    return await import(`../../dist/config.js?${tag}`);
  } finally {
    process.env.HOME = prevHome;
  }
}

test("config/provider conformance: load/save defaults", async (t) => {
  const home = makeTempHome();
  const mod = await loadConfigModule(home, `a-${Date.now()}`);

  await t.test("getConfig returns defaults when file missing", () => {
    const cfg = mod.getConfig();
    assert.equal(cfg.collectionPath, null);
    assert.equal(cfg.language, "en");
  });

  await t.test("setConfig writes config file", () => {
    mod.setConfig("collectionPath", "/tmp/demo");
    mod.setConfig("language", "fr");
    const configPath = mod.getConfigPath();
    assert.equal(existsSync(configPath), true);
    const text = readFileSync(configPath, "utf8");
    assert.match(text, /collectionPath/);
    assert.match(text, /language/);
  });

  await t.test("getConfig reflects persisted values", () => {
    const cfg = mod.getConfig();
    assert.equal(cfg.collectionPath, "/tmp/demo");
    assert.equal(cfg.language, "fr");
  });
});

test("config/provider conformance: resolveCollectionPath precedence matrix", async (t) => {
  const home = makeTempHome();
  const mod = await loadConfigModule(home, `b-${Date.now()}`);

  const tmpCollection = join(home, "my-collection");
  mkdirSync(tmpCollection, { recursive: true });
  mod.setConfig("collectionPath", tmpCollection);

  const originalEnv = process.env.MDBASE_TASKNOTES_PATH;
  const originalHome = process.env.HOME;
  const originalCwd = process.cwd();
  const cwdA = mkdtempSync(join(tmpdir(), "mtn-cwd-a-"));
  const cwdB = mkdtempSync(join(tmpdir(), "mtn-cwd-b-"));

  const cases = [
    {
      name: "flag wins over env/config/cwd",
      flag: join(cwdA, "flag"),
      env: join(cwdA, "env"),
      cwd: cwdA,
      expected: join(cwdA, "flag"),
    },
    {
      name: "env wins over config/cwd when no flag",
      flag: undefined,
      env: join(cwdA, "env2"),
      cwd: cwdA,
      expected: join(cwdA, "env2"),
    },
    {
      name: "config wins over cwd when no flag/env",
      flag: undefined,
      env: undefined,
      cwd: cwdA,
      expected: tmpCollection,
    },
    {
      name: "cwd fallback when no flag/env/config",
      flag: undefined,
      env: undefined,
      cwd: cwdB,
      expected: cwdB,
      clearConfig: true,
    },
  ];

  try {
    process.env.HOME = home;

    for (const c of cases) {
      await t.test(c.name, () => {
        if (c.clearConfig) {
          mod.setConfig("collectionPath", null);
        } else {
          mod.setConfig("collectionPath", tmpCollection);
        }

        if (c.env === undefined) {
          delete process.env.MDBASE_TASKNOTES_PATH;
        } else {
          process.env.MDBASE_TASKNOTES_PATH = c.env;
        }

        process.chdir(c.cwd);
        const resolved = mod.resolveCollectionPath(c.flag);
        assert.equal(resolved, resolve(c.expected));
      });
    }

    const comboFlags = [undefined, join(cwdA, "flag1"), join(cwdB, "flag2")];
    const comboEnvs = [undefined, join(cwdA, "env1"), join(cwdB, "env2")];
    const comboConfigs = [null, tmpCollection, join(cwdB, "cfg2")];
    const comboCwds = [cwdA, cwdB];

    let index = 0;
    for (const flag of comboFlags) {
      for (const env of comboEnvs) {
        for (const cfg of comboConfigs) {
          for (const cwd of comboCwds) {
            index += 1;
            await t.test(`precedence combination #${index}`, () => {
              mod.setConfig("collectionPath", cfg);
              if (env === undefined) delete process.env.MDBASE_TASKNOTES_PATH;
              else process.env.MDBASE_TASKNOTES_PATH = env;
              process.chdir(cwd);

              const expected = flag
                ? resolve(flag)
                : env
                  ? resolve(env)
                  : cfg
                    ? resolve(cfg)
                    : resolve(cwd);

              assert.equal(mod.resolveCollectionPath(flag), expected);
            });
          }
        }
      }
    }

    await t.test("expands home directory in flag path", () => {
      mod.setConfig("collectionPath", tmpCollection);
      process.env.MDBASE_TASKNOTES_PATH = join(cwdA, "env");
      process.chdir(cwdA);

      assert.equal(mod.resolveCollectionPath("~/flag"), resolve(join(home, "flag")));
    });

    await t.test("expands home directory in env path", () => {
      mod.setConfig("collectionPath", tmpCollection);
      process.env.MDBASE_TASKNOTES_PATH = "~/env";
      process.chdir(cwdA);

      assert.equal(mod.resolveCollectionPath(undefined), resolve(join(home, "env")));
    });

    await t.test("expands home directory in config path", () => {
      mod.setConfig("collectionPath", "~/configured");
      delete process.env.MDBASE_TASKNOTES_PATH;
      process.chdir(cwdA);

      assert.equal(mod.resolveCollectionPath(undefined), resolve(join(home, "configured")));
    });
  } finally {
    if (originalEnv === undefined) delete process.env.MDBASE_TASKNOTES_PATH;
    else process.env.MDBASE_TASKNOTES_PATH = originalEnv;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    process.chdir(originalCwd);
  }
});
