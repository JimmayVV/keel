#!/usr/bin/env node
/**
 * commit-trailer-guard.mjs — block commit-message trailers you never want shipped.
 *
 * TRIGGER: PreToolUse on Bash.
 *
 * Agent harnesses append attribution trailers to commit messages by default
 * ("Co-Authored-By: …", "Generated with …", session URLs). Whether you want that
 * in your git history is a preference — but it is a preference that a model will
 * forget, because it is instruction text competing with a hundred other lines.
 *
 * A hook does not forget. This is the difference between "context" and
 * "configuration", and it is the reason a guard belongs here rather than in an
 * instruction file: exit 2 blocks the call regardless of what the model decided.
 *
 * Configure with KEEL_BLOCKED_TRAILERS (comma-separated substrings). Defaults
 * cover the common agent-attribution trailers. Matching is case-insensitive and
 * applies only to `git commit` invocations.
 *
 * KEEL_TRAILERS_OFF=1 disables this guard entirely. It exists because keel's
 * own principle — a layer you can't turn off is a layer you'll eventually
 * resent — applied to every guard except this one: setting the trailer list
 * empty restores the defaults, so before this switch, the only exit was
 * disabling the whole plugin. A cold audit caught the site claiming an
 * off-switch this guard didn't have; now it has one.
 *
 * Fails OPEN on any internal error: a guard that breaks committing is a guard
 * that gets uninstalled.
 */

import { readFileSync } from "node:fs";

const DEFAULT_BLOCKED = ["Co-Authored-By: Claude", "Generated with [Claude Code]", "Claude-Session:"];

function allow() {
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}

if (process.env.KEEL_TRAILERS_OFF === "1") allow();

let input;
try {
  input = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  allow();
}

if (String(input?.tool_name ?? "") !== "Bash") allow();

const command = String(input?.tool_input?.command ?? "");

// A trailer inside a heredoc redirected to a FILE is DATA — a script that
// merely contains `git commit -m "<trailer>"` as text is not committing it.
// But a heredoc piped into an INTERPRETER (`sh <<EOF … git commit … EOF`) is
// CODE and does commit. A third audit noted the first cut stripped both; the
// sibling security guard draws this line correctly, so this one now does too:
// strip a heredoc body only when its introducing line carries a `>`/`tee`
// file target. No redirect → treat as code, still scanned.
const stripped = command.replace(
  /([^\n]*)<<-?\s*(['"]?)(\w+)\2([\s\S]*?\n\s*)\3(?=\s|$)/g,
  (m, intro, _q, _tag, body) =>
    /(>|>>|\btee\b)/.test(intro) ? intro + " <<HEREDOC_DATA" : m,
);

// Only inspect actual commit invocations. `git log --grep=...` may mention a
// trailer without creating one. Flags between `git` and `commit` may carry a
// separate argument (`git -C some/dir commit`) — the earlier regex missed
// that form, so `-C` was a free bypass. Audit finding.
if (!/\bgit\b(\s+--?\S+(\s+[^-\s]\S*)?)*\s+commit\b/.test(stripped)) allow();

const blocked = (process.env.KEEL_BLOCKED_TRAILERS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const patterns = blocked.length ? blocked : DEFAULT_BLOCKED;

// Search the stripped form: heredoc bodies are data. Known limit, stated:
// `git commit -F file` and the bare editor path carry the message outside the
// command string and are not inspected here.
const hit = patterns.find((p) => stripped.toLowerCase().includes(p.toLowerCase()));

if (!hit) allow();

// exit 2 is the documented "block this tool call" signal; stderr reaches the model.
process.stderr.write(
  `keel: refusing this commit — the message contains a blocked trailer: "${hit}"\n` +
    `Rewrite the commit message without it, then retry.\n` +
    `(Configure via KEEL_BLOCKED_TRAILERS, or disable this guard with KEEL_TRAILERS_OFF=1.)\n`,
);
process.exit(2);
