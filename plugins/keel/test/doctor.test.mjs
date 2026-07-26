/**
 * Doctor contract tests. Run: node --test
 *
 * The property that matters: a configured adapter whose bridge plugin is not
 * actually installed+enabled is a PROBLEM, not "all good". The env var is only
 * read by the plugin's MCP server; without the plugin the adapter silently
 * does nothing — which is exactly the failure doctor exists to catch.
 *
 * Hermetic: `claude` and `uvx` are stub executables in a temp PATH dir, so
 * these tests neither require nor touch a real Claude Code install.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const KEEL = join(HERE, "..", "bin", "keel");

/** A temp world: config dir with the memory adapter wired, stub CLIs on PATH. */
function world(pluginListJson) {
  const root = mkdtempSync(join(tmpdir(), "keel-doc-"));
  const bin = join(root, "bin");
  const cfg = join(root, "cfg");
  const notes = join(root, "notes");
  mkdirSync(bin);
  mkdirSync(cfg);
  mkdirSync(notes);
  writeFileSync(join(cfg, "settings.json"), JSON.stringify({ env: { KEEL_MEMORY_HOME: notes } }));
  writeFileSync(join(bin, "uvx"), "#!/bin/sh\nexit 0\n");
  writeFileSync(
    join(bin, "claude"),
    `#!/bin/sh\nif [ "$1 $2" = "plugin list" ]; then printf '%s' '${pluginListJson.replace(/'/g, "'\\''")}'; exit 0; fi\nexit 1\n`,
  );
  chmodSync(join(bin, "uvx"), 0o755);
  chmodSync(join(bin, "claude"), 0o755);
  return { root, bin, cfg };
}

function doctor(w) {
  return spawnSync(process.execPath, [KEEL, "doctor"], {
    encoding: "utf-8",
    env: {
      ...process.env,
      PATH: `${w.bin}:${process.env.PATH}`,
      CLAUDE_CONFIG_DIR: w.cfg,
    },
  });
}

describe("doctor checks the bridge plugin, not just the env var", () => {
  test("configured + plugin enabled -> all good", () => {
    const w = world(JSON.stringify([{ id: "keel-memory@keel", enabled: true }]));
    const r = doctor(w);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /all good/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("configured but plugin missing -> problem, with the install fix", () => {
    const w = world(JSON.stringify([]));
    const r = doctor(w);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /keel-memory plugin is not installed/);
    assert.match(r.stdout, /claude plugin install keel-memory@keel/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("configured but plugin disabled -> problem, with the enable fix", () => {
    const w = world(JSON.stringify([{ id: "keel-memory@keel", enabled: false }]));
    const r = doctor(w);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /keel-memory plugin is disabled/);
    assert.match(r.stdout, /claude plugin enable keel-memory@keel/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("configured but the notes directory is gone -> problem, with mkdir fix", () => {
    const w = world(JSON.stringify([{ id: "keel-memory@keel", enabled: true }]));
    rmSync(join(w.root, "notes"), { recursive: true, force: true });
    const r = doctor(w);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /notes directory does not exist/);
    assert.match(r.stdout, /mkdir -p/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("claude CLI unreachable -> unknown, not a problem", () => {
    const w = world("[]");
    // Break the stub so `plugin list` fails; doctor must fail soft.
    writeFileSync(join(w.bin, "claude"), "#!/bin/sh\nexit 1\n");
    chmodSync(join(w.bin, "claude"), 0o755);
    const r = doctor(w);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /plugin state unknown/);
    rmSync(w.root, { recursive: true, force: true });
  });
});
