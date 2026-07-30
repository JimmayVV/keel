/**
 * Doctor contract tests. Run: node --test
 *
 * The property that matters: a configured adapter whose bridge plugin is not
 * actually installed+enabled is a PROBLEM, not "all good". The env var is only
 * read by the plugin's MCP server; without the plugin the adapter silently
 * does nothing — which is exactly the failure doctor exists to catch.
 *
 * Hermetic: `claude` and `uvx` are stub executables in a temp PATH dir, so
 * these tests neither require nor touch a real Claude Code install.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, copyFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const KEEL = join(HERE, "..", "bin", "keel");

/**
 * A temp world: config dir with the memory adapter wired, stub CLIs on PATH.
 *
 * `claudeJson` seeds a fake ~/.claude.json. HOME is redirected at it (see
 * doctor()), because the MCP detection reads that file and would otherwise
 * find the developer's own servers — which is both non-hermetic and, on the
 * machine this was written, a test that passed for the wrong reason.
 */
function world(pluginListJson, claudeJson = null) {
  const root = mkdtempSync(join(tmpdir(), "keel-doc-"));
  const bin = join(root, "bin");
  const cfg = join(root, "cfg");
  const notes = join(root, "notes");
  mkdirSync(bin);
  mkdirSync(cfg);
  mkdirSync(notes);
  writeFileSync(join(cfg, "settings.json"), JSON.stringify({ env: { KEEL_MEMORY_HOME: notes } }));
  writeFileSync(join(bin, "uvx"), "#!/bin/sh\nexit 0\n");
  writeFileSync(
    join(bin, "claude"),
    `#!/bin/sh\nif [ "$1 $2" = "plugin list" ]; then printf '%s' '${pluginListJson.replace(/'/g, "'\\''")}'; exit 0; fi\nexit 1\n`,
  );
  chmodSync(join(bin, "uvx"), 0o755);
  chmodSync(join(bin, "claude"), 0o755);
  if (claudeJson) writeFileSync(join(root, ".claude.json"), JSON.stringify(claudeJson));
  return { root, bin, cfg };
}

function doctor(w, extraEnv = {}) {
  return spawnSync(process.execPath, [KEEL, "doctor"], {
    encoding: "utf-8",
    env: {
      ...process.env,
      PATH: `${w.bin}:${process.env.PATH}`,
      HOME: w.root,
      CLAUDE_CONFIG_DIR: w.cfg,
      ...extraEnv,
    },
  });
}

