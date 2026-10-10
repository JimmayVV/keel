// hermetic.mjs — imported first by every test file, for its side effect: the
// keel this suite spawns sees only the config its tests give it.
//
// Claude Code layers settings.json's env block into every process a session
// starts, so a suite run from a session on a configured machine inherited that
// machine's KEEL_* keys, and every spawn of bin/keel or a hook passed them on:
// on 2026-10-10, with the off switches set, 161 of 355 tests failed. And
// bin/keel reads settings.json itself, with the block winning over the shell,
// so a spawn without its own CLAUDE_CONFIG_DIR read the developer's real one.
//
// So: no inherited KEEL_* keys, and an empty config dir by default. A test that
// needs either sets it in the child's env, where the reader can see it.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const key of Object.keys(process.env)) {
  if (key.startsWith("KEEL_")) delete process.env[key];
}

const cfg = mkdtempSync(join(tmpdir(), "keel-test-cfg-"));
process.env.CLAUDE_CONFIG_DIR = cfg;
process.on("exit", () => rmSync(cfg, { recursive: true, force: true }));
