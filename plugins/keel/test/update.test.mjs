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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync, symlinkSync, readlinkSync, lstatSync } from "node:fs";
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
 * The failure this suite existed to catch and didn't, and the reason the repair
 * was replaced rather than tightened.
 *
 * An update leaves BOTH cache directories in place, so ~/.local/bin/keel kept
 * resolving — just to the old binary. `claude plugin update` reported success,
 * the plugin really did update, and the `keel` on PATH stayed weeks behind with
 * no symptom. Repointing the link fixed that, but only for machines that could
 * already run the new code, which is not the set of machines with the problem.
 * A shim resolving installPath at run time has no version in it to go stale.
 */
describe("PATH entry migration", () => {
  function withCache(w, { installPath }) {
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
    return cache;
  }

  function withLink(w, { linkTo, installPath }) {
    const cache = withCache(w, { installPath });
    const link = join(w.home, ".local", "bin", "keel");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(join(cache, linkTo, "bin", "keel"), link);
    return { link, cache };
  }

  test("replaces a versioned symlink with a shim, whichever version it named", () => {
    for (const linkTo of ["0.1.0", "0.2.0"]) {
      const w = world("[]");
      const { link } = withLink(w, { linkTo, installPath: "0.2.0" });
      const r = update(w);
      assert.equal(r.status, 0, r.stdout);
      assert.match(r.stdout, /PATH entry now resolves the installed copy/);
      assert.equal(lstatSync(link).isSymbolicLink(), false, "a symlink is the thing that goes stale");
      assert.match(readFileSync(link, "utf-8"), /keel-path-shim/);
      rmSync(w.root, { recursive: true, force: true });
    }
  });

  test("the shim resolves the installed copy, and follows it when it moves", () => {
    const w = world("[]");
    const { link, cache } = withLink(w, { linkTo: "0.1.0", installPath: "0.1.0" });
    update(w);

    // Stand in for the real binary so the shim has something to exec.
    for (const v of ["0.1.0", "0.2.0"]) {
      writeFileSync(join(cache, v, "bin", "keel"), `#!/bin/sh\necho ran ${v}\n`);
      chmodSync(join(cache, v, "bin", "keel"), 0o755);
    }
    const run = () => spawnSync(link, [], { encoding: "utf-8", env: { ...process.env, CLAUDE_CONFIG_DIR: w.cfg, HOME: w.home } });
    assert.match(run().stdout, /ran 0\.1\.0/);

    // An update moves the install record. Nothing touches the shim.
    writeFileSync(
      join(w.cfg, "plugins", "installed_plugins.json"),
      JSON.stringify({ plugins: { "keel@keel": [{ installPath: join(cache, "0.2.0") }] } }),
    );
    assert.match(run().stdout, /ran 0\.2\.0/, "no repair step should be needed for this");
    rmSync(w.root, { recursive: true, force: true });
  });

  test("no churn once the shim is current", () => {
    const w = world("[]");
    const { link } = withLink(w, { linkTo: "0.1.0", installPath: "0.2.0" });
    update(w);
    const first = readFileSync(link, "utf-8");
    const r = update(w);
    assert.doesNotMatch(r.stdout, /PATH entry now resolves/, "already migrated");
    assert.equal(readFileSync(link, "utf-8"), first);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("does not touch a link that points outside the plugin cache", () => {
    const w = world("[]");
    withCache(w, { installPath: "0.2.0" });
    const own = join(w.root, "my-own-keel");
    writeFileSync(own, "#!/bin/sh\n");
    const link = join(w.home, ".local", "bin", "keel");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(own, link);
    update(w);
    assert.equal(readlinkSync(link), own, "somebody else's binary is none of keel's business");
    rmSync(w.root, { recursive: true, force: true });
  });

  test("does not touch a real file somebody put there", () => {
    const w = world("[]");
    withCache(w, { installPath: "0.2.0" });
    const link = join(w.home, ".local", "bin", "keel");
    mkdirSync(dirname(link), { recursive: true });
    writeFileSync(link, "#!/bin/sh\n# my own wrapper\n");
    update(w);
    assert.match(readFileSync(link, "utf-8"), /my own wrapper/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("does not opt you in when there is no PATH entry", () => {
    const w = world("[]");
    withCache(w, { installPath: "0.2.0" });
    update(w);
    assert.equal(existsSync(join(w.home, ".local", "bin", "keel")), false, "an update is not the moment to opt someone in");
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
