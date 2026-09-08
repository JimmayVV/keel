/**
 * Query-recall contract tests. Run: node --test
 *
 * The properties that matter:
 *   1. a relevant fact reaches the prompt unasked, carrying its source path
 *   2. an irrelevant prompt gets silence — the precision floor is the feature,
 *      because a hook that volunteers noise on every turn gets tuned out
 *   3. the project index is never echoed back; it is already ambient
 *   4. nothing takes the session down: bad input, missing directories, and a
 *      hostile corpus all still return continue:true
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "..", "hooks", "memory-recall.mjs");

function runHook(payload, env = {}) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    env: { ...process.env, ...env },
  });
  let parsed = null;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    /* leave null so a test can assert on the raw output */
  }
  return { ...res, parsed, context: parsed?.hookSpecificOutput?.additionalContext ?? null };
}

/** Build a throwaway config dir holding one project's memory files. */
function fixture(cwd, files) {
  const config = mkdtempSync(join(tmpdir(), "keel-recall-"));
  const slug = cwd.replace(/[/._]/g, "-");
  const dir = join(config, "projects", slug, "memory");
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return { config, cleanup: () => rmSync(config, { recursive: true, force: true }) };
}

const CWD = "/tmp/keel-recall-project";

const TURBOREPO_FACT = `---
name: monorepo-turborepo-layout
description: "The front end consolidated into one Turborepo workspace in May 2026"
---

Every package now lives under \`packages/\`, and the login application is the only
remaining app with its own release train.
`;

const POKER_FACT = `---
name: poker-cbet-sizing
description: "Continuation bet sizing preferences on dry boards"
---

Small sizing on dry boards, polarised sizing on wet ones.
`;

