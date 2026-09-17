#!/usr/bin/env node
/**
 * credential-scan.mjs — notice a credential that just entered the session.
 *
 * TRIGGER: PostToolUse on Bash and Read.
 *
 * THE FAILURE THIS EXISTS FOR (2026-09-17, this machine)
 * A session ran `ssh jimmy@<nas> "midclt call mail.config"` to diagnose broken
 * mail. TrueNAS stores its SendGrid API key in plaintext in its config DB, so
 * the key came back with the config and landed in the transcript. keel's
 * security guard had nothing to say, and was right not to by its own model:
 * there was no secret *path* in the command and no exfiltration *shape*.
 *
 * That is the blind spot, and it is structural rather than a gap in a list:
 *
 *   The guard's model is "a secret is a FILE at a known PATH, and the danger
 *   is a command that MOVES it." Here the secret was a VALUE in someone else's
 *   datastore, with no path at all, and the danger was a command that PRINTED
 *   it. Whether `midclt call mail.config` returns a credential depends on the
 *   remote machine's state, not on the command text — so no amount of work on
 *   the PreToolUse side can catch it.
 *
 * So: watch the OTHER side. Tool output is a surface too.
 *
 * WHAT THIS CAN AND CANNOT DO — the honest limit
 * By PostToolUse the bytes are already in context. This hook **cannot redact
 * and cannot prevent**; nothing at this position can. What it does is convert a
 * silent, permanent exposure into a known one while rotation is still cheap: it
 * names which vendor's credential shape appeared, tells the user to rotate, and
 * records the event so the to-do outlives the session.
 *
 * WHY SHAPES AND NOT COMMANDS
 * A blocklist of credential-bearing commands (`kubectl get secret`, `gh secret
 * list`, `op item get`, `midclt call *.config`, `docker inspect`, …) is an
 * unbounded surface you can never finish — every appliance has its own. The set
 * of vendor-assigned token *prefixes* is small and nearly closed. Match the
 * credential, not the command.
 *
 * Deliberately prefixed shapes ONLY. Generic high-entropy detection is the only
 * way to catch an unprefixed secret, and it is also where every false positive
 * lives (git SHAs, base64 blobs, UUIDs, digests). A guard that cries wolf is a
 * guard that gets switched off, so the unprefixed case is left uncovered until a
 * real miss admits it.
 *
 * SCOPE: Bash and Read. MCP tool results are a real and uncovered gap — app data
 * can carry credentials too — but that has not been felt here, and ADR-0001 wants
 * the event before the runtime. Add `mcp__.*` to the matcher when it happens.
 *
 * NEVER LOGS THE VALUE. The audit record carries the vendor, the tool, and a
 * masked hint — never the secret. Writing a credential into a log to warn about a
 * credential in a transcript is not an improvement.
 *
 * Off switch: KEEL_CREDSCAN_OFF=1.
 * Runtime: plain Node, no dependencies.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";

/** Never let a guard take the session down: any failure degrades to a no-op. */
function passthrough() {
  process.stdout.write("{}");
  process.exit(0);
}

if (process.env.KEEL_CREDSCAN_OFF === "1") passthrough();

let input;
try {
  input = JSON.parse(readFileSync(0, "utf-8"));
} catch {
  passthrough();
}

/**
 * Vendor-assigned credential shapes.
 *
 * Every entry is anchored on a literal prefix the vendor controls, which is what
 * keeps the false-positive rate near zero. Lengths are minimums, not exact, so a
 * vendor lengthening a token does not silently stop matching.
 */
