/**
 * Where keel's machine-specific keys live, and whether sessions can see them.
 * Run: node --test
 *
 * Claude Code's user scope is settings.json alone; settings.local.json is read
 * only as a project file. keel setup wrote KEEL_MEMORY_HOME and KEEL_DEVICE to
 * <config>/settings.local.json from 2026-07-27, so on a work machine the week
 * and deck skills ran for two months without a notes directory — and doctor,
 * which merged that file in, was green throughout.
 *
 * Hermetic in the doctor.test.mjs way: stub `claude` and `uvx` on PATH, HOME
 * and CLAUDE_CONFIG_DIR redirected into a temp dir.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KEEL = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "keel");

/**
 * `projects` is what `uvx basic-memory project list --json` answers; by
 * default one project at the notes dir, i.e. registration worked.
 */
function world({ settings = null, local = null, projects } = {}) {
  const root = mkdtempSync(join(tmpdir(), "keel-local-"));
  const bin = join(root, "bin");
  const cfg = join(root, "cfg");
  const notes = join(root, "notes");
  mkdirSync(bin);
  mkdirSync(cfg);
  mkdirSync(notes);
  if (settings) writeFileSync(join(cfg, "settings.json"), JSON.stringify(settings));
  if (local) writeFileSync(join(cfg, "settings.local.json"), JSON.stringify(local));
  const list = JSON.stringify({ projects: projects ?? [{ name: "keel", local_path: notes }] });
  writeFileSync(
    join(bin, "uvx"),
    `#!/bin/sh\nif [ "$1 $2 $3" = "basic-memory project list" ]; then printf '%s' '${list}'; exit 0; fi\n` +
      `if [ "$1 $2 $3" = "basic-memory project add" ]; then echo "Project 'keel' already exists"; fi\nexit 0\n`,
  );
  writeFileSync(
    join(bin, "claude"),
    `#!/bin/sh\nif [ "$1 $2" = "plugin list" ]; then printf '%s' '[{"id":"keel-memory@keel","enabled":true}]'; exit 0; fi\nexit 1\n`,
  );
  chmodSync(join(bin, "uvx"), 0o755);
  chmodSync(join(bin, "claude"), 0o755);
  return {
    root,
    notes,
    settings: join(cfg, "settings.json"),
    local: join(cfg, "settings.local.json"),
    run: (...args) =>
      spawnSync(process.execPath, [KEEL, ...args], {
        encoding: "utf-8",
        // The developer's own KEEL_* would leak in, and a real Hindsight URL makes
        // doctor probe a homelab from inside a test.
        env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("KEEL_"))), PATH: `${bin}:${process.env.PATH}`, HOME: root, CLAUDE_CONFIG_DIR: cfg },
      }),
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}

const read = (p) => JSON.parse(readFileSync(p, "utf-8"));

describe("setup writes machine keys where sessions read them", () => {
  test("a fresh setup puts KEEL_DEVICE and KEEL_MEMORY_HOME in settings.json", () => {
    const w = world();
    const r = w.run("setup", "--device", "box", "--memory-home", w.notes, "--skip", "reflect", "--non-interactive");
    try {
      assert.equal(r.status, 0, r.stdout);
      assert.deepEqual(read(w.settings).env, { KEEL_DEVICE: "box", KEEL_MEMORY_HOME: w.notes });
      assert.equal(existsSync(w.local), false, "settings.local.json is never created");
    } finally {
      w.done();
    }
  });
});

