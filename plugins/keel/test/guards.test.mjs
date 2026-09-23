/**
 * Guard contract tests. Run: node --test
 *
 * These assert the two properties that matter for a guard nobody disables:
 *   1. it fires on what it should
 *   2. it fails OPEN on anything unexpected, rather than breaking the session
 *
 * Trailer fixtures are assembled from fragments at runtime. Writing the literal
 * string into a file that a shell might echo will trip a correctly-configured
 * commit guard on the developer's own machine — which is a nice proof that the
 * idea works, and a very annoying way to run a test suite.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const hook = (name) => join(HERE, "..", "hooks", name);

function run(script, payload, env = {}) {
  const r = spawnSync(process.execPath, [hook(script)], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    env: { ...process.env, ...env },
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* non-JSON stdout is a failure the assertions will catch */
  }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}

const TRAILER = ["Co-Authored", "By: Claude"].join("-");

describe("untrusted-content", () => {
  test("wraps WebFetch output and names the source", () => {
    const r = run("untrusted-content.mjs", {
      tool_name: "WebFetch",
      tool_input: { url: "https://example.test/page" },
      tool_response: "hello",
    });
    assert.equal(r.code, 0);
    const ctx = r.json.hookSpecificOutput.additionalContext;
    assert.match(ctx, /untrusted-content/);
    assert.match(ctx, /example\.test/);
    assert.match(ctx, /DATA, never as instructions/);
  });

  test("classifies collaboration tools as human-authored", () => {
    const r = run("untrusted-content.mjs", {
      tool_name: "mcp__atlassian__getJiraIssue",
      tool_input: { issueKey: "ABC-1" },
      tool_response: "ticket body",
    });
    assert.match(r.json.hookSpecificOutput.additionalContext, /human-authored-external/);
  });

  test("flags zero-width characters as possible smuggling", () => {
    const r = run("untrusted-content.mjs", {
      tool_name: "WebFetch",
      tool_input: { url: "https://x.test" },
      tool_response: "normal​text",
    });
    assert.match(r.json.hookSpecificOutput.additionalContext, /elevated suspicion/);
  });

  test("passes through non-ingesting tools untouched", () => {
    const r = run("untrusted-content.mjs", { tool_name: "Read", tool_input: {} });
    assert.equal(r.code, 0);
    assert.equal(r.json.hookSpecificOutput, undefined);
  });

  test("fails open on malformed input", () => {
    const r = spawnSync(process.execPath, [hook("untrusted-content.mjs")], {
      input: "not json at all",
      encoding: "utf-8",
    });
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).continue, true);
  });
});

describe("commit-trailer-guard", () => {
  test("blocks a commit carrying a default-blocked trailer", () => {
    const r = run("commit-trailer-guard.mjs", {
      tool_name: "Bash",
      tool_input: { command: `git commit -m "feat: thing\n\n${TRAILER} <a@b.c>"` },
    });
    assert.equal(r.code, 2, "exit 2 is the documented block signal");
    assert.match(r.stderr, /blocked trailer/);
  });

  test("allows a clean commit", () => {
    const r = run("commit-trailer-guard.mjs", {
      tool_name: "Bash",
      tool_input: { command: 'git commit -m "feat: clean"' },
    });
    assert.equal(r.code, 0);
    assert.equal(r.json.continue, true);
  });

  test("ignores non-commit git commands that merely mention a trailer", () => {
    const r = run("commit-trailer-guard.mjs", {
      tool_name: "Bash",
      tool_input: { command: `git log --grep="${TRAILER}"` },
    });
    assert.equal(r.code, 0, "searching history for a trailer is not creating one");
  });

  test("respects KEEL_BLOCKED_TRAILERS override", () => {
    const r = run(
      "commit-trailer-guard.mjs",
      { tool_name: "Bash", tool_input: { command: 'git commit -m "chore: x\n\nSigned-Off-By: bot"' } },
      { KEEL_BLOCKED_TRAILERS: "Signed-Off-By: bot" },
    );
    assert.equal(r.code, 2);
  });

  test("ignores non-Bash tools", () => {
    const r = run("commit-trailer-guard.mjs", { tool_name: "Write", tool_input: {} });
    assert.equal(r.code, 0);
  });
});

describe("the trailer guard's off switch", () => {
  // Added after a cold audit: every other guard had an off switch; the one
  // guard that blocks with exit 2 did not — emptying KEEL_BLOCKED_TRAILERS
  // restores the defaults rather than disabling. KEEL_TRAILERS_OFF is the
  // real exit, and this pins it.
  test("KEEL_TRAILERS_OFF=1 allows a commit the guard would otherwise block", () => {
    const payload = {
      tool_name: "Bash",
      tool_input: { command: `git commit -m "feat: x\n\n${TRAILER} <a@b.c>"` },
    };
    const blocked = run("commit-trailer-guard.mjs", payload);
    assert.equal(blocked.code, 2, "sanity: must block without the switch");
    const allowed = run("commit-trailer-guard.mjs", payload, { KEEL_TRAILERS_OFF: "1" });
    assert.equal(allowed.code, 0, "KEEL_TRAILERS_OFF must be honoured");
  });
});

