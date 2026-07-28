#!/usr/bin/env node
/**
 * activity-log.mjs — append-only record of what you actually did.
 *
 * THE PROBLEM THIS SOLVES
 * `git log` records artifacts, not work. A senior engineer's most valuable hours
 * frequently produce no commit: evaluating three libraries and picking one,
 * reviewing someone else's PR, reading an unfamiliar subsystem, or investigating
 * something and concluding "don't do this." A weekly summary built only from
 * commits systematically under-reports exactly the work that makes you senior.
 *
 * WHY NOT PARSE THE TRANSCRIPT
 * Session transcripts live in an undocumented JSONL format that Anthropic
 * changes (one release cut transcript size ~79x). Anything built on that breaks
 * silently. So this captures at the *boundary* instead, using documented hook
 * payloads — and the docs explicitly recommend it: the Stop event supplies
 * `last_assistant_message` with the note "Use this instead of reading the
 * transcript file, which may lag asynchronously."
 *
 *   UserPromptSubmit → `prompt`                 what you asked
 *   Stop             → `last_assistant_message` what was concluded
 *   SessionEnd       → `reason`                 close the record
 *
 * DIVISION OF LABOUR: HOOKS CAPTURE, SKILLS INTERPRET
 * There is deliberately no model call in here. Hooks must be fast (the
 * UserPromptSubmit event drops tool timeouts to 30s) and must never fail your
 * session. So this writes bounded raw text and stops thinking. Turning that into
 * "here's what you did last week, grouped by project" is the job of a skill that
 * runs in-session — which costs nothing extra, because your subscription already
 * covers the model doing it.
 *
 * PRIVACY
 * Writes only to KEEL_ACTIVITY_DIR (default: <claude-config-dir>/keel/activity).
 * Because the default is relative to the Claude config directory, two networks on
 * one machine get separate logs automatically. Nothing is transmitted anywhere.
 * Set KEEL_ACTIVITY_OFF=1 to disable without uninstalling.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/** Never take a session down. Any failure is a silent no-op. */
function done() {
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}

if (process.env.KEEL_ACTIVITY_OFF === "1") done();

let input;
try {
  input = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  done();
}

const event = String(input?.hook_event_name ?? "");
const cwd = String(input?.cwd ?? process.cwd());

function activityDir() {
  const override = process.env.KEEL_ACTIVITY_DIR?.trim();
  if (override) return override;
  const cfg = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
  return join(cfg, "keel", "activity");
}

/**
 * Repo identity, so a week's work can be grouped by project rather than by
 * directory. Worktrees matter here: `--show-toplevel` gives the worktree path
 * while `--git-common-dir` resolves to the shared repo, so several worktrees of
 * one project group together instead of looking like separate work.
 */
function repoContext(dir) {
  const git = (args) => {
    try {
      return execFileSync("git", ["-C", dir, ...args], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2000,
      }).trim();
    } catch {
      return "";
    }
  };
  const top = git(["rev-parse", "--show-toplevel"]);
  if (!top) return { repo: null, branch: null, worktree: null };

  const common = git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  // A linked worktree's common dir sits inside the primary checkout, so its
  // parent names the project; a primary checkout's common dir is just ".git".
  const project = common ? common.replace(/\/?\.git\/?$/, "") || top : top;

  return {
    repo: project.split("/").filter(Boolean).pop() ?? null,
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]) || null,
    worktree: top !== project ? top.split("/").filter(Boolean).pop() : null,
  };
}

/** Bounded, single-line, no control characters. This is a log, not a transcript. */
function clip(text, max) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

/**
 * Log files are scoped by month AND by device.
 *
 * This matters the moment you sync the log between machines. Two machines
 * appending to one `2026-07.jsonl` conflict in git on every single sync, and the
 * conflict is unresolvable in any useful sense — both sides are correct, they are
 * just interleaved. Per-device files never conflict, because only one writer ever
 * touches a given file. Readers glob `*.jsonl`, so nothing downstream changes.
 */
