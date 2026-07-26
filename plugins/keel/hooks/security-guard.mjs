#!/usr/bin/env node
/**
 * security-guard.mjs — block catastrophe, confirm exfiltration, log elevation.
 *
 * TRIGGER: PreToolUse on Bash, Edit, Write, Read.
 *
 * WHAT THIS COVERS THAT `permissions.deny` CANNOT
 * The native deny list matches command *prefixes*, which is perfect for
 * `Bash(rm -rf /:*)` and useless for the rules that matter most here: "curl with
 * a credential file as its payload", "cat a secret and pipe it to the network",
 * "scp an ssh key to a remote host". Those are shapes, not prefixes, and they are
 * the whole reason this hook exists. Keep both — the deny list is a cheaper,
 * earlier stop for the cases it can express.
 *
 * THE HEREDOC DISTINCTION (the fix this port exists for)
 * Scanning the raw command string means any command that *writes a file
 * containing* dangerous-looking text gets blocked. Writing a Dockerfile with
 * `rm -rf /var/lib/apt/lists/*` in it is not a destructive command, but a naive
 * matcher cannot tell. Stripping heredocs wholesale is not the answer either,
 * because `bash <<EOF ... EOF` genuinely executes.
 *
 * The rule:
 *   heredoc redirected to a FILE      → data, not scanned  (cat > x <<EOF)
 *   heredoc piped into an INTERPRETER → code, still scanned (bash <<EOF, sh <<'EOF')
 *
 * FAIL MODE: closed. If the policy cannot be read or a pattern will not compile,
 * Bash is blocked with an actionable message rather than silently allowed. A
 * security control that fails open is decoration. The policy ships inside this
 * plugin so "missing file" should be impossible in normal operation, and
 * KEEL_GUARD_OFF=1 is the deliberate escape hatch.
 *
 * Derived from PAI's SecurityValidator (Daniel Miessler's PAI, MIT).
 */

import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function allow() {
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}

/** Hard stop. Exit 2 is the documented block signal; stderr reaches the model. */
function block(reason, detail) {
  process.stderr.write(`[keel] BLOCKED: ${reason}\n${detail ? `\n${detail}\n` : ""}`);
  process.exit(2);
}

/** Hand the decision to the human. Proven shape on current Claude Code builds. */
function ask(message) {
  process.stdout.write(JSON.stringify({ decision: "ask", message }));
  process.exit(0);
}

if (process.env.KEEL_GUARD_OFF === "1") allow();

let input;
try {
  input = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  allow(); // no parseable event — nothing to judge
}

const tool = String(input?.tool_name ?? "");
const ti = input?.tool_input ?? {};

// ── policy ──────────────────────────────────────────────────────────────────
let policy;
try {
  policy = JSON.parse(readFileSync(join(HERE, "..", "policy", "security.json"), "utf-8"));
} catch (e) {
  if (tool === "Bash") {
    block(
      "security policy could not be loaded — failing closed",
      `Expected: ${resolve(HERE, "..", "policy", "security.json")}\n` +
        `Error: ${String(e?.message ?? e)}\n` +
        `Reinstall the plugin, or set KEEL_GUARD_OFF=1 to proceed deliberately without a guard.`,
    );
  }
  allow();
}

/** Compile once, fail closed on a bad pattern rather than skipping it silently. */
function compile(rules) {
  return (rules ?? []).map((r) => {
    try {
      return { re: new RegExp(r.pattern, "i"), reason: r.reason };
    } catch (e) {
      if (tool === "Bash") {
        block(
          "security policy contains an invalid pattern — failing closed",
          `Pattern: ${r.pattern}\nError: ${String(e?.message ?? e)}`,
        );
      }
      return null;
    }
  }).filter(Boolean);
}

// ── heredoc separation ──────────────────────────────────────────────────────

/**
 * Split a command into the part that executes and the parts that are merely
 * written. Returns the scannable text: everything except heredoc bodies whose
 * redirect target is a file.
 *
 * Deliberately conservative — when the target of a heredoc cannot be determined,
 * the body stays in the scanned text. Missing a false positive costs an
 * inconvenience; missing a real command costs the whole point of the hook.
 */
