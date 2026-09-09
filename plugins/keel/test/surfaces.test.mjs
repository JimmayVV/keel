// surfaces.test.mjs — the code may not touch a Claude Code file the contract
// doesn't admit to.
//
// DOCUMENTED-SURFACES.md said for a month that the allowlist was "a convention,
// not a runtime check," and a cold review (2026-07-30) found code calling an
// undocumented file "documented." The convention was being enforced by nobody.
// Per ADR-0001 a test is admitted when it catches a failure class that has
// already occurred here; this is that class — code depending on a surface the
// contract never named — turned into a check that runs before every push.
//
// What it checks, precisely: the *names* of Claude Code files and directories
// that keel's source mentions. A forbidden name may not appear at all, except
// inside the security guard's own denylist, where naming a credential file is
// how it gets protected. An undocumented name may appear only if the doc's
// exceptions table carries a row for it. It does not observe runtime access —
// a path assembled at runtime from parts would slip past it — so the doc's
// "Enforcing it" section says exactly that and no more.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const doc = readFileSync(join(root, "docs", "DOCUMENTED-SURFACES.md"), "utf8");

// Source that runs: the CLI and every hook. Tests and docs are not code paths.
const sources = [
  join(root, "plugins", "keel", "bin", "keel"),
  ...readdirSync(join(root, "plugins", "keel", "hooks"))
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => join(root, "plugins", "keel", "hooks", f)),
];

/** The rows of the markdown table that follows a given heading. */
function tableUnder(heading) {
  const start = doc.indexOf(heading);
  assert.ok(start !== -1, `DOCUMENTED-SURFACES.md lost its "${heading}" section`);
  const section = doc.slice(start, doc.indexOf("\n## ", start + heading.length));
  return section
    .split("\n")
    .filter((l) => l.startsWith("|") && !/^\|[-\s|]+\|$/.test(l))
    .slice(1) // header row
    .map((l) => l.split("|").slice(1, -1).map((cell) => cell.trim()));
}

/** Backtick-quoted file and directory names in a table's first column. */
function namesIn(rows) {
  return rows.flatMap(([surface]) =>
    [...surface.matchAll(/`([^`]+)`/g)].map((m) => m[1]),
  );
}

// A surface is identified by its file name, not the full path the doc writes —
// `projects/*/*.jsonl` in the doc is `.jsonl` under `projects` in code.
const forbidden = [
  ["history.jsonl", /history\.jsonl/],
  [".credentials.json", /\.credentials\.json/],
  ["daemon/", /["'`/]daemon["'`/]/],
  ["sessions/", /["'`/]sessions["'`/]/],
  ["projects/*/*.jsonl transcripts", /projects[^\n]*\.jsonl|\.jsonl[^\n]*projects/],
];

test("the forbidden table in DOCUMENTED-SURFACES.md still names what this test guards", () => {
  const listed = namesIn(tableUnder("## Forbidden"));
  for (const [name] of forbidden) {
    assert.ok(
      listed.some((l) => l.includes(name.split(" ")[0])),
      `this test guards "${name}" but the Forbidden table no longer lists it — update one or the other`,
    );
  }
});

test("no source file reads, writes, or parses a forbidden surface", () => {
  for (const file of sources) {
    const short = file.slice(root.length + 1);
    const text = readFileSync(file, "utf8");
    for (const [name, re] of forbidden) {
      // The guard names credential files in order to deny access to them.
      // That is the one place a forbidden name is allowed to appear.
      if (name === ".credentials.json" && short.endsWith("security-guard.mjs")) continue;
      assert.ok(!re.test(text), `${short} mentions ${name}, which DOCUMENTED-SURFACES.md forbids`);
    }
  }
});

// Undocumented files keel is known to touch. Each must have a row in the
// exceptions table, with its blast radius and exit condition, or the code goes.
const undocumented = [
  ["installed_plugins.json", /installed_plugins\.json/],
  ["known_marketplaces.json", /known_marketplaces\.json/],
  ["~/.claude.json", /\.claude\.json/],
  ["plugins/marketplaces/keel", /["']marketplaces["'],\s*["']keel["']|marketplaces\/keel/],
];

test("every undocumented surface the code touches has a row in the exceptions table", () => {
  const rows = tableUnder("## Acknowledged exceptions");
  const listed = namesIn(rows);
  for (const [name, re] of undocumented) {
    const touched = sources.filter((f) => re.test(readFileSync(f, "utf8")));
    if (touched.length === 0) continue; // code stopped touching it; the row may retire on its own
    const key = name.replace(/^~\//, "");
    assert.ok(
      listed.some((l) => l.includes(key)),
      `${touched.map((f) => f.slice(root.length + 1)).join(", ")} touches ${name}, ` +
        `and the exceptions table has no row for it — add one with blast radius and exit, or stop touching it`,
    );
  }
  // Every exception row must say what happens if it breaks and when it leaves.
  for (const row of rows) {
    assert.equal(row.length, 4, `exceptions row for ${row[0]} is missing a column (surface, use, if it changes, leaves when)`);
    for (const cell of row) assert.ok(cell.length > 0, `exceptions row for ${row[0]} has an empty cell`);
  }
});

// The reflect plugin's .mcp.json sat in the working tree, passed validation and
// every test, and was never committed: a root .gitignore rule for the repo's
// own .mcp.json swallowed it. A plugin whose manifest points at a file the
// clone does not contain is a plugin that installs and does nothing.
test("every file a plugin manifest points at is tracked by git", () => {
  const tracked = new Set(execFileSync("git", ["-C", root, "ls-files", "plugins"], { encoding: "utf8" }).split("\n"));
  for (const dir of readdirSync(join(root, "plugins"))) {
    const manifestPath = join("plugins", dir, ".claude-plugin", "plugin.json");
    const manifest = JSON.parse(readFileSync(join(root, manifestPath), "utf8"));
    for (const key of ["mcpServers", "hooks", "commands", "agents", "skills"]) {
      const ref = manifest[key];
      if (typeof ref !== "string") continue;
      const rel = join("plugins", dir, ref);
      assert.ok(
        tracked.has(rel) || [...tracked].some((t) => t.startsWith(`${rel}/`)),
        `${manifestPath} points at ${ref}, which git does not track — check .gitignore`,
      );
    }
  }
});