describe("doctor checks the bridge plugin, not just the env var", () => {
  test("configured + plugin enabled -> all good", () => {
    const w = world(JSON.stringify([{ id: "keel-memory@keel", enabled: true }]));
    const r = doctor(w);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /all good/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("configured but plugin missing -> problem, with the install fix", () => {
    const w = world(JSON.stringify([]));
    const r = doctor(w);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /keel-memory plugin is not installed/);
    assert.match(r.stdout, /claude plugin install keel-memory@keel/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("configured but plugin disabled -> problem, with the enable fix", () => {
    const w = world(JSON.stringify([{ id: "keel-memory@keel", enabled: false }]));
    const r = doctor(w);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /keel-memory plugin is disabled/);
    assert.match(r.stdout, /claude plugin enable keel-memory@keel/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("configured but the notes directory is gone -> problem, with mkdir fix", () => {
    const w = world(JSON.stringify([{ id: "keel-memory@keel", enabled: true }]));
    rmSync(join(w.root, "notes"), { recursive: true, force: true });
    const r = doctor(w);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /notes directory does not exist/);
    assert.match(r.stdout, /mkdir -p/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("claude CLI unreachable -> unknown, not a problem", () => {
    const w = world("[]");
    // Break the stub so `plugin list` fails; doctor must fail soft.
    writeFileSync(join(w.bin, "claude"), "#!/bin/sh\nexit 1\n");
    chmodSync(join(w.bin, "claude"), 0o755);
    const r = doctor(w);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /plugin state unknown/);
    rmSync(w.root, { recursive: true, force: true });
  });
});

/**
 * The activity log fails silently by design — the hook swallows write errors so
 * a broken directory can never break a session. That makes doctor the only place
 * the failure can surface, and it was not looking. A dead symlink after a sync,
 * or a read-only mount, otherwise costs weeks of capture with nothing to notice.
 */
describe("doctor probes that the activity log is actually writable", () => {
  test("writable directory -> reported green", () => {
    const w = world(JSON.stringify([{ id: "keel-memory@keel", enabled: true }]));
    const r = doctor(w);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /activity log writable/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("read-only directory -> problem, not 'all good'", () => {
    const w = world(JSON.stringify([{ id: "keel-memory@keel", enabled: true }]));
    const ro = join(w.root, "readonly");
    mkdirSync(ro);
    chmodSync(ro, 0o555);
    const r = doctor(w, { KEEL_ACTIVITY_DIR: ro });
    chmodSync(ro, 0o755); // so cleanup can remove it
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /activity log is NOT writable/);
    assert.doesNotMatch(r.stdout, /all good/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("path occupied by a regular file -> problem", () => {
    const w = world(JSON.stringify([{ id: "keel-memory@keel", enabled: true }]));
    const notADir = join(w.root, "not-a-dir");
    writeFileSync(notADir, "");
    const r = doctor(w, { KEEL_ACTIVITY_DIR: notADir });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /activity log is NOT writable/);
    rmSync(w.root, { recursive: true, force: true });
  });
});

/**
 * doctor said "all good" on a machine running a CLI fourteen commits behind.
 * It checked the activity log, the adapters and the plugin roster — everything
 * except itself. The PATH symlink pointed into the plugin cache at a version
 * directory an update had left behind, so it resolved cleanly and ran old code,
 * and resolving is what every other check mistook for health.
 */
describe("doctor checks which keel is running", () => {
  function installedWorld({ installVersion = "0.2.0" } = {}) {
    const w = world(JSON.stringify([{ id: "keel-memory@keel", enabled: true }]));
    const home = join(w.root, "home");
    mkdirSync(home);
    const cache = join(w.cfg, "plugins", "cache", "keel", "keel");
    const copies = {};
    for (const v of ["0.1.0", "0.2.0"]) {
      mkdirSync(join(cache, v, "bin"), { recursive: true });
      copies[v] = join(cache, v, "bin", "keel");
      copyFileSync(KEEL, copies[v]);
      chmodSync(copies[v], 0o755);
    }
    writeFileSync(
      join(w.cfg, "plugins", "installed_plugins.json"),
      JSON.stringify({
        plugins: { "keel@keel": [{ installPath: join(cache, installVersion), gitCommitSha: "abc1234deadbeef" }] },
      }),
    );
    return { ...w, home, cache, copies };
  }

  const runFrom = (w, script) =>
    spawnSync(process.execPath, [script, "doctor"], {
      encoding: "utf-8",
      env: { ...process.env, PATH: `${w.bin}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: w.cfg, HOME: w.home },
    });

  test("running the installed copy -> green, with the commit", () => {
    const w = installedWorld();
    const r = runFrom(w, w.copies["0.2.0"]);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /running the installed keel/);
    assert.match(r.stdout, /abc1234/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("running a version the install record doesn't name -> problem, not 'all good'", () => {
    const w = installedWorld({ installVersion: "0.2.0" });
    const r = runFrom(w, w.copies["0.1.0"]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /running a stale copy/);
    assert.doesNotMatch(r.stdout, /all good/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("a stale PATH symlink is a problem even when the running copy is right", () => {
    const w = installedWorld({ installVersion: "0.2.0" });
    const link = join(w.home, ".local", "bin", "keel");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(w.copies["0.1.0"], link);
    const r = runFrom(w, w.copies["0.2.0"]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /points at a stale copy/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("a dangling PATH symlink is a problem", () => {
    const w = installedWorld();
    const link = join(w.home, ".local", "bin", "keel");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(join(w.cache, "0.9.9", "bin", "keel"), link);
    const r = runFrom(w, w.copies["0.2.0"]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /dangling/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("a shim on PATH is never stale — that is the point of it", () => {
    const w = installedWorld();
    const link = join(w.home, ".local", "bin", "keel");
    mkdirSync(dirname(link), { recursive: true });
    writeFileSync(link, "#!/bin/sh\n# keel-path-shim v1\n");
    chmodSync(link, 0o755);
    const r = runFrom(w, w.copies["0.2.0"]);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /all good/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("a checkout outside the plugin cache is not called stale", () => {
    const w = installedWorld();
    const r = runFrom(w, KEEL);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /outside the plugin cache/);
    assert.doesNotMatch(r.stdout, /stale/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("no install record -> can't tell, which is not a problem", () => {
    const w = world(JSON.stringify([{ id: "keel-memory@keel", enabled: true }]));
    const r = doctor(w);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /no plugin install record/);
    rmSync(w.root, { recursive: true, force: true });
  });
});

/**
 * doctor reported "Reflection (Hindsight) — not configured" on a machine where
 * Hindsight was demonstrably working — recall and reflect had both been used
 * minutes before. Both statements were true: keel's own adapter was cut before
 * v0.1 and never shipped, while the instance was wired straight into Claude
 * Code as an MCP server that keel never looked for. Reporting only on the parts
 * keel owns, phrased as the whole picture, is how a verify command teaches you
 * to stop believing it.
 *
 * Scope carries most of the value. `claude mcp add` defaults to local scope, so
 * a server added from $HOME is connected, healthy, listed — and invisible in
 * every repo you actually work in, with no error raised anywhere.
 */
describe("doctor sees a backend wired outside keel", () => {
  const enabled = JSON.stringify([{ id: "keel-memory@keel", enabled: true }]);
  const url = "https://hindsight.example.ts.net/mcp/personal/";

  test("no MCP wiring -> still reports not configured", () => {
    const w = world(enabled, { mcpServers: { atlassian: { url: "https://mcp.atlassian.com/v1/mcp" } } });
    const r = doctor(w);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /Reflection \(Hindsight\) — not configured/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("user scope -> reported as wired, and not as keel's doing", () => {
    const w = world(enabled, { mcpServers: { hindsight: { type: "http", url } } });
    const r = doctor(w);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /wired as an MCP server, outside keel/);
    assert.match(r.stdout, /hindsight\.example\.ts\.net/);
    assert.doesNotMatch(r.stdout, /not configured/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("the host is shown but the bank path is not — doctor output gets pasted", () => {
    const w = world(enabled, { mcpServers: { hindsight: { type: "http", url } } });
    const r = doctor(w);
    assert.doesNotMatch(r.stdout, /mcp\/personal/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("project scope -> flagged, with the project named and a widening fix", () => {
    const w = world(enabled, {
      projects: { "/home/someone": { mcpServers: { hindsight: { type: "http", url } } } },
    });
    const r = doctor(w);
    assert.match(r.stdout, /only for one project/);
    assert.match(r.stdout, /\/home\/someone/);
    assert.match(r.stdout, /--scope user/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("project scope is not a failure — narrow scoping can be deliberate", () => {
    const w = world(enabled, {
      projects: { "/home/someone": { mcpServers: { hindsight: { type: "http", url } } } },
    });
    const r = doctor(w);
    assert.equal(r.status, 0, r.stdout);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("a user-scope entry wins over a project-scope one", () => {
    const w = world(enabled, {
      mcpServers: { hindsight: { type: "http", url } },
      projects: { "/home/someone": { mcpServers: { hindsight: { type: "http", url } } } },
    });
    const r = doctor(w);
    assert.match(r.stdout, /outside keel/);
    assert.doesNotMatch(r.stdout, /only for one project/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("matched on the URL too, not just a server named 'hindsight'", () => {
    const w = world(enabled, { mcpServers: { brain: { type: "http", url } } });
    const r = doctor(w);
    assert.match(r.stdout, /wired as an MCP server/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("an unreadable ~/.claude.json is not a failure", () => {
    const w = world(enabled);
    writeFileSync(join(w.root, ".claude.json"), "{ not json");
    const r = doctor(w);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /not configured/);
    rmSync(w.root, { recursive: true, force: true });
  });
});

/**
 * The mapping check: doctor asks Basic Memory where notes actually land.
 * Field incident, 2026-07-30: both of the adapter's projects pointed into a
 * session tmpdir while doctor said "all good" — the env var's directory
 * existed, and nothing checked that the adapter had a project there. A reboot
 * would have taken the notes with it.
 */
describe("doctor checks the adapter's project mapping, not just the directory", () => {
  const enabled = JSON.stringify([{ id: "keel-memory@keel", enabled: true }]);

  function uvxSays(w, body) {
    writeFileSync(
      join(w.bin, "uvx"),
      `#!/bin/sh\nif [ "$1 $2 $3" = "basic-memory project list" ]; then printf '%s' '${body.replace(/'/g, "'\\''")}'; exit 0; fi\nexit 0\n`,
    );
    chmodSync(join(w.bin, "uvx"), 0o755);
  }

  test("a project at the notes home (stated via ~) -> all good", () => {
    const w = world(enabled);
    uvxSays(w, JSON.stringify({ projects: [{ name: "main", local_path: "~/notes" }] }));
    const r = doctor(w);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /all good/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("projects exist but none at the notes home -> problem, with the move fix", () => {
    const w = world(enabled);
    uvxSays(w, JSON.stringify({ projects: [{ name: "main", local_path: "/tmp/somewhere-else" }] }));
    const r = doctor(w);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /notes are landing at/);
    assert.match(r.stdout, /basic-memory project move main/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("no projects at all -> problem, with the add fix", () => {
    const w = world(enabled);
    uvxSays(w, JSON.stringify({ projects: [] }));
    const r = doctor(w);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /no projects at all/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("a CLI that answers garbage fails open — a skipped check is not a problem", () => {
    const w = world(enabled);
    uvxSays(w, "not json at all");
    const r = doctor(w);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /all good/);
    rmSync(w.root, { recursive: true, force: true });
  });
});
