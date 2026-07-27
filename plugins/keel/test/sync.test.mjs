/**
 * Sync hook contract tests. Run: node --test
 *
 * The properties that matter, in order of how badly they'd hurt:
 *
 *   1. Off unless asked. keel must never touch a git repository the user did
 *      not nominate. Absent KEEL_DATA_DIR this hook is a no-op.
 *   2. Offline is not an error condition. An unreachable remote must cost
 *      bounded seconds and let the session proceed.
 *   3. Failure is recorded, never silent. Every failed phase lands in
 *      sync-status.json where doctor can find it.
 *   4. Memory actually propagates. A write on one clone reaches the other.
 *
 * Hermetic: a bare repo on disk stands in for the remote. No network.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "..", "hooks", "sync.mjs");

const git = (cwd, ...args) =>
  spawnSync("git", ["-C", cwd, ...args], { encoding: "utf-8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });

/** A bare "remote" plus two clones of it, all on local disk. */
function network() {
  const root = mkdtempSync(join(tmpdir(), "keel-sync-"));
  const remote = join(root, "remote.git");
  spawnSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  const clone = (name) => {
    const p = join(root, name);
    spawnSync("git", ["clone", "-q", remote, p]);
    git(p, "config", "user.email", "t@example.com");
    git(p, "config", "user.name", "Test");
    return p;
  };
  const a = clone("a");
  writeFileSync(join(a, "seed.md"), "seed\n");
  git(a, "add", "-A");
  git(a, "commit", "-qm", "seed");
  git(a, "branch", "-M", "main");
  git(a, "push", "-q", "-u", "origin", "main");
  const b = clone("b");
  return { root, remote, a, b };
}

function fire(event, repo, env = {}) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: event }),
    encoding: "utf-8",
    env: { ...process.env, KEEL_DATA_DIR: repo ?? "", ...env },
  });
}

/** SessionEnd detaches, so give the child a moment to finish its push. */
const settle = () => spawnSync("sleep", ["2"]);

describe("sync is opt-in", () => {
  test("no KEEL_DATA_DIR -> no-op, session continues", () => {
    const r = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ hook_event_name: "SessionStart" }),
      encoding: "utf-8",
      env: { ...process.env, KEEL_DATA_DIR: "" },
    });
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).continue, true);
  });

  test("a path that is not a git repo is ignored", () => {
    const dir = mkdtempSync(join(tmpdir(), "keel-nogit-"));
    const r = fire("SessionStart", dir);
    assert.equal(r.status, 0);
    assert.ok(!existsSync(join(dir, "sync-status.json")), "must not write into a repo it does not own");
    rmSync(dir, { recursive: true, force: true });
  });

  test("KEEL_SYNC_OFF=1 disables it", () => {
    const n = network();
    const r = fire("SessionStart", n.b, { KEEL_SYNC_OFF: "1" });
    assert.equal(r.status, 0);
    assert.ok(!existsSync(join(n.b, "sync-status.json")));
    rmSync(n.root, { recursive: true, force: true });
  });
});

describe("memory propagates between machines", () => {
  test("SessionEnd on one clone reaches the other's SessionStart", () => {
    const n = network();
    writeFileSync(join(n.a, "new-fact.md"), "learned something\n");
    assert.equal(fire("SessionEnd", n.a).status, 0);
    settle();

    assert.equal(fire("SessionStart", n.b).status, 0);
    assert.ok(existsSync(join(n.b, "new-fact.md")), "the other machine must see the new memory");
    const st = JSON.parse(readFileSync(join(n.b, "sync-status.json"), "utf-8"));
    assert.equal(st.ok, true);
    assert.equal(st.phase, "pull");
    rmSync(n.root, { recursive: true, force: true });
  });

  test("SessionEnd with nothing to commit still succeeds", () => {
    const n = network();
    assert.equal(fire("SessionEnd", n.a).status, 0);
    settle();
    rmSync(n.root, { recursive: true, force: true });
  });
});

describe("offline degrades gracefully", () => {
  test("an unreachable remote is bounded and recorded, not fatal", () => {
    const n = network();
    git(n.b, "remote", "set-url", "origin", "https://10.255.255.1/nope.git");
    const started = Date.now();
    const r = fire("SessionStart", n.b, { KEEL_SYNC_TIMEOUT_S: "3" });
    const elapsed = Date.now() - started;

    assert.equal(r.status, 0, "an unreachable remote must never block the session");
    assert.equal(JSON.parse(r.stdout).continue, true);
    assert.ok(elapsed < 15_000, `pull must be bounded, took ${elapsed}ms`);

    const st = JSON.parse(readFileSync(join(n.b, "sync-status.json"), "utf-8"));
    assert.equal(st.ok, false, "failure must be recorded for doctor to find");
    assert.equal(st.phase, "pull");
    rmSync(n.root, { recursive: true, force: true });
  });
});

describe("pulls are rate limited", () => {
  test("a second SessionStart inside the interval does not hit the network", () => {
    const n = network();
    fire("SessionStart", n.b); // establishes the stamp
    git(n.b, "remote", "set-url", "origin", "https://10.255.255.1/nope.git");

    const started = Date.now();
    const r = fire("SessionStart", n.b, { KEEL_SYNC_TIMEOUT_S: "30" });
    const elapsed = Date.now() - started;

    assert.equal(r.status, 0);
    assert.ok(elapsed < 3000, `rate-limited start should be instant, took ${elapsed}ms`);
    rmSync(n.root, { recursive: true, force: true });
  });
});
