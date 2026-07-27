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

import { readFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
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

// A file that parses is not the same as a policy that means anything. A policy
// missing its `bash` section permits every command the guard exists to stop, and
// a null one throws inside checkPath. Damaged shape gets the same treatment as a
// damaged file: fail closed for Bash, which is the tier that can destroy things.
if (!policy || typeof policy !== "object" || !policy.bash || typeof policy.bash !== "object") {
  if (tool === "Bash") {
    block(
      "security policy is malformed — failing closed",
      `Expected an object with a "bash" section.\n` +
        `Path: ${resolve(HERE, "..", "policy", "security.json")}\n` +
        `Reinstall the plugin, or set KEEL_GUARD_OFF=1 to proceed deliberately without a guard.`,
    );
  }
  allow();
}

/**
 * Your policy, layered over the shipped one.
 *
 * The shipped policy lives inside the plugin cache, which `keel update` replaces
 * wholesale — so editing it there is not a real escape hatch, it's a change that
 * disappears the next time keel updates itself. This file lives outside the
 * cache and survives.
 *
 * Three things it can do:
 *   bash.allow    patterns that EXEMPT a command from every shipped block rule.
 *                 Checked first and wins outright. This is the control you keep
 *                 when a shipped rule is wrong for your machine.
 *   bash.blocked  additional rules, appended to the shipped ones.
 *   bash.confirm  likewise.
 *
 * A malformed overlay fails CLOSED for Bash rather than being ignored. Silently
 * dropping it is the worse failure: you'd believe a rule you wrote is in force
 * when it isn't, which is exactly the false confidence a guard must never sell.
 */
const USER_POLICY =
  process.env.KEEL_POLICY_FILE?.trim() ||
  join(process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config"), "keel", "policy.json");

let overlay = null;
if (existsSync(USER_POLICY)) {
  try {
    overlay = JSON.parse(readFileSync(USER_POLICY, "utf-8"));
    if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) throw new Error("not an object");
  } catch (e) {
    if (tool === "Bash") {
      block(
        "your policy overlay could not be read — failing closed",
        `File: ${USER_POLICY}\nError: ${String(e?.message ?? e)}\n` +
          `Fix the JSON, or move the file aside to fall back to the shipped policy.`,
      );
    }
    allow();
  }
}

if (overlay) {
  const merge = (section, key) => [
    ...(policy[section]?.[key] ?? []),
    ...(overlay[section]?.[key] ?? []),
  ];
  policy = {
    ...policy,
    bash: {
      ...policy.bash,
      blocked: merge("bash", "blocked"),
      confirm: merge("bash", "confirm"),
      alert: merge("bash", "alert"),
      allow: overlay.bash?.allow ?? [],
    },
    paths: {
      ...(policy.paths ?? {}),
      zeroAccess: merge("paths", "zeroAccess"),
      readOnly: merge("paths", "readOnly"),
      confirmWrite: merge("paths", "confirmWrite"),
      noDelete: merge("paths", "noDelete"),
    },
  };
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

/**
 * A commit message that *mentions* a destructive command is prose, not a command.
 *
 * `git commit -m "don't run rm -rf / on prod"` was blocked before this — the whole
 * Bash string is scanned, and `-m` carries text. Same distinction the heredoc
 * logic draws (writing about a command versus running one), different shape, so
 * the heredoc rules never saw it. It blocked this file's own commit message.
 *
 * Deliberately narrow, because this is a hole if it is wrong:
 *   - only `git` and `gh`, the two commands whose message flags definitionally
 *     carry prose rather than anything executable
 *   - only a fully quoted payload, matched to its own closing quote, so
 *     `git commit -m "msg" && rm -rf /` keeps the second half scannable
 *   - never when the payload contains $( ), backticks, or ${ }, because a message
 *     built by command substitution really does execute
 */
function stripMessagePayloads(cmd) {
  const re =
    /\b(?:git|gh)\b[^\n]*?\s(?:-m|--message|-b|--body|-t|--title|--body-file|-d|--description)(?:=|\s+)(['"])((?:(?!\1)[\s\S])*)\1/g;
  return cmd.replace(re, (full, _q, payload) => {
    if (!payload || /\$\(|`|\$\{/.test(payload)) return full; // substitution executes — keep it scannable
    return full.replace(payload, " ");
  });
}

/** `FOO=bar BAZ=qux rm -rf /` must still match the rm rule. */
function stripEnvPrefix(cmd) {
  return cmd.replace(/^\s*(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/, "");
}

/**
 * `bash -c "rm -rf /"` and `python3 -c "os.system('rm -rf /')"` hide the real
 * command inside a quoted argument, where no pattern written against shell
 * syntax can reach it.
 *
 * Append each payload rather than substituting it, so the wrapper stays visible
 * to any rule that cares about the wrapper itself. Appending can only add
 * matches, never remove one — the conservative direction for a guard.
 */
function unwrapInterpreters(cmd) {
  const re =
    /(?:^|[\s;&|(])(?:sudo\s+)?(?:\S*\/)?(?:sh|bash|zsh|ksh|dash|python[0-9.]*|perl|ruby|node|deno|bun)\s+(?:-[^\s-]\S*\s+)*-c\s*(?:'([^']*)'|"([^"]*)"|(\S+))/gi;
  let out = cmd;
  let m;
  while ((m = re.exec(cmd)) !== null) {
    const payload = m[1] ?? m[2] ?? m[3];
    if (payload) out += "\n" + payload;
  }
  return out;
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

/** `~/x` → `/home/you/x`. Only a leading `~`; `foo~bar` is a filename. */
function expandHome(p) {
  return String(p).replace(/^~(?=\/|$)/, homedir());
}

/**
 * Glob → RegExp. `*` stays within one path segment; `**` crosses separators.
 *
 * The single-star-only version under-matched, silently: `~/.ssh/*` covered
 * `~/.ssh/id_rsa` but not `~/.ssh/keys/id_rsa`, so a key one directory deeper
 * than expected was unprotected while the policy claimed to protect the tree. A
 * rule that looks like it covers a directory and covers only its top level is
 * worse than no rule, because it buys trust it has not earned.
 *
 * Single `*` is kept segment-scoped rather than made recursive, so a policy can
 * still say "files directly in this directory" — widening every existing `*`
 * would have been a silent scope change in the other direction.
 */
function globToRe(glob) {
  const escaped = expandHome(glob).replace(/[.+^${}()|[\]\\]/g, "\\$&");
  // Alternation order matters: `**` must be consumed whole, or the `*` branch
  // takes half of it and the remainder becomes a stray literal star.
  const body = escaped.replace(/\*\*|\*/g, (m) => (m === "**" ? ".*" : "[^/]*"));
  return new RegExp(`^${body}$`);
}

/**
 * noDelete is enforced for Bash only (see checkDeletion) — Edit/Write/Read
 * cannot delete a file, so applying it here would block writes under the guise
 * of a deletion rule.
 */
function checkPath(filePath) {
  const abs = resolve(expandHome(filePath));
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

// ── deletion rules (Bash) ───────────────────────────────────────────────────

/**
 * `policy.paths.noDelete` shipped declared and never read: checkPath consulted
 * zeroAccess, readOnly and confirmWrite only, so the policy advertised that
 * `~/.ssh` and `~/.aws` were protected from deletion and nothing enforced it.
 * Config that does nothing is the worst kind of security control — it is the
 * claim without the behaviour.
 *
 * IMPLEMENTED RATHER THAN DELETED because the gap it covers is real and nothing
 * else closes it. The bash `blocked` rules only catch recursive deletes of the
 * filesystem root, a home directory or a system directory; `rm -f ~/.ssh/id_rsa`
 * is none of those and sailed through. Native `permissions.deny` cannot help
 * either — it matches command prefixes, and the key can be any argument.
 *
 * BLOCK, not confirm. A write to a credential file is usually recoverable — from
 * git, a backup, or the file's own contents still being on disk. Deleting a
 * private key or an AWS credentials file is not: there is nothing to restore
 * from and no undo. The asymmetry sets the tier. A false positive costs one line
 * in the user's overlay (bash.allow is checked before this runs, and the block
 * message says so); a false negative costs a key that cannot be re-derived.
 *
 * DELIBERATELY NARROW. Extracting the paths a shell command will delete is not
 * solvable in general — variables, globs, subshells, `xargs`, `find -exec`,
 * `$(…)` and a cwd this process cannot know all defeat it. So this does not try.
 * It reads the obvious shape only: a segment whose command word is a deletion
 * command, and whose non-flag arguments name a protected path literally. The
 * known misses are accepted, not overlooked:
 *   - `cd ~/.ssh && rm id_rsa`      (relative to a cwd the hook cannot see)
 *   - `rm $KEY`, `rm $(…)`          (unresolvable before the shell runs)
 *   - `xargs rm`, `find -exec rm`   (target comes from another process)
 * Catching the obvious cases is worth far more than a parser that pretends to be
 * exhaustive, because the pretence is what gets trusted.
 */
const DELETE_COMMAND = /^(?:rm|rmdir|shred|unlink|srm)$/i;

function deletionTargets(command) {
  const out = [];
  // Segment on every shell separator, so `echo hi && rm ~/.ssh/id_rsa` is read
  // as two commands rather than one command that happens to start with `echo`.
  for (const segment of command.split(/\n|;|&&|\|\||\||&/)) {
    const tokens = stripEnvPrefix(segment).trim().match(/'[^']*'|"[^"]*"|\S+/g);
    if (!tokens) continue;
    let i = 0;
    if (/^sudo$/i.test(tokens[0])) i++;
    if (!DELETE_COMMAND.test((tokens[i] ?? "").replace(/^.*\//, ""))) continue;
    for (const tok of tokens.slice(i + 1)) {
      if (tok.startsWith("-")) continue; // a flag, `--` included
      const bare = expandHome(tok.replace(/^(['"])([\s\S]*)\1$/, "$2")).replace(
        /^\$\{?HOME\}?(?=\/|$)/,
        homedir(),
      );
      if (/[$`]/.test(bare)) continue; // still unresolved — do not guess
      out.push(bare);
    }
  }
  return out;
}

function checkDeletion(command, raw) {
  const globs = policy.paths?.noDelete ?? [];
  for (const target of globs.length ? deletionTargets(command) : []) {
    const abs = resolve(target);
    const dir = abs.endsWith("/") ? abs : `${abs}/`;
    for (const g of globs) {
      // Two shapes count as deleting a protected path: naming it, or naming a
      // directory that contains it — `rm -rf ~/.ssh` takes every key with it.
      // The glob's literal prefix (everything before its first wildcard) is the
      // deepest ancestor the rule can be certain about.
      const containsProtected = expandHome(g).split("*")[0].startsWith(dir);
      if (containsProtected || globToRe(g).test(abs)) {
        record("blocked", "deletion of a protected path", raw);
        block(
          "deletion of a path the policy protects",
          `Path: ${abs}\nRule: paths.noDelete "${g}"\nCommand: ${raw.slice(0, 300)}\n\n` +
            `Deleting a credential is irreversible, so this is a stop rather than a prompt.\n` +
            `If this is wrong for your machine, exempt the command in ${USER_POLICY}:\n` +
            `  { "bash": { "allow": [ { "pattern": "<regex>", "reason": "why" } ] } }\n` +
            `That file survives plugin updates. KEEL_GUARD_OFF=1 disables the guard entirely.`,
        );
      }
    }
  }
}

// ── dispatch ────────────────────────────────────────────────────────────────
if (tool === "Bash") {
  const raw = String(ti.command ?? "");
  const scanned = unwrapInterpreters(stripEnvPrefix(stripMessagePayloads(scannableText(raw))));

  // Your exemptions win outright. Checked before every shipped rule, because the
  // point of an escape hatch is that it works without asking permission from the
  // thing you're escaping.
  for (const r of compile(policy.bash?.allow)) {
    if (r.re.test(scanned)) {
      record("allowed", r.reason ?? "exempted by your policy overlay", raw);
      allow();
    }
  }

  for (const r of compile(policy.bash?.blocked)) {
    if (r.re.test(scanned)) {
      record("blocked", r.reason, raw);
      block(
        r.reason,
        `Command: ${raw.slice(0, 300)}\n\n` +
          `If this is wrong for your machine, exempt it in ${USER_POLICY}:\n` +
          `  { "bash": { "allow": [ { "pattern": "<regex>", "reason": "why" } ] } }\n` +
          `That file survives plugin updates. KEEL_GUARD_OFF=1 disables the guard entirely.`,
      );
    }
  }
  // After the shipped block rules, so `rm -rf ~` reports the catastrophe rule
  // that names it best; before confirm, because a protected deletion is a stop.
  checkDeletion(scanned, raw);

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
