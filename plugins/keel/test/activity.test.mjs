/**
 * Activity capture and read-back contract tests. Run: node --test
 *
 * The properties that matter:
 *   1. real prompts are recorded; harness-internal synthetic prompts are not
 *   2. the reader only surfaces activity records, even though other keel
 *      logs (the security guard's) share the same directory
 *   3. per-device file naming holds for every writer in that directory,
 *      because sync safety depends on one-writer-per-file
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const hook = (name) => join(HERE, "..", "hooks", name);
const KEEL = join(HERE, "..", "bin", "keel");

function runHook(script, payload, env = {}) {
  return spawnSync(process.execPath, [hook(script)], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    env: { ...process.env, ...env },
  });
}

function readAll(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap((f) =>
      readFileSync(join(dir, f), "utf-8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l)),
    );
}

describe("activity-log capture", () => {
  test("a real prompt is recorded as an ask", () => {
    const dir = mkdtempSync(join(tmpdir(), "keel-act-"));
    runHook("activity-log.mjs", {
      hook_event_name: "UserPromptSubmit",
      prompt: "what is the status of this branch?",
      cwd: tmpdir(),
      session_id: "abc12345",
    }, { KEEL_ACTIVITY_DIR: dir });
    const rows = readAll(dir);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "ask");
    assert.match(rows[0].text, /status of this branch/);
    rmSync(dir, { recursive: true, force: true });
  });

  test("the harness's synthetic title prompt is not an ask", () => {
    const dir = mkdtempSync(join(tmpdir(), "keel-act-"));
    runHook("activity-log.mjs", {
      hook_event_name: "UserPromptSubmit",
      prompt:
        "You write concise thread titles for coding conversations. Return a JSON object with key: title. " +
        "Rules: - Title should summarize the user's request. User message: what is the status of this branch?",
      cwd: tmpdir(),
      session_id: "abc12345",
    }, { KEEL_ACTIVITY_DIR: dir });
    assert.equal(readAll(dir).length, 0, "synthetic prompt should be skipped");
    rmSync(dir, { recursive: true, force: true });
  });

  test("short acknowledgements are skipped", () => {
    const dir = mkdtempSync(join(tmpdir(), "keel-act-"));
    runHook("activity-log.mjs", {
      hook_event_name: "UserPromptSubmit",
      prompt: "ok",
      cwd: tmpdir(),
    }, { KEEL_ACTIVITY_DIR: dir });
    assert.equal(readAll(dir).length, 0);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("keel log read-back", () => {
  test("security records in the same directory do not surface as activity", () => {
    const dir = mkdtempSync(join(tmpdir(), "keel-act-"));
    const now = new Date().toISOString();
    writeFileSync(
      join(dir, "2026-07-testbox.jsonl"),
      JSON.stringify({ kind: "ask", ts: now, session: "s1", device: "testbox", cwd: "/x", repo: "demo", branch: "main", worktree: null, text: "a real question" }) + "\n",
    );
    writeFileSync(
      join(dir, "security-2026-07-testbox.jsonl"),
      JSON.stringify({ ts: now, verdict: "confirm", reason: "write to protected path", tool: "Write", subject: "/x/.ssh/config", session: "s1" }) + "\n",
    );
    const r = spawnSync(process.execPath, [KEEL, "log", "--days", "1", "--json"], {
      encoding: "utf-8",
      env: { ...process.env, KEEL_ACTIVITY_DIR: dir },
    });
    const out = JSON.parse(r.stdout);
    assert.equal(out.counts.records, 1, "only the activity record should count");
    assert.ok(out.records.every((rec) => rec.kind), "no kind-less ghost records");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("security guard audit file naming", () => {
  test("the security log is device-scoped like the activity log", () => {
    const dir = mkdtempSync(join(tmpdir(), "keel-act-"));
    runHook("security-guard.mjs", {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "sudo systemctl restart nginx" },
      session_id: "abc12345",
    }, { KEEL_ACTIVITY_DIR: dir, KEEL_DEVICE: "TestBox_01" });
    const files = readdirSync(dir).filter((f) => f.startsWith("security-"));
    assert.equal(files.length, 1, "sudo should be recorded");
    assert.match(files[0], /^security-\d{4}-\d{2}-testbox-01\.jsonl$/);
    rmSync(dir, { recursive: true, force: true });
  });
});

/**
 * The measurement behind this: 261 sessions reached SessionEnd on one machine
 * over two days, and 2 had ever seen a prompt. The rest were subagents,
 * worktree agents, aborted starts, and nested `claude` invocations — every one
 * writing an `end` record about nothing.
 *
 * It matters more than log tidiness. A retain hook on the same event and the
 * same 260 empty sessions pays a fixed ~3.4k-token extraction prompt each time,
 * which measured out at roughly thirty times the cost of the real work. This
 * gate is the difference.
 */
describe("SessionEnd is gated on the session having said anything", () => {
  const session = "abc12345";

  function endHook(dir, id = session) {
    return runHook("activity-log.mjs", {
      hook_event_name: "SessionEnd",
      reason: "other",
      cwd: tmpdir(),
      session_id: id,
    }, { KEEL_ACTIVITY_DIR: dir, KEEL_DEVICE: "testbox" });
  }

  test("a session that never carried a prompt writes no end record", () => {
    const dir = mkdtempSync(join(tmpdir(), "keel-act-"));
    endHook(dir);
    assert.equal(readAll(dir).length, 0, "a subagent exit is not activity");
    rmSync(dir, { recursive: true, force: true });
  });

  test("a session that carried a prompt still closes normally", () => {
    const dir = mkdtempSync(join(tmpdir(), "keel-act-"));
    runHook("activity-log.mjs", {
      hook_event_name: "UserPromptSubmit",
      prompt: "what is the status of this branch?",
      cwd: tmpdir(),
      session_id: session,
    }, { KEEL_ACTIVITY_DIR: dir, KEEL_DEVICE: "testbox" });
    endHook(dir);
    const kinds = readAll(dir).map((r) => r.kind);
    assert.deepEqual(kinds, ["ask", "end"], "a real session must still be closed");
    rmSync(dir, { recursive: true, force: true });
  });

  test("one session's activity does not license another's end record", () => {
    const dir = mkdtempSync(join(tmpdir(), "keel-act-"));
    runHook("activity-log.mjs", {
      hook_event_name: "UserPromptSubmit",
      prompt: "a real question from the parent session",
      cwd: tmpdir(),
      session_id: session,
    }, { KEEL_ACTIVITY_DIR: dir, KEEL_DEVICE: "testbox" });
    endHook(dir, "def67890");   // a subagent exiting alongside a live session
    const ends = readAll(dir).filter((r) => r.kind === "end");
    assert.equal(ends.length, 0, "the gate must be per-session, not per-file");
    rmSync(dir, { recursive: true, force: true });
  });

  test("an assistant turn alone is enough to close the session", () => {
    const dir = mkdtempSync(join(tmpdir(), "keel-act-"));
    runHook("activity-log.mjs", {
      hook_event_name: "Stop",
      last_assistant_message: "x".repeat(60),
      cwd: tmpdir(),
      session_id: session,
    }, { KEEL_ACTIVITY_DIR: dir, KEEL_DEVICE: "testbox" });
    endHook(dir);
    assert.ok(readAll(dir).some((r) => r.kind === "end"));
    rmSync(dir, { recursive: true, force: true });
  });
});
