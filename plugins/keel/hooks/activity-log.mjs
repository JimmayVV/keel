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
import { homedir } from "node:os";
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

function write(record) {
  const dir = activityDir();
  mkdirSync(dir, { recursive: true });
  const stamp = new Date();
  const month = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}`;
  appendFileSync(join(dir, `${month}.jsonl`), JSON.stringify(record) + "\n");
}

const base = () => {
  const ctx = repoContext(cwd);
  return {
    ts: new Date().toISOString(),
    session: String(input?.session_id ?? "").slice(0, 8),
    cwd,
    ...ctx,
  };
};

try {
  switch (event) {
    case "UserPromptSubmit": {
      const prompt = clip(input?.prompt, 1200);
      // Skip acknowledgements — they are noise in a weekly summary.
      if (prompt.length < 8) break;
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
      write({ kind: "end", ...base(), reason: String(input?.reason ?? "other") });
      break;
    }
  }
} catch {
  /* logging must never break a session */
}

done();
