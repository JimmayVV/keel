// hooks-offline.test.mjs — a hook makes no network call (ADR-0003).
//
// On 2026-10-09 a UserPromptSubmit hook was built here that sent prompts to a
// Hindsight instance; the instance slowed the same afternoon, and every topical
// prompt would have paid for it. The hook (branch archive/hindsight-recall-hook,
// which this test fails against) was dropped and ADR-0003 recorded the
// rule, but nothing checked it. Per ADR-0001 a test is admitted when its failure
// class has occurred here; this is that class.
//
// What it checks, precisely: that every hooks.json command runs node on a file
// in hooks/, and that no hook's source names an HTTP client (fetch, the node
// network modules, browser network globals) or spawns curl or wget. It reads
// source text, so it does not see a network call assembled at runtime, a git
// subcommand that reaches a remote, or code a hook loads from outside hooks/.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const hooksDir = join(dirname(fileURLToPath(import.meta.url)), "..", "hooks");

test("every hook command runs node on a file in hooks/", () => {
  const config = JSON.parse(readFileSync(join(hooksDir, "hooks.json"), "utf8"));
  const commands = Object.values(config.hooks)
    .flat()
    .flatMap((group) => group.hooks)
    .map((h) => h.command);
  assert.ok(commands.length > 0, "hooks.json lost its hooks");
  for (const command of commands) {
    assert.match(command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/[\w-]+\.mjs"$/, command);
  }
});

test("no hook names an HTTP client or spawns curl or wget", () => {
  const network = [
    /\bfetch\s*\(/,
    /["'](node:)?(http|https|http2|net|tls|dgram|undici)["']/,
    /\b(XMLHttpRequest|WebSocket|EventSource)\b/,
    /\b(exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(\s*["'](curl|wget)\b/,
  ];
  const files = readdirSync(hooksDir).filter((f) => f.endsWith(".mjs"));
  assert.ok(files.length > 0, "hooks/ lost its hooks");
  for (const f of files) {
    const source = readFileSync(join(hooksDir, f), "utf8");
    for (const pattern of network) {
      assert.doesNotMatch(source, pattern, `${f} matches ${pattern}`);
    }
  }
});