function logFile(dir) {
  const stamp = new Date();
  const month = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}`;
  const device = (process.env.KEEL_DEVICE?.trim() || hostname() || "unknown")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "unknown";
  return join(dir, `${month}-${device}.jsonl`);
}

function write(record) {
  const dir = activityDir();
  mkdirSync(dir, { recursive: true });
  appendFileSync(logFile(dir), JSON.stringify(record) + "\n");
}

const base = () => {
  const ctx = repoContext(cwd);
  return {
    ts: new Date().toISOString(),
    session: String(input?.session_id ?? "").slice(0, 8),
    device: (process.env.KEEL_DEVICE?.trim() || hostname() || "unknown").slice(0, 32),
    cwd,
    ...ctx,
  };
};

/**
 * Did this session ever carry a prompt?
 *
 * THE MEASUREMENT THIS EXISTS FOR
 * On one machine over two days: 261 sessions reached SessionEnd, and 2 of them
 * had ever seen a user prompt. The other 259 are subagents, worktree agents,
 * aborted starts, and any nested `claude` a tool spawned. Every one of them was
 * writing an `end` record about nothing.
 *
 * THIS IS ALSO THE RE-ENTRANCY GUARD
 * A retain hook on SessionEnd has the same shape and a much worse failure mode.
 * Hindsight's own claude_code provider documents the hazard from the other side:
 * it redirects CLAUDE_CONFIG_DIR for the `claude` it spawns specifically so
 * "operator-installed plugins and their Stop hooks do not fire inside our
 * LLM-call subprocesses. Without this, retain/reflect/consolidation LLM calls
 * would trigger a Stop-hook retain of the subprocess." Retain triggering retain.
 *
 * The tempting fix is to detect nesting — walk the process tree, sniff for a
 * parent `claude`. That is an undocumented surface and keel does not read those.
 * It is also unnecessary: a subprocess spawned to perform extraction has no user
 * prompt, so gating on content catches it without knowing it was nested. One
 * mechanism, both problems, nothing undocumented.
 *
 * Costs nothing to be wrong in the safe direction: a false negative loses one
 * `end` record, which closes nothing anybody reads.
 */
function sessionHasContent(sessionId) {
  const id = String(sessionId ?? "").slice(0, 8);
  if (!id) return false;
  try {
    // Current month only. A session spanning a month boundary loses its `end`
    // record, which is cheaper than reading every file on every subagent exit.
    const raw = readFileSync(logFile(activityDir()), "utf-8");
    for (const line of raw.split("\n")) {
      // Cheap reject first — most lines belong to other sessions.
      if (!line.includes(id)) continue;
      try {
        const r = JSON.parse(line);
        if (r.session === id && (r.kind === "ask" || r.kind === "said")) return true;
      } catch { /* a torn line is not evidence either way */ }
    }
  } catch { /* no log yet — nothing has been said by definition */ }
  return false;
}

try {
  switch (event) {
    case "UserPromptSubmit": {
      const prompt = clip(input?.prompt, 1200);
      // Skip acknowledgements — they are noise in a weekly summary.
      if (prompt.length < 8) break;
      // The harness generates thread titles by firing a synthetic prompt
      // through this same event; it embeds the user's words, so keeping it
      // would double-count every first message as two asks.
      if (/^You write concise thread titles for coding conversations\./.test(prompt)) break;
      write({ kind: "ask", ...base(), text: prompt });
      break;
    }
    case "Stop": {
      // Bounded excerpt only. The skill that reads this has a model; this doesn't.
      const said = clip(input?.last_assistant_message, 2000);
      if (said.length < 40) break;
      write({ kind: "said", ...base(), text: said });
      break;
    }
    case "SessionEnd": {
      // Nothing said, nothing to close. See sessionHasContent above for why
      // this is the guard a retain hook needs, not just log hygiene.
      if (!sessionHasContent(input?.session_id)) break;
      write({ kind: "end", ...base(), reason: String(input?.reason ?? "other") });
      break;
    }
  }
} catch {
  /* logging must never break a session */
}

done();
