// env.test.mjs — keel's KEEL_* keys: read where a user sets them, and named
// where a user can find them.
//
// Review of #19 (2026-10-09) found the same two failures three times over:
// KEEL_SEARCH_LOG_OFF and KEEL_SEARCH_TIMEOUT_MS read from process.env alone,
// so setting them in settings.json (the documented place) did nothing when the
// reflect skill ran keel from Bash; and KEEL_SEARCH_LOG and
// KEEL_SEARCH_TIMEOUT_MS existed in code that no doc named. A sweep then found
// KEEL_ACTIVITY_DIR and KEEL_HINDSIGHT_TIMEOUT_MS with the first failure since
// before #19. Per ADR-0001, a failure class that has occurred here earns a test.
//
// What it checks, precisely: bin/keel's source has no bare process.env.KEEL_*
// read (keelEnv() merges settings.json), and every KEEL_* name in bin/keel, the
// hooks, or a plugin's .mcp.json appears in the README, CONTEXT.md, docs/, or a
// site page, or in INTERNAL below with its reason. Hooks are exempt from the
// first check: Claude Code puts settings.json's env into a hook's environment.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (p) => readFileSync(p, "utf8");
const filesIn = (dir, ext) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => join(dir, f)) : [];

const CLI = join(root, "plugins", "keel", "bin", "keel");

// Not user surface, so not documented. Each needs a reason.
const INTERNAL = {
  KEEL_RECALL_DEADLINE_MS: "recall hook tuning, set by its tests",
  KEEL_RECALL_MAX_FACTS: "recall hook tuning, set by its tests",
  KEEL_RECALL_MAX_CHARS: "recall hook tuning, set by its tests",
  KEEL_RECALL_MIN_RELEVANCE: "recall hook tuning, set by its tests",
  KEEL_RECALL_BODY_ONLY_RELEVANCE: "recall hook tuning, set by its tests",
  KEEL_RECALL_SOLO_SHARE: "recall hook tuning, set by its tests",
};

const NAME = /\bKEEL_[A-Z0-9_]*[A-Z0-9]\b/g;

test("bin/keel reads KEEL_* keys through keelEnv, never process.env alone", () => {
  const bare = [
    /process\.env\.KEEL_/,
    /process\.env\[\s*["'`]KEEL_/,
    /\{[^}]*\bKEEL_[^}]*\}\s*=\s*process\.env\b/,
  ];
  const lines = read(CLI).split("\n");
  const hits = lines
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => bare.some((re) => re.test(line)));
  assert.deepEqual(hits.map(({ n, line }) => `${n}: ${line.trim()}`), []);
});

test("every KEEL_* key the code reads is documented, or listed as internal", () => {
  const runtime = [
    CLI,
    ...filesIn(join(root, "plugins", "keel", "hooks"), ".mjs"),
    ...readdirSync(join(root, "plugins"))
      .map((p) => join(root, "plugins", p, ".mcp.json"))
      .filter(existsSync),
  ];
  const names = new Set(runtime.flatMap((f) => read(f).match(NAME) ?? []));
  assert.ok(names.size > 5, "found too few KEEL_* names; is the scan broken?");

  const docs = [
    join(root, "README.md"),
    join(root, "CONTEXT.md"),
    ...filesIn(join(root, "docs"), ".md"),
    ...filesIn(join(root, "docs", "adr"), ".md"),
    ...filesIn(join(root, "site", "src", "pages"), ".astro"),
  ].map(read).join("\n");
  const documented = new Set(docs.match(NAME) ?? []);

  const missing = [...names].filter((n) => !documented.has(n) && !(n in INTERNAL)).sort();
  assert.deepEqual(missing, [], "name each in a doc, or add it to INTERNAL with a reason");

  const stale = Object.keys(INTERNAL).filter((n) => !names.has(n));
  assert.deepEqual(stale, [], "INTERNAL lists keys the code no longer reads");
});
