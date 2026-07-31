// docs.test.mjs — the docs may not claim a surface keel no longer has.
//
// The failure this catches has already happened once: the sync layer was removed
// (1d19d66) and MEMORY-ARCHITECTURE.md went on describing `sync.mjs` and
// `keel join` as working for three days. Nothing broke loudly — the docs just
// went quietly false, which DOCUMENTED-SURFACES.md calls worse than saying
// nothing. Per ADR-0001, a teardown must ship with the check that would notice;
// this is that check, retroactively.
//
// Scope is deliberately narrow: claims the docs make about keel's *own* surface —
// `keel <subcommand>` invocations and *.mjs files. Prose about removed things in
// the past tense doesn't match either pattern, so history stays writable.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// Every doc a user might read. Worktrees and node_modules are not under these.
const docFiles = [
  join(root, "README.md"),
  ...readdirSync(join(root, "docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(root, "docs", f)),
  ...readdirSync(join(root, "docs", "adr"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(root, "docs", "adr", f)),
  ...readdirSync(join(root, "plugins", "keel", "skills"))
    .map((d) => join(root, "plugins", "keel", "skills", d, "SKILL.md"))
    .filter((f) => existsSync(f)),
];

// The real command set, parsed from the dispatch — not a second list to drift.
const cli = readFileSync(join(root, "plugins", "keel", "bin", "keel"), "utf8");
const commands = new Set(
  [...cli.matchAll(/^\s*case "([a-z-]+)":/gm)].map((m) => m[1]),
);
commands.add("help");

// A subcommand claim is `keel` in invocation position: an inline code span or a
// fenced-block line that *starts* with it. Prose — even inside a code block,
// like "put keel on your PATH" — is not a claim about a subcommand.
function invocations(markdown) {
  const fencedLines = [...markdown.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)]
    .flatMap((m) => m[1].split("\n"))
    .map((line) => line.replace(/^\s*(?:\$ |bash )?/, ""));
  const inline = [...markdown.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  return [...fencedLines, ...inline].filter((s) => s.startsWith("keel "));
}

test("every `keel <subcommand>` the docs mention exists in the CLI", () => {
  assert.ok(commands.size > 1, "failed to parse the command set from bin/keel");
  for (const file of docFiles) {
    for (const line of invocations(readFileSync(file, "utf8"))) {
      const [, word] = line.match(/^keel ([a-z-]+)/) ?? [];
      if (!word) continue; // `keel --help`, bare flags
      assert.ok(
        commands.has(word),
        `${file.slice(root.length + 1)} mentions \`keel ${word}\`, ` +
          `which bin/keel does not dispatch (has: ${[...commands].join(", ")})`,
      );
    }
  }
});

// A cold review (2026-07-30) found the README naming one skill while four
// shipped, and three version numbers disagreeing — drift the original two
// checks were too narrow to see. Same disease, wider net.
test("every skill keel ships is named in the README", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  for (const skill of readdirSync(join(root, "plugins", "keel", "skills"))) {
    assert.ok(
      new RegExp(`\\b${skill}\\b`).test(readme),
      `README.md never mentions the \`${skill}\` skill — the box says less than it holds`,
    );
  }
});

test("the marketplace, the plugin, and the README agree on a version", () => {
  const plugin = JSON.parse(
    readFileSync(join(root, "plugins", "keel", ".claude-plugin", "plugin.json"), "utf8"),
  );
  const marketplace = JSON.parse(
    readFileSync(join(root, ".claude-plugin", "marketplace.json"), "utf8"),
  );
  assert.equal(
    marketplace.metadata?.version,
    plugin.version,
    "marketplace.json and plugin.json disagree on the version",
  );
  const [major, minor] = plugin.version.split(".");
  assert.match(
    readFileSync(join(root, "README.md"), "utf8"),
    new RegExp(`\\*\\*Status:\\*\\* v${major}\\.${minor}\\b`),
    `README status line does not say v${major}.${minor}`,
  );
});

test("every *.mjs file the docs mention exists in the repo", () => {
  const mjsDirs = [
    join(root, "plugins", "keel", "hooks"),
    join(root, "plugins", "keel", "test"),
    join(root, "scripts"),
  ];
  const shipped = new Set(
    mjsDirs.flatMap((d) =>
      existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".mjs")) : [],
    ),
  );
  for (const file of docFiles) {
    const text = readFileSync(file, "utf8");
    for (const [raw] of text.matchAll(/[\w*.-]+\.mjs\b/g)) {
      if (raw.includes("*")) continue; // globs like *.test.mjs claim nothing
      const name = raw.replace(/^[.-]+/, "");
      assert.ok(
        shipped.has(name),
        `${file.slice(root.length + 1)} mentions ${name}, which does not exist`,
      );
    }
  }
});

// Phrases a cold audit (2026-07-30) proved false, graded 4/10 on faithfulness
// of guarantees. Each was fixed once; this keeps them fixed. Per ADR-0001: a
// test is admitted when it catches a failure class that already occurred —
// this class is "marketing register widening a guarantee past its mechanism."
test("claims the audit proved false stay dead", () => {
  const pages = [
    join(root, "README.md"),
    ...readdirSync(join(root, "site", "src", "pages")).map((f) =>
      join(root, "site", "src", "pages", f),
    ),
  ];
  const dead = [
    [/leaves? no trace/i, "uninstall leaves your data, on purpose — say what stays"],
    [/clos(es|ing) the indirect prompt-injection/i, "it raises the cost; advisory, not enforcement"],
    [/anything that would send your (private )?files/i, "scope to the shapes the regexes cover"],
    [/every guard has an off[- ]switch, every write has an undo\b(?![\s\S]{0,80}KEEL_)/i, "only true while each switch exists — cite them"],
  ];
  for (const file of pages) {
    const text = readFileSync(file, "utf8");
    for (const [re, why] of dead) {
      assert.ok(
        !re.test(text),
        `${file.slice(root.length + 1)} resurrects a disproven claim (${re}): ${why}`,
      );
    }
  }
});