const SHAPES = [
  { vendor: "SendGrid", re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g },
  { vendor: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}/g },
  { vendor: "GitHub fine-grained PAT", re: /\bgithub_pat_[A-Za-z0-9_]{50,}/g },
  { vendor: "Anthropic", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { vendor: "OpenAI", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g },
  { vendor: "AWS access key id", re: /\b(?:AKIA|ASIA|ABIA|ACCA|A3T[A-Z0-9])[A-Z0-9]{16}\b/g },
  { vendor: "Slack", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { vendor: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35,}/g },
  { vendor: "GitLab PAT", re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { vendor: "npm token", re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { vendor: "DigitalOcean", re: /\bdop_v1_[a-f0-9]{64}\b/g },
  { vendor: "Stripe live key", re: /\b[sr]k_live_[A-Za-z0-9]{24,}/g },
  { vendor: "Hugging Face", re: /\bhf_[A-Za-z0-9]{30,}/g },
  { vendor: "private key block", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { vendor: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  // Not vendor-prefixed, but structural and just as tight: a URL carrying an
  // inline password (`postgres://user:pass@host`). Shape, not entropy.
  { vendor: "URL with inline credentials", re: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@/]{1,64}:[^\s:@/]{3,64}@[^\s/]{3,}/g },
];

/**
 * Documentation, not exposure.
 *
 * Vendors publish example keys, and tools print placeholders. Matching those
 * teaches the user that the warning is noise, which is the one outcome that
 * makes this hook worse than nothing.
 */
const KNOWN_EXAMPLES = [
  "AKIAIOSFODNN7EXAMPLE",
  "AKIAI44QH8DHBEXAMPLE",
  "sk-ant-api03-xxxxxxxx",
];

function isPlaceholder(v) {
  if (KNOWN_EXAMPLES.some((e) => v.includes(e))) return true;
  if (/\*{3,}|x{6,}|X{6,}|\.{3,}|REDACTED|EXAMPLE|PLACEHOLDER|YOUR[_-]?(?:API|SECRET|TOKEN|KEY)|<[^>]+>/i.test(v)) return true;
  // A run of one repeated character is a mask, not a secret.
  const tail = v.replace(/^[^_.-]*[_.-]/, "");
  if (tail.length > 5 && new Set(tail).size <= 2) return true;
  return false;
}

/**
 * Leave enough to recognise which key it was, never enough to use it.
 *
 * The revealed head stops at the vendor's own delimiter — `SG.`, `ghp_`,
 * `github_pat_`, `sk-ant-` — so it carries the brand and none of the secret
 * body. A fixed-width head would have exposed six real characters of a
 * `ghp_`-prefixed token, which is the wrong side of "recognisable".
 */
function mask(v) {
  const window = v.slice(0, 12);
  const cut = Math.max(window.lastIndexOf("."), window.lastIndexOf("_"), window.lastIndexOf("-"));
  const head = cut > 0 ? v.slice(0, cut + 1) : v.slice(0, 3);
  return `${head}…[${v.length} chars]`;
}

/**
 * The text a tool actually returned. `tool_response` is documented as an object
 * for Bash-style results, but it arrives as a bare string often enough that
 * assuming one shape would make this hook silently blind.
 */
function responseText(r) {
  if (r == null) return "";
  if (typeof r === "string") return r;
  const parts = [];
  for (const k of ["text", "stdout", "stderr", "content", "output"]) {
    const v = r[k];
    if (typeof v === "string") parts.push(v);
  }
  if (typeof r.file?.content === "string") parts.push(r.file.content);
  if (parts.length) return parts.join("\n");
  try {
    return JSON.stringify(r);
  } catch {
    return "";
  }
}

// A hook in the tool path must stay cheap. Output past this is not scanned, and
// the notice says so rather than implying a clean bill.
const LIMIT = 512 * 1024;
const raw = responseText(input?.tool_response);
const body = raw.length > LIMIT ? raw.slice(0, LIMIT) : raw;
const truncated = raw.length > LIMIT;

const found = new Map(); // vendor -> masked hints
for (const { vendor, re } of SHAPES) {
  for (const m of body.match(re) ?? []) {
    if (isPlaceholder(m)) continue;
    const list = found.get(vendor) ?? [];
    if (list.length < 3) list.push(mask(m));
    found.set(vendor, list);
  }
}

if (!found.size) passthrough();

const tool = String(input?.tool_name ?? "tool");

/**
 * The audit record, so a rotation to-do survives the session that created it.
 *
 * Written to the security log the guard already owns, in its shape, rather than
 * a second file with a second format (ADR-0002, one carrier per datum). The
 * command is masked before it is written: a credential can appear in the command
 * too, and this file must never be the thing that leaks one.
 */
function record() {
  if (process.env.KEEL_CREDSCAN_PROBE === "1") return; // self-check, not a real event
  try {
    const dir =
      process.env.KEEL_ACTIVITY_DIR?.trim() ||
      join(process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude"), "keel", "activity");
    mkdirSync(dir, { recursive: true });
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const device = (process.env.KEEL_DEVICE?.trim() || hostname() || "unknown")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "unknown";
    let subject = String(input?.tool_input?.command ?? input?.tool_input?.file_path ?? "").slice(0, 400);
    for (const { re } of SHAPES) subject = subject.replace(re, (m) => mask(m));
    appendFileSync(
      join(dir, `security-${month}-${device}.jsonl`),
      JSON.stringify({
        ts: now.toISOString(),
        verdict: "credential-exposed",
        reason: `${[...found.keys()].join(", ")} credential shape in ${tool} output`,
        tool,
        subject,
        vendors: [...found.keys()],
        session: String(input?.session_id ?? "").slice(0, 8),
      }) + "\n",
    );
  } catch { /* never let auditing break the session */ }
}

const vendors = [...found.entries()].map(([v, hints]) => `${v} (${hints.join(", ")})`);
const plural = found.size > 1 ? "credentials" : "a credential";

// systemMessage reaches the USER, who is the only one who can rotate. The model
// gets the same fact through additionalContext, plus the instruction not to
// repeat the value — it is already in context once and does not need echoing.
const forUser =
  `⚠ keel: ${plural} appeared in ${tool} output and is now in this session's transcript on disk.\n` +
  vendors.map((v) => `    · ${v}`).join("\n") +
  `\n    Rotate it. keel cannot redact what a tool already returned — this is a notice, not a block.` +
  (truncated ? `\n    (only the first ${LIMIT / 1024}KB of that output was scanned)` : "");

const forModel =
  `<keel-credential-exposure tool="${tool}">\n` +
  `${plural[0].toUpperCase()}${plural.slice(1)} matching a known vendor shape appeared in the output above: ` +
  `${[...found.keys()].join(", ")}.\n` +
  `Tell the user plainly that it needs rotating, and say where it came from. ` +
  `Do NOT repeat, echo, quote, or copy the value — into your reply, a file, a commit, a memory note, or any outbound call. ` +
  `Do not use it to authenticate to anything, even to test whether it is still valid.\n` +
  `keel has recorded the event without the value. It could not prevent this: the tool had already returned.\n` +
  `</keel-credential-exposure>`;

/**
 * Notice first, bookkeeping second — and the order is load-bearing.
 *
 * The warning is this hook's entire value; the audit record is a convenience on
 * top of it. Written the other way round, any slowness or failure in the log
 * write swallows the warning: a test pointed KEEL_ACTIVITY_DIR at a pathological
 * path, `mkdirSync` hung, and the exposure went unreported. Emitting the notice
 * before touching the filesystem means the worst a broken log can cost is the
 * log.
 */
process.stdout.write(
  JSON.stringify({
    systemMessage: forUser,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: forModel,
    },
  }),
);

record();
