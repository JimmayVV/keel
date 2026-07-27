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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync, symlinkSync, readlinkSync } from "node:fs";
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

/**
 * The failure this suite existed to catch and didn't.
 *
 * An update leaves BOTH cache directories in place, so ~/.local/bin/keel kept
 * resolving — just to the old binary. The repair only fired on a dangling link,
 * so it never ran: `claude plugin update` reported success, the plugin really
 * did update, and the `keel` on PATH stayed weeks behind with no symptom.
 * Resolving is not evidence of health; matching the installed path is.
 */
describe("PATH symlink repair", () => {
  function withLink(w, { linkTo, installPath }) {
    const cache = join(w.cfg, "plugins", "cache", "keel", "keel");
    for (const v of ["0.1.0", "0.2.0"]) {
      mkdirSync(join(cache, v, "bin"), { recursive: true });
      writeFileSync(join(cache, v, "bin", "keel"), "#!/usr/bin/env node\n");
    }
    mkdirSync(join(w.cfg, "plugins"), { recursive: true });
    writeFileSync(
      join(w.cfg, "plugins", "installed_plugins.json"),
      JSON.stringify({ plugins: { "keel@keel": [{ installPath: join(cache, installPath) }] } }),
    );
    const link = join(w.home, ".local", "bin", "keel");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(join(cache, linkTo, "bin", "keel"), link);
    return { link, cache };
  }

  test("repoints a link that resolves but points at the wrong version", () => {
    const w = world("[]");
    const { link, cache } = withLink(w, { linkTo: "0.1.0", installPath: "0.2.0" });
    const r = update(w);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /PATH link repointed/);
    assert.equal(readlinkSync(link), join(cache, "0.2.0", "bin", "keel"), "must follow the installed copy");
    rmSync(w.root, { recursive: true, force: true });
  });

  test("leaves a correct link alone", () => {
    const w = world("[]");
    const { link, cache } = withLink(w, { linkTo: "0.2.0", installPath: "0.2.0" });
    const r = update(w);
    assert.doesNotMatch(r.stdout, /PATH link repointed/, "no churn when it is already right");
    assert.equal(readlinkSync(link), join(cache, "0.2.0", "bin", "keel"));
    rmSync(w.root, { recursive: true, force: true });
  });

  test("does not touch a link that points outside the plugin cache", () => {
    const w = world("[]");
    const own = join(w.root, "my-own-keel");
    writeFileSync(own, "#!/bin/sh\n");
    const link = join(w.home, ".local", "bin", "keel");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(own, link);
    update(w);
    assert.equal(readlinkSync(link), own, "somebody else's binary is none of keel's business");
    rmSync(w.root, { recursive: true, force: true });
  });
});

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
