/**
 * `keel join` contract tests. Run: node --test
 *
 * This is the command that moves the user's files, so the properties under test
 * are mostly about restraint:
 *
 *   - nothing lands in $HOME; defaults follow XDG
 *   - existing content is moved into the repo, never clobbered
 *   - a file stays a file (the first version of this made CLAUDE.md/CLAUDE.md)
 *   - re-running finishes the job rather than compounding it
 *   - machine-specific values go to settings.local.json, never the synced file
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync, lstatSync, readlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KEEL = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "keel");

/** A config dir with instructions and one project's memory, plus a transcript. */
function world() {
  const root = mkdtempSync(join(tmpdir(), "keel-join-"));
  const cfg = join(root, "cfg");
  const xdg = join(root, "xdg");
  mkdirSync(join(cfg, "projects", "-home-x-app", "memory"), { recursive: true });
  mkdirSync(xdg, { recursive: true });
  writeFileSync(join(cfg, "settings.json"), "{}");
  writeFileSync(join(cfg, "CLAUDE.md"), "my instructions\n");
  writeFileSync(join(cfg, "projects", "-home-x-app", "memory", "MEMORY.md"), "- [a](a.md) — a fact\n");
  writeFileSync(join(cfg, "projects", "-home-x-app", "sess.jsonl"), "{}\n");
  return { root, cfg, xdg, data: join(xdg, "keel", "data") };
}

const join_ = (w, ...args) =>
  spawnSync(process.execPath, [KEEL, "join", "--yes", "--device", "testbox", ...args], {
    encoding: "utf-8",
    env: { ...process.env, CLAUDE_CONFIG_DIR: w.cfg, XDG_DATA_HOME: w.xdg },
  });

describe("keel join", () => {
  test("defaults under XDG data, not $HOME", () => {
    const w = world();
    const r = join_(w);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(existsSync(join(w.data, ".git")), "repo must be created under XDG_DATA_HOME");
    rmSync(w.root, { recursive: true, force: true });
  });

  test("existing instructions are moved in, and stay a file", () => {
    const w = world();
    join_(w);
    const moved = join(w.data, "CLAUDE.md");
    assert.ok(statSync(moved).isFile(), "CLAUDE.md must not become a directory");
    assert.equal(readFileSync(moved, "utf-8"), "my instructions\n", "content must survive the move");
    assert.ok(lstatSync(join(w.cfg, "CLAUDE.md")).isSymbolicLink());
    assert.equal(readlinkSync(join(w.cfg, "CLAUDE.md")), moved);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("memory is tracked and transcripts are not", () => {
    const w = world();
    join_(w);
    spawnSync("git", ["-C", w.data, "add", "-A"], { encoding: "utf-8" });
    const staged = spawnSync("git", ["-C", w.data, "diff", "--cached", "--name-only"], { encoding: "utf-8" }).stdout;
    assert.match(staged, /projects\/-home-x-app\/memory\/MEMORY\.md/, "memory must be synced");
    assert.doesNotMatch(staged, /sess\.jsonl/, "transcripts must never be synced");
    rmSync(w.root, { recursive: true, force: true });
  });

  test("MEMORY.md gets a union merge driver", () => {
    const w = world();
    join_(w);
    assert.match(readFileSync(join(w.data, ".gitattributes"), "utf-8"), /memory\/MEMORY\.md merge=union/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("machine-specific values go to settings.local.json only", () => {
    const w = world();
    join_(w);
    const local = JSON.parse(readFileSync(join(w.cfg, "settings.local.json"), "utf-8"));
    assert.equal(local.env.KEEL_DEVICE, "testbox");
    assert.equal(local.env.KEEL_DATA_DIR, w.data);
    const shared = JSON.parse(readFileSync(join(w.cfg, "settings.json"), "utf-8"));
    assert.equal(shared.env?.KEEL_DEVICE, undefined, "device must never reach the synced file");
    assert.equal(shared.env?.KEEL_DATA_DIR, undefined, "an absolute path must never reach the synced file");
    rmSync(w.root, { recursive: true, force: true });
  });

  test("re-running is a no-op, not a nesting disaster", () => {
    const w = world();
    join_(w);
    const second = join_(w);
    assert.equal(second.status, 0);
    assert.match(second.stdout, /already linked/);
    assert.ok(!existsSync(join(w.data, "CLAUDE.md", "CLAUDE.md")), "must not nest on re-run");
    assert.ok(!existsSync(join(w.data, "projects", "projects")), "must not nest on re-run");
    rmSync(w.root, { recursive: true, force: true });
  });
});
