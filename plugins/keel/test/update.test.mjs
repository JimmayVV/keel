/**
 * `keel update` contract tests. Run: node --test
 *
 * Properties: it updates keel itself, updates ONLY bridge plugins that are
 * actually installed, and fails loudly when the claude CLI is unreachable.
 * Hermetic: a stub `claude` on a temp PATH records every invocation.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const KEEL = join(HERE, "..", "bin", "keel");

function world(pluginListJson) {
  const root = mkdtempSync(join(tmpdir(), "keel-upd-"));
  const bin = join(root, "bin");
  const cfg = join(root, "cfg");
  const home = join(root, "home");
  mkdirSync(bin);
  mkdirSync(cfg);
  mkdirSync(home);
  const log = join(root, "calls.log");
  writeFileSync(
    join(bin, "claude"),
    `#!/bin/sh\necho "$@" >> '${log}'\n` +
      `if [ "$1 $2 $3" = "plugin list --json" ]; then printf '%s' '${pluginListJson.replace(/'/g, "'\\''")}'; fi\nexit 0\n`,
  );
  chmodSync(join(bin, "claude"), 0o755);
  return { root, bin, cfg, home, log };
}

function update(w) {
  return spawnSync(process.execPath, [KEEL, "update"], {
    encoding: "utf-8",
    env: { ...process.env, PATH: `${w.bin}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: w.cfg, HOME: w.home },
  });
}

describe("keel update", () => {
  test("refreshes the marketplace and updates keel", () => {
    const w = world("[]");
    const r = update(w);
    assert.equal(r.status, 0, r.stdout);
    const calls = readFileSync(w.log, "utf-8");
    assert.match(calls, /plugin marketplace update/);
    assert.match(calls, /plugin update keel@keel/);
    assert.match(r.stdout, /up to date/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("updates an installed bridge plugin, and only an installed one", () => {
    const w = world(JSON.stringify([{ id: "keel-memory@keel", enabled: true }]));
    const r = update(w);
    assert.equal(r.status, 0, r.stdout);
    const calls = readFileSync(w.log, "utf-8");
    assert.match(calls, /plugin update keel-memory@keel/);
    assert.doesNotMatch(calls, /plugin update keel-reflect@keel/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("claude CLI unreachable -> loud failure, exit 1", () => {
    const w = world("[]");
    writeFileSync(join(w.bin, "claude"), "#!/bin/sh\nexit 1\n");
    chmodSync(join(w.bin, "claude"), 0o755);
    const r = update(w);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /not reachable/);
    assert.equal(existsSync(w.log), false, "no update steps should have run");
    rmSync(w.root, { recursive: true, force: true });
  });
});