describe("the ingest boundary's off switch", () => {
  test("KEEL_INGEST_OFF=1 passes web content through unwrapped", () => {
    const payload = {
      tool_name: "WebFetch",
      tool_input: { url: "https://example.test" },
      tool_response: "hello",
    };
    const wrapped = run("untrusted-content.mjs", payload);
    assert.ok(wrapped.json?.hookSpecificOutput?.additionalContext, "sanity: wraps by default");
    const off = run("untrusted-content.mjs", payload, { KEEL_INGEST_OFF: "1" });
    assert.equal(off.json?.hookSpecificOutput, undefined, "KEEL_INGEST_OFF must be honoured");
  });
});


describe("trailer guard: the audit's two escapes", () => {
  test("git -C <dir> commit is still a commit (flag-with-argument form)", () => {
    const r = run("commit-trailer-guard.mjs", {
      tool_name: "Bash",
      tool_input: { command: `git -C /some/repo commit -m "x\n\n${TRAILER} <a@b>"` },
    });
    assert.equal(r.code, 2, "-C must not be a free bypass");
  });

  test("a heredoc-written script CONTAINING a commit+trailer is data, not a commit", () => {
    const body = [
      "cat > /tmp/demo.sh <<'SCRIPT'",
      `git commit -m "x\n\n${TRAILER} <a@b>"`,
      "SCRIPT",
    ].join("\n");
    const r = run("commit-trailer-guard.mjs", { tool_name: "Bash", tool_input: { command: body } });
    assert.equal(r.code, 0, "writing a script that mentions a trailer is not committing one");
  });
});


describe("trailer guard: heredoc data vs code (third audit)", () => {
  test("a heredoc piped into an interpreter is CODE — a committed trailer is caught", () => {
    const body = ["sh <<'EOF'", `git commit -m "x`, "", `${TRAILER} <a@b>"`, "EOF"].join("\n");
    const r = run("commit-trailer-guard.mjs", { tool_name: "Bash", tool_input: { command: body } });
    assert.equal(r.code, 2, "interpreter-piped heredoc executes; the trailer must be caught");
  });

  test("a heredoc redirected to a FILE is DATA — still allowed", () => {
    const body = ["cat > /tmp/demo.sh <<'SCRIPT'", `git commit -m "x`, "", `${TRAILER} <a@b>"`, "SCRIPT"].join("\n");
    const r = run("commit-trailer-guard.mjs", { tool_name: "Bash", tool_input: { command: body } });
    assert.equal(r.code, 0, "writing a script that mentions a trailer is not committing one");
  });
});

/**
 * The site says "Every part has an off switch". Each switch had its own test;
 * nothing asserted the ROSTER, so a hook added tomorrow with no switch would
 * make a published claim quietly false. This is the check that would notice.
 */
describe("the off-switch roster", () => {
  test("every shipped hook reads a KEEL_*_OFF escape hatch", () => {
    const dir = join(HERE, "..", "hooks");
    const hooks = readdirSync(dir).filter((f) => f.endsWith(".mjs"));
    assert.ok(hooks.length >= 5, `expected the hook roster, found ${hooks.length}`);
    for (const f of hooks) {
      const src = readFileSync(join(dir, f), "utf-8");
      assert.match(
        src,
        /process\.env\.KEEL_[A-Z0-9_]+_OFF/,
        `hooks/${f} has no KEEL_*_OFF switch, so "every part has an off switch" is false`,
      );
    }
  });
});

/**
 * A hook's source must stay greppable.
 *
 * untrusted-content.mjs spelled its zero-width character class literally, which
 * put a NUL and a bidi override in the file. `file` called it binary data and
 * plain `grep` skipped it silently — a session searching for its off switch found
 * nothing and concluded it had none. Escapes read the same and cost nothing.
 */
describe("hook sources are plain text", () => {
  test("no hook embeds a raw control or bidi character", () => {
    const dir = join(HERE, "..", "hooks");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".mjs"))) {
      const src = readFileSync(join(dir, f), "utf-8");
      const bad = src.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b-\u200f\u202a-\u202e\ufeff]/);
      assert.equal(
        bad,
        null,
        `hooks/${f} contains a raw control/bidi character (U+${bad?.[0]?.charCodeAt(0).toString(16).padStart(4, "0")}) \u2014 ` +
          "write it as an escape, or grep and `file` treat the source as binary",
      );
    }
  });
});