describe("memory-recall", () => {
  test("surfaces a relevant fact, with its source path", () => {
    const { config, cleanup } = fixture(CWD, {
      "monorepo.md": TURBOREPO_FACT,
      "poker.md": POKER_FACT,
    });
    try {
      const { parsed, context } = runHook(
        { hook_event_name: "UserPromptSubmit", cwd: CWD, prompt: "where does the turborepo workspace put its packages" },
        { CLAUDE_CONFIG_DIR: config },
      );
      assert.equal(parsed.continue, true);
      assert.ok(context, "expected recalled context");
      assert.match(context, /monorepo-turborepo-layout/);
      assert.match(context, /monorepo\.md/, "context must cite the file it came from");
      assert.doesNotMatch(context, /poker/, "an unrelated fact must not ride along");
    } finally {
      cleanup();
    }
  });

  test("stays silent when nothing is relevant", () => {
    const { config, cleanup } = fixture(CWD, { "poker.md": POKER_FACT });
    try {
      const { parsed, context } = runHook(
        { hook_event_name: "UserPromptSubmit", cwd: CWD, prompt: "what is the capital city of Portugal" },
        { CLAUDE_CONFIG_DIR: config },
      );
      assert.equal(parsed.continue, true);
      assert.equal(context, null, "no match must produce no context at all");
    } finally {
      cleanup();
    }
  });

  test("a single shared word is not a match", () => {
    const { config, cleanup } = fixture(CWD, { "poker.md": POKER_FACT });
    try {
      const { context } = runHook(
        { hook_event_name: "UserPromptSubmit", cwd: CWD, prompt: "explain the boards used in chess tournaments" },
        { CLAUDE_CONFIG_DIR: config },
      );
      assert.equal(context, null, "one incidental term overlap is a coincidence, not a fact");
    } finally {
      cleanup();
    }
  });

  test("never echoes the ambient project index", () => {
    const { config, cleanup } = fixture(CWD, {
      "MEMORY.md": "- [Turborepo workspace](monorepo.md) — packages layout\n",
      "monorepo.md": TURBOREPO_FACT,
    });
    try {
      const { context } = runHook(
        { hook_event_name: "UserPromptSubmit", cwd: CWD, prompt: "where does the turborepo workspace put its packages" },
        { CLAUDE_CONFIG_DIR: config },
      );
      assert.ok(context);
      assert.doesNotMatch(context, /MEMORY\.md/, "the index is already in context natively");
    } finally {
      cleanup();
    }
  });

  test("respects the fact cap", () => {
    const files = {};
    for (let i = 0; i < 10; i += 1) {
      files[`fact-${i}.md`] = `---\nname: turborepo-workspace-note-${i}\ndescription: "Turborepo workspace packages note ${i}"\n---\n\nWorkspace packages detail ${i}.\n`;
    }
    const { config, cleanup } = fixture(CWD, files);
    try {
      const { context } = runHook(
        { hook_event_name: "UserPromptSubmit", cwd: CWD, prompt: "turborepo workspace packages" },
        { CLAUDE_CONFIG_DIR: config, KEEL_RECALL_MAX_FACTS: "2" },
      );
      assert.ok(context);
      assert.equal(context.match(/^### /gm).length, 2);
    } finally {
      cleanup();
    }
  });

  // The same fact filed under two projects has happened here twice. Left alone,
  // repetition outranks relevance and one fact spends two of the three slots.
  test("copies of one fact across projects share a single slot and name each other", () => {
    const { config, cleanup } = fixture(CWD, { "monorepo.md": TURBOREPO_FACT, "poker.md": POKER_FACT });
    const otherDir = join(config, "projects", "-tmp-some-other-project", "memory");
    mkdirSync(otherDir, { recursive: true });
    writeFileSync(join(otherDir, "turbo-copy.md"), TURBOREPO_FACT);
    try {
      const { context } = runHook(
        { hook_event_name: "UserPromptSubmit", cwd: CWD, prompt: "where does the turborepo workspace put its packages" },
        { CLAUDE_CONFIG_DIR: config, KEEL_RECALL_MAX_FACTS: "3" },
      );
      assert.ok(context);
      assert.equal(context.match(/^### /gm).length, 1, "one fact, however many files hold it, is one entry");
      assert.match(context, /Duplicate at: .*turbo-copy\.md/, "the copy is named so it can be deleted at the source");
    } finally {
      cleanup();
    }
  });

  test("KEEL_RECALL_OFF disables it without uninstalling", () => {
    const { config, cleanup } = fixture(CWD, { "monorepo.md": TURBOREPO_FACT });
    try {
      const { parsed, context } = runHook(
        { hook_event_name: "UserPromptSubmit", cwd: CWD, prompt: "where does the turborepo workspace put its packages" },
        { CLAUDE_CONFIG_DIR: config, KEEL_RECALL_OFF: "1" },
      );
      assert.equal(parsed.continue, true);
      assert.equal(context, null);
    } finally {
      cleanup();
    }
  });

  describe("degrades to nothing", () => {
    test("malformed stdin", () => {
      const res = spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf-8" });
      assert.equal(res.status, 0);
      assert.equal(JSON.parse(res.stdout).continue, true);
    });

    test("missing projects directory", () => {
      const empty = mkdtempSync(join(tmpdir(), "keel-recall-empty-"));
      try {
        const { parsed, context } = runHook(
          { hook_event_name: "UserPromptSubmit", cwd: CWD, prompt: "where does the turborepo workspace live" },
          { CLAUDE_CONFIG_DIR: empty },
        );
        assert.equal(parsed.continue, true);
        assert.equal(context, null);
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }
    });

    test("a trivially short prompt is not worth searching for", () => {
      const { config, cleanup } = fixture(CWD, { "monorepo.md": TURBOREPO_FACT });
      try {
        const { parsed, context } = runHook(
          { hook_event_name: "UserPromptSubmit", cwd: CWD, prompt: "ok" },
          { CLAUDE_CONFIG_DIR: config },
        );
        assert.equal(parsed.continue, true);
        assert.equal(context, null);
      } finally {
        cleanup();
      }
    });
  });
});
