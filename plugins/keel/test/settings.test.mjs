/**
 * `keel settings` contract tests. Run: node --test
 *
 * This command edits a key keel does not own, so the tests are mostly about
 * restraint:
 *
 *   - --list explains and changes nothing
 *   - applying APPENDS; it never removes, reorders, or rewrites a user's rules
 *   - unrelated settings survive untouched
 *   - re-running is a no-op, not a duplicator
 *   - every rule carries a rationale and a docs link (the whole point of the
 *     command is that you can read what you're accepting)
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KEEL = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "keel");

function world(settings = {}) {
  const root = mkdtempSync(join(tmpdir(), "keel-set-"));
  const cfg = join(root, "cfg");
  mkdirSync(cfg);
  writeFileSync(join(cfg, "settings.json"), JSON.stringify(settings));
  return { root, cfg, file: join(cfg, "settings.json") };
}

const run = (w, ...args) =>
  spawnSync(process.execPath, [KEEL, "settings", ...args], {
    encoding: "utf-8",
    env: { ...process.env, CLAUDE_CONFIG_DIR: w.cfg },
  });

const read = (w) => JSON.parse(readFileSync(w.file, "utf-8"));

describe("keel settings --list", () => {
  test("explains without changing anything", () => {
    const w = world({ model: "opus" });
    const r = run(w, "--list");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(read(w), { model: "opus" }, "--list must not write");
    rmSync(w.root, { recursive: true, force: true });
  });

  test("every rule carries a rationale and a docs link", () => {
    const w = world();
    const out = run(w, "--list").stdout;
    // One docs URL per rule group, and prose above each.
    const links = out.match(/docs: https:\/\/\S+/g) ?? [];
    assert.ok(links.length >= 3, `expected a docs link per rule, got ${links.length}`);
    assert.match(out, /would add to permissions\.(deny|ask)/);
    rmSync(w.root, { recursive: true, force: true });
  });
});

describe("applying rules", () => {
  test("appends without disturbing existing settings", () => {
    const w = world({
      model: "opus",
      permissions: { deny: ["Read(./.env)"], allow: ["Bash(npm run test)"] },
    });
    assert.equal(run(w, "--yes").status, 0);

    const after = read(w);
    assert.equal(after.model, "opus", "unrelated keys must survive");
    assert.deepEqual(after.permissions.allow, ["Bash(npm run test)"], "allow must be untouched");
    assert.equal(after.permissions.deny[0], "Read(./.env)", "existing rules keep their position");
    assert.ok(after.permissions.deny.includes("Read(~/.ssh/**)"));
    assert.ok(after.permissions.ask.includes("Bash(git push --force*)"));
    rmSync(w.root, { recursive: true, force: true });
  });

  test("does not duplicate a rule the user already has", () => {
    const w = world({ permissions: { deny: ["Read(./.env)"] } });
    run(w, "--yes");
    const deny = read(w).permissions.deny;
    assert.equal(deny.filter((d) => d === "Read(./.env)").length, 1, "must not re-add an existing rule");
    rmSync(w.root, { recursive: true, force: true });
  });

  test("re-running is a no-op", () => {
    const w = world();
    run(w, "--yes");
    const first = JSON.stringify(read(w));
    const second = run(w, "--yes");
    assert.equal(second.status, 0);
    assert.match(second.stdout, /all recommended rules are in place/);
    assert.equal(JSON.stringify(read(w)), first, "second run must change nothing");
    rmSync(w.root, { recursive: true, force: true });
  });

  test("backs up the previous file before writing", () => {
    const w = world({ model: "opus" });
    run(w, "--yes");
    const backup = `${w.file}.keel-backup`;
    assert.ok(existsSync(backup), "a backup must exist");
    assert.deepEqual(JSON.parse(readFileSync(backup, "utf-8")), { model: "opus" });
    rmSync(w.root, { recursive: true, force: true });
  });

  test("a malformed settings.json is refused, not clobbered", () => {
    const w = world();
    writeFileSync(w.file, "{ not json");
    const r = run(w, "--yes");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not valid JSON/);
    assert.equal(readFileSync(w.file, "utf-8"), "{ not json", "must leave the file alone");
    rmSync(w.root, { recursive: true, force: true });
  });
});