function scannableText(command) {
  // <<TAG / <<'TAG' / <<"TAG" / <<-TAG, capturing what precedes it on the line.
  const opener = /(^|[\n;&|])([^\n]*?)<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\4/g;
  let out = "";
  let cursor = 0;
  let m;

  while ((m = opener.exec(command)) !== null) {
    const [full, lead, prefix, dash, , tag] = m;
    const openerEnd = m.index + full.length;

    // Find the terminator line for this heredoc.
    const termRe = new RegExp(`\\n${dash ? "[ \\t]*" : ""}${tag}[ \\t]*(?=\\n|$)`);
    const rest = command.slice(openerEnd);
    const termMatch = termRe.exec(rest);
    if (!termMatch) break; // unterminated — leave the remainder scannable

    const bodyStart = openerEnd;
    const bodyEnd = openerEnd + termMatch.index;
    const afterTerm = bodyEnd + termMatch[0].length;

    // Is this heredoc feeding an interpreter, or writing a file?
    // A pipe anywhere in the prefix, or an interpreter as the command, means code.
    const feedsInterpreter =
      /\|/.test(prefix) ||
      /(^|\s|\/)(sh|bash|zsh|ksh|dash|python[0-9.]*|perl|ruby|node|deno|bun|env)\b[^>]*$/i.test(prefix);
    // A redirect to a path (or `cat`/`tee` with one) means data.
    const writesFile = /(>{1,2}\s*\S+|(^|\s)(cat|tee)\b[^|]*>{1,2}\s*\S+)/.test(prefix);

    out += command.slice(cursor, bodyStart);
    if (feedsInterpreter || !writesFile) {
      out += command.slice(bodyStart, bodyEnd); // keep: code, or target unknown
    } else {
      out += "\n"; // drop: it's file content
    }
    out += command.slice(bodyEnd, afterTerm);
    cursor = afterTerm;
    opener.lastIndex = afterTerm;
  }

  return out + command.slice(cursor);
}

/** `FOO=bar BAZ=qux rm -rf /` must still match the rm rule. */
function stripEnvPrefix(cmd) {
  return cmd.replace(/^\s*(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/, "");
}

// ── audit trail ─────────────────────────────────────────────────────────────
function record(verdict, reason, subject) {
  try {
    const dir =
      process.env.KEEL_ACTIVITY_DIR?.trim() ||
      join(process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude"), "keel", "activity");
    mkdirSync(dir, { recursive: true });
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    // Device-scoped like the activity log: syncing this directory only stays
    // conflict-free if no two machines ever write the same file.
    const device = (process.env.KEEL_DEVICE?.trim() || hostname() || "unknown")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "unknown";
    appendFileSync(
      join(dir, `security-${month}-${device}.jsonl`),
      JSON.stringify({
        ts: now.toISOString(),
        verdict, reason, tool,
        subject: String(subject ?? "").slice(0, 400),
        session: String(input?.session_id ?? "").slice(0, 8),
      }) + "\n",
    );
  } catch { /* never let auditing break enforcement */ }
}

// ── path rules (Edit / Write / Read) ────────────────────────────────────────
function globToRe(glob) {
  const expanded = glob.replace(/^~(?=\/|$)/, homedir());
  const escaped = expanded.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

function checkPath(filePath) {
  const abs = resolve(String(filePath).replace(/^~(?=\/|$)/, homedir()));
  const p = policy.paths ?? {};
  const hit = (list) => (list ?? []).some((g) => globToRe(g).test(abs));

  if (hit(p.zeroAccess)) {
    record("blocked", "zero-access path", abs);
    block("zero-access path", abs);
  }
  if (tool === "Read") return; // reads past zeroAccess are fine
  if (hit(p.readOnly)) {
    record("blocked", "read-only path", abs);
    block("read-only path", abs);
  }
  if (hit(p.confirmWrite)) {
    record("confirm", "write to protected path", abs);
    ask(`[keel] Writing to a protected path requires confirmation:\n\n  ${abs}\n\nProceed?`);
  }
}

// ── dispatch ────────────────────────────────────────────────────────────────
if (tool === "Bash") {
  const raw = String(ti.command ?? "");
  const scanned = stripEnvPrefix(scannableText(raw));

  for (const r of compile(policy.bash?.blocked)) {
    if (r.re.test(scanned)) {
      record("blocked", r.reason, raw);
      block(r.reason, `Command: ${raw.slice(0, 300)}`);
    }
  }
  for (const r of compile(policy.bash?.confirm)) {
    if (r.re.test(scanned)) {
      record("confirm", r.reason, raw);
      ask(`[keel] ${r.reason}\n\nCommand: ${raw.slice(0, 300)}\n\nProceed?`);
    }
  }
  for (const r of compile(policy.bash?.alert)) {
    if (r.re.test(scanned)) record("alert", r.reason, raw);
  }
} else if (tool === "Edit" || tool === "Write" || tool === "Read") {
  if (ti.file_path) checkPath(ti.file_path);
}

allow();