describe("setup moves keys an older setup stranded in settings.local.json", () => {
  test("stranded keys move to settings.json; the rest of both files stays, and both are backed up", () => {
    const w = world({
      settings: { model: "opus", env: { OTHER: "1" } },
      local: { env: { KEEL_DEVICE: "work", KEEL_MEMORY_HOME: "/x/notes", MINE: "kept" }, permissions: { allow: ["Bash(ls:*)"] } },
    });
    const r = w.run("setup", "--skip", "memory,reflect", "--non-interactive");
    try {
      assert.equal(r.status, 0, r.stdout);
      assert.match(r.stdout, /Moved to settings\.json/);
      assert.deepEqual(read(w.settings), { model: "opus", env: { OTHER: "1", KEEL_DEVICE: "work", KEEL_MEMORY_HOME: "/x/notes" } });
      assert.deepEqual(read(w.local), { env: { MINE: "kept" }, permissions: { allow: ["Bash(ls:*)"] } });
      assert.deepEqual(read(`${w.settings}.keel-backup`), { model: "opus", env: { OTHER: "1" } });
      assert.equal(read(`${w.local}.keel-backup`).env.KEEL_DEVICE, "work", "the local backup is the pre-move file");
    } finally {
      w.done();
    }
  });

  test("a key already set in settings.json is never overwritten", () => {
    const w = world({ settings: { env: { KEEL_DEVICE: "desktop" } }, local: { env: { KEEL_DEVICE: "stale" } } });
    const r = w.run("setup", "--skip", "memory,reflect", "--non-interactive");
    try {
      assert.equal(r.status, 0, r.stdout);
      assert.doesNotMatch(r.stdout, /Moved to settings\.json/);
      assert.equal(read(w.settings).env.KEEL_DEVICE, "desktop");
      assert.equal(read(w.local).env.KEEL_DEVICE, "stale", "a shadowed copy is left for the user to delete");
    } finally {
      w.done();
    }
  });

  test("--unset removes the key from both files, so nothing is left to move back", () => {
    const w = world({ settings: { env: { KEEL_MEMORY_HOME: "/a" } }, local: { env: { KEEL_MEMORY_HOME: "/b" } } });
    const r = w.run("setup", "--unset", "memory", "--skip", "reflect", "--non-interactive");
    try {
      assert.equal(r.status, 0, r.stdout);
      assert.deepEqual(read(w.settings).env, {});
      assert.deepEqual(read(w.local), {});
    } finally {
      w.done();
    }
  });
});

describe("doctor reports what a session sees, not what is on disk", () => {
  test("keys only in settings.local.json -> problem, named, with the setup fix", () => {
    const w = world({ settings: { env: {} }, local: { env: { KEEL_DEVICE: "work", KEEL_MEMORY_HOME: "/x/notes" } } });
    const r = w.run("doctor");
    try {
      assert.equal(r.status, 1, r.stdout);
      assert.doesNotMatch(r.stdout, /all good/);
      assert.match(r.stdout, /✖.*only in settings\.local\.json/);
      assert.match(r.stdout, /KEEL_DEVICE, KEEL_MEMORY_HOME/);
      assert.match(r.stdout, /fix: keel setup/);
    } finally {
      w.done();
    }
  });

  test("after setup moves them, the same machine is all good", () => {
    const w = world({ settings: { env: {} } });
    writeFileSync(w.local, JSON.stringify({ env: { KEEL_DEVICE: "work", KEEL_MEMORY_HOME: w.notes } }));
    try {
      assert.equal(w.run("setup", "--skip", "reflect", "--non-interactive").status, 0);
      const r = w.run("doctor");
      assert.equal(r.status, 0, r.stdout);
      assert.match(r.stdout, /all good/);
    } finally {
      w.done();
    }
  });

  test("a shadowed copy is noted, not counted as a problem", () => {
    const w = world({ settings: { env: {} }, local: { env: { KEEL_DEVICE: "stale" } } });
    writeFileSync(w.settings, JSON.stringify({ env: { KEEL_DEVICE: "desktop", KEEL_MEMORY_HOME: w.notes } }));
    const r = w.run("doctor");
    try {
      assert.equal(r.status, 0, r.stdout);
      assert.match(r.stdout, /unread copy in settings\.local\.json/);
    } finally {
      w.done();
    }
  });
});

describe("setup checks the Basic Memory registration instead of trusting add's output", () => {
  test("'already exists' with keel pointing elsewhere is reported, not called registered", () => {
    const w = world({ projects: [{ name: "keel", local_path: "/somewhere/else" }] });
    const r = w.run("setup", "--memory-home", w.notes, "--skip", "reflect", "--non-interactive");
    try {
      assert.doesNotMatch(r.stdout, /registered as Basic Memory project/);
      assert.match(r.stdout, /no Basic Memory project maps to this directory/);
    } finally {
      w.done();
    }
  });

  test("a project at the notes dir -> registered", () => {
    const w = world();
    const r = w.run("setup", "--memory-home", w.notes, "--skip", "reflect", "--non-interactive");
    try {
      assert.match(r.stdout, /registered as Basic Memory project "keel"/);
    } finally {
      w.done();
    }
  });
});
