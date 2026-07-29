/**
 * `keel migrate` contract tests. Run: node --test
 *
 * Properties: it finds a config the reset moved aside, proposes only what THIS
 * machine is missing, restores nothing unless told to, adds marketplaces before
 * the plugins that depend on them, and preserves scope and disabled state.
 * Hermetic: a stub `claude` on a temp PATH records every invocation.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const KEEL = join(HERE, "..", "bin", "keel");

const OLD_REGISTRY = {
  "claude-plugins-official": { source: { source: "github", repo: "anthropics/claude-plugins-official" } },
  "some-private": { source: { source: "git", url: "https://git.example.com/x/mp.git" } },
};
const OLD_SETTINGS = {
  enabledPlugins: {
    "code-review@claude-plugins-official": true,
    "typescript-lsp@claude-plugins-official": false,
    "thing@some-private": true,
  },
};
const OLD_INSTALLED = {
  version: 2,
  plugins: {
    "code-review@claude-plugins-official": [{ scope: "user", version: "1.0.0" }],
    "typescript-lsp@claude-plugins-official": [{ scope: "project", version: "1.0.0" }],
    "thing@some-private": [{ scope: "user", version: "0.1.0" }],
  },
};

/**
 * A world with a moved-aside config under XDG state, an empty live config, and a
 * stub `claude` that records calls. `failOn` makes one call exit non-zero.
 */
function world({ registry = OLD_REGISTRY, settings = OLD_SETTINGS, installed = OLD_INSTALLED, live = {}, failOn = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "keel-mig-"));
  const bin = join(root, "bin");
  const cfg = join(root, "cfg");
  const home = join(root, "home");
  const state = join(root, "state");
  const src = join(state, "keel", "previous-config-20260727-124417");
  mkdirSync(bin);
  mkdirSync(join(cfg, "plugins"), { recursive: true });
  mkdirSync(home);
  mkdirSync(join(src, "plugins"), { recursive: true });

  const log = join(root, "calls.log");
  const guard = failOn ? `case "$*" in ${failOn}) exit 1 ;; esac\n` : "";
  writeFileSync(join(bin, "claude"), `#!/bin/sh\necho "$@" >> '${log}'\n${guard}exit 0\n`);
  chmodSync(join(bin, "claude"), 0o755);

  const put = (p, v) => writeFileSync(p, typeof v === "string" ? v : JSON.stringify(v, null, 2));
  if (registry !== null) put(join(src, "plugins", "known_marketplaces.json"), registry);
  if (settings !== null) put(join(src, "settings.json"), settings);
  if (installed !== null) put(join(src, "plugins", "installed_plugins.json"), installed);
  // What this machine already has, if the case wants any.
  if (live.registry) put(join(cfg, "plugins", "known_marketplaces.json"), live.registry);
  if (live.installed) put(join(cfg, "plugins", "installed_plugins.json"), live.installed);
  if (live.settings) put(join(cfg, "settings.json"), live.settings);
  if (live.claudeJson !== undefined) {
    put(join(cfg, ".claude.json"), live.claudeJson);
    chmodSync(join(cfg, ".claude.json"), 0o600);
  }

  return { root, bin, cfg, home, state, src, log };
}

function migrate(w, args = []) {
  const r = spawnSync(process.execPath, [KEEL, "migrate", ...args], {
    encoding: "utf-8",
    env: {
      ...process.env,
      PATH: `${w.bin}:${process.env.PATH}`,
      CLAUDE_CONFIG_DIR: w.cfg,
      HOME: w.home,
      XDG_STATE_HOME: w.state,
    },
  });
  return { ...r, out: `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "") };
}

const calls = (w) => (existsSync(w.log) ? readFileSync(w.log, "utf-8").trim().split("\n").filter(Boolean) : []);

describe("keel migrate", () => {
  test("finds the config the reset moved aside and lists what is missing", () => {
    const w = world();
    const { out, status } = migrate(w, ["--none"]);
    assert.equal(status, 0);
    assert.match(out, /previous-config-20260727-124417/);
    assert.match(out, /marketplace\s+claude-plugins-official\s+anthropics\/claude-plugins-official/);
    assert.match(out, /marketplace\s+some-private\s+https:\/\/git\.example\.com\/x\/mp\.git/);
    assert.match(out, /plugin\s+code-review@claude-plugins-official/);
    // Disabled-before is shown, because restoring it enabled would change behaviour.
    assert.match(out, /typescript-lsp@claude-plugins-official\s+\(was disabled\)/);
  });

  test("--none restores nothing and says where the old setup still is", () => {
    const w = world();
    const { out } = migrate(w, ["--none"]);
    assert.deepEqual(calls(w), []);
    assert.match(out, /nothing restored/);
    assert.match(out, /change your mind any time/);
  });

  test("non-interactive with no mode restores nothing", () => {
    // The default is none. A scripted install must never silently un-vanilla itself.
    const w = world();
    const { out } = migrate(w);
    assert.deepEqual(calls(w), []);
    assert.match(out, /non-interactive — nothing restored/);
  });

  test("--all adds every marketplace before any plugin that needs it", () => {
    const w = world();
    const { status } = migrate(w, ["--all"]);
    assert.equal(status, 0);
    const c = calls(w);
    const lastMarket = c.map((l) => l.startsWith("plugin marketplace add")).lastIndexOf(true);
    const firstInstall = c.findIndex((l) => l.startsWith("plugin install"));
    assert.ok(lastMarket < firstInstall, `marketplaces must precede installs, got:\n${c.join("\n")}`);
    assert.ok(c.includes("plugin marketplace add anthropics/claude-plugins-official"));
    assert.ok(c.includes("plugin marketplace add https://git.example.com/x/mp.git"));
  });

  test("--all preserves each plugin's original scope", () => {
    const w = world();
    migrate(w, ["--all"]);
    const c = calls(w);
    assert.ok(c.includes("plugin install code-review@claude-plugins-official --scope user"));
    assert.ok(c.includes("plugin install typescript-lsp@claude-plugins-official --scope project"));
  });

  test("a plugin that was disabled is re-disabled after install", () => {
    const w = world();
    migrate(w, ["--all"]);
    const c = calls(w);
    const i = c.indexOf("plugin install typescript-lsp@claude-plugins-official --scope project");
    assert.ok(i >= 0);
    assert.equal(c[i + 1], "plugin disable typescript-lsp@claude-plugins-official");
    // ...and one that was enabled is left alone.
    assert.ok(!c.some((l) => l === "plugin disable code-review@claude-plugins-official"));
  });

  test("proposes only what this machine is missing", () => {
    const w = world({
      live: {
        registry: { "claude-plugins-official": { source: { source: "github", repo: "anthropics/claude-plugins-official" } } },
        installed: { version: 2, plugins: { "code-review@claude-plugins-official": [{ scope: "user" }] } },
      },
    });
    const { out } = migrate(w, ["--all"]);
    const c = calls(w);
    assert.ok(!c.includes("plugin marketplace add anthropics/claude-plugins-official"));
    assert.ok(!c.some((l) => l.includes("install code-review@")));
    // The ones it does not have are still offered.
    assert.ok(c.includes("plugin marketplace add https://git.example.com/x/mp.git"));
    assert.ok(c.some((l) => l.includes("install typescript-lsp@")));
    assert.doesNotMatch(out, /nothing to do/);
  });

  test("re-running after a full restore is a no-op", () => {
    const w = world({
      live: {
        registry: OLD_REGISTRY,
        installed: { version: 2, plugins: Object.fromEntries(Object.keys(OLD_INSTALLED.plugins).map((k) => [k, [{ scope: "user" }]])) },
      },
    });
    const { out, status } = migrate(w, ["--all"]);
    assert.equal(status, 0);
    assert.deepEqual(calls(w), []);
    assert.match(out, /already installed here — nothing to do/);
  });

  test("a marketplace declared only in settings is still offered", () => {
    // Added but never fetched: it exists in extraKnownMarketplaces and not in the registry.
    const w = world({
      registry: {},
      settings: { extraKnownMarketplaces: { ghost: { source: { source: "github", repo: "o/ghost" } } }, enabledPlugins: {} },
      installed: null,
    });
    migrate(w, ["--all"]);
    assert.ok(calls(w).includes("plugin marketplace add o/ghost"));
  });

  test("a marketplace with no usable source is flagged, not guessed at", () => {
    const w = world({
      registry: { broken: { installLocation: "/gone/broken" } },
      settings: { enabledPlugins: {} },
      installed: null,
    });
    const { out } = migrate(w, ["--all"]);
    // installLocation pointed inside the moved config dir — re-adding from it
    // would clone from a path that no longer exists.
    assert.match(out, /no usable source recorded/);
    assert.deepEqual(calls(w), []);
  });

  test("a plugin whose marketplace cannot be restored is skipped, not failed", () => {
    const w = world({
      registry: { broken: { installLocation: "/gone" } },
      settings: { enabledPlugins: { "orphan@broken": true } },
      installed: { version: 2, plugins: { "orphan@broken": [{ scope: "user" }] } },
    });
    const { status } = migrate(w, ["--all"]);
    assert.ok(!calls(w).some((l) => l.includes("orphan@broken")));
    assert.equal(status, 0);
  });

  test("a failed add is reported with the manual command, and exits 1", () => {
    const w = world({ failOn: '"plugin marketplace add https://git.example.com/x/mp.git"' });
    const { out, status } = migrate(w, ["--all"]);
    assert.equal(status, 1);
    assert.match(out, /add it by hand: claude plugin marketplace add https:\/\/git\.example\.com\/x\/mp\.git/);
    assert.match(out, /1 failed/);
    // The failure is contained: the other marketplace still went in.
    assert.ok(calls(w).includes("plugin marketplace add anthropics/claude-plugins-official"));
  });

  test("--pick without a terminal refuses rather than restoring everything", () => {
    // Every prompt would take its [Y/n] default, silently turning an explicit
    // "let me choose" into "restore the lot".
    const w = world();
    const { out, status } = migrate(w, ["--pick"]);
    assert.equal(status, 1);
    assert.deepEqual(calls(w), []);
    assert.match(out, /--pick needs a terminal/);
  });

  test("--dry-run prints the plan and runs nothing", () => {
    const w = world();
    const { out } = migrate(w, ["--all", "--dry-run"]);
    assert.deepEqual(calls(w), []);
    assert.match(out, /would run: claude plugin marketplace add anthropics\/claude-plugins-official/);
    assert.match(out, /would run: claude plugin install code-review@claude-plugins-official --scope user/);
  });

  test("no previous config anywhere is a clean exit, not an error", () => {
    const w = world();
    const r = spawnSync(process.execPath, [KEEL, "migrate", "--all"], {
      encoding: "utf-8",
      env: { ...process.env, PATH: `${w.bin}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: w.cfg, HOME: w.home, XDG_STATE_HOME: join(w.root, "empty") },
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /no previous config found/);
  });

  test("--from points at a config the finder would not have found", () => {
    const w = world();
    const { out } = migrate(w, ["--from", w.src, "--none"]);
    assert.match(out, /previous-config-20260727-124417/);
    assert.match(out, /marketplace\s+claude-plugins-official/);
  });

  test("malformed JSON in the old config costs that file, not the command", () => {
    const w = world({ settings: "{not json,,," });
    const { out, status } = migrate(w, ["--all"]);
    assert.equal(status, 0);
    assert.match(out, /is not valid JSON — skipping it/);
    // The registry still parsed, so its marketplaces are still restorable.
    assert.ok(calls(w).includes("plugin marketplace add anthropics/claude-plugins-official"));
  });
});

/**
 * The flag repair. Distinct from everything above: it puts back nothing the old
 * config had, it undoes a state no vanilla install can be in — the official
 * marketplace absent while Claude Code's own guard is convinced it is present.
 */
describe("keel migrate — the suppressed official marketplace", () => {
  // An old config that never mentioned the official marketplace, so restoring
  // from it cannot put one back and the flag is the only route.
  const NO_OFFICIAL = { "some-private": { source: { source: "git", url: "https://git.example.com/x/mp.git" } } };
  const SUPPRESSED = {
    officialMarketplaceAutoInstallAttempted: true,
    officialMarketplaceAutoInstalled: true,
    numStartups: 362,
    oauthAccount: { emailAddress: "x@y.z" },
  };

  test("is offered when the marketplace is gone and the flag says otherwise", () => {
    const w = world({ registry: NO_OFFICIAL, settings: { enabledPlugins: {} }, installed: null, live: { claudeJson: SUPPRESSED } });
    const { out } = migrate(w, ["--none"]);
    assert.match(out, /repair\s+claude-plugins-official is missing/);
  });

  test("--all clears the flags and leaves the rest of the file alone", () => {
    const w = world({ registry: NO_OFFICIAL, settings: { enabledPlugins: {} }, installed: null, live: { claudeJson: SUPPRESSED } });
    const { out, status } = migrate(w, ["--all"]);
    assert.equal(status, 0);
    const after = JSON.parse(readFileSync(join(w.cfg, ".claude.json"), "utf-8"));
    assert.equal("officialMarketplaceAutoInstalled" in after, false);
    assert.equal("officialMarketplaceAutoInstallAttempted" in after, false);
    assert.equal(after.numStartups, 362);
    assert.deepEqual(after.oauthAccount, { emailAddress: "x@y.z" });
    assert.match(out, /cleared officialMarketplaceAutoInstall/);
    // Written by temp-and-rename, with the mode carried over.
    assert.equal(existsSync(join(w.cfg, ".claude.json.keel-tmp")), false);
    assert.equal(statSync(join(w.cfg, ".claude.json")).mode & 0o777, 0o600);
  });

  test("is NOT offered when the run is already going to re-add the marketplace", () => {
    // Otherwise it is the same question twice, and a "no" to the marketplace
    // followed by a "yes" here would resurrect what was just declined.
    const w = world({ live: { claudeJson: SUPPRESSED } });
    const { out } = migrate(w, ["--none"]);
    assert.doesNotMatch(out, /repair/);
  });

  test("is not offered when the marketplace is actually present", () => {
    const w = world({
      registry: NO_OFFICIAL,
      settings: { enabledPlugins: {} },
      installed: null,
      live: { registry: { "claude-plugins-official": { source: { source: "github", repo: "anthropics/claude-plugins-official" } } }, claudeJson: SUPPRESSED },
    });
    const { out } = migrate(w, ["--none"]);
    assert.doesNotMatch(out, /repair/);
  });

  test("a failed attempt is left alone — it retries on its own", () => {
    const w = world({
      registry: NO_OFFICIAL,
      settings: { enabledPlugins: {} },
      installed: null,
      live: { claudeJson: { officialMarketplaceAutoInstallAttempted: true, officialMarketplaceAutoInstalled: false, officialMarketplaceAutoInstallFailReason: "git_unavailable", officialMarketplaceAutoInstallRetryCount: 2 } },
    });
    const { out } = migrate(w, ["--all"]);
    assert.doesNotMatch(out, /repair/);
    const after = JSON.parse(readFileSync(join(w.cfg, ".claude.json"), "utf-8"));
    assert.equal(after.officialMarketplaceAutoInstallRetryCount, 2);
  });

  test("policy_blocked is a decision, not damage", () => {
    // Clearing it would only have it re-blocked on the next start.
    const w = world({
      registry: NO_OFFICIAL,
      settings: { enabledPlugins: {} },
      installed: null,
      live: { claudeJson: { officialMarketplaceAutoInstallAttempted: true, officialMarketplaceAutoInstalled: true, officialMarketplaceAutoInstallFailReason: "policy_blocked" } },
    });
    const { out } = migrate(w, ["--all"]);
    assert.doesNotMatch(out, /repair/);
    const after = JSON.parse(readFileSync(join(w.cfg, ".claude.json"), "utf-8"));
    assert.equal(after.officialMarketplaceAutoInstalled, true);
  });

  test("--none leaves it suppressed but prints the manual fix", () => {
    const w = world({ registry: NO_OFFICIAL, settings: { enabledPlugins: {} }, installed: null, live: { claudeJson: SUPPRESSED } });
    const { out } = migrate(w, ["--none"]);
    const after = JSON.parse(readFileSync(join(w.cfg, ".claude.json"), "utf-8"));
    assert.equal(after.officialMarketplaceAutoInstalled, true);
    assert.match(out, /still suppressed — fix with:\s+claude plugin marketplace add anthropics\/claude-plugins-official/);
  });

  test("repairs a machine whose previous config is long gone", () => {
    // The realistic already-broken machine months later: it ran the old reset,
    // the moved-aside config has since been deleted, and nothing else can fix it.
    const w = world({ live: { claudeJson: SUPPRESSED } });
    const r = spawnSync(process.execPath, [KEEL, "migrate", "--all"], {
      encoding: "utf-8",
      env: { ...process.env, PATH: `${w.bin}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: w.cfg, HOME: w.home, XDG_STATE_HOME: join(w.root, "empty") },
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /still needs one repair/);
    const after = JSON.parse(readFileSync(join(w.cfg, ".claude.json"), "utf-8"));
    assert.equal("officialMarketplaceAutoInstalled" in after, false);
  });

  test("--dry-run reports the repair without writing it", () => {
    const w = world({ registry: NO_OFFICIAL, settings: { enabledPlugins: {} }, installed: null, live: { claudeJson: SUPPRESSED } });
    const { out } = migrate(w, ["--all", "--dry-run"]);
    assert.match(out, /would clear officialMarketplaceAutoInstall/);
    const after = JSON.parse(readFileSync(join(w.cfg, ".claude.json"), "utf-8"));
    assert.equal(after.officialMarketplaceAutoInstalled, true);
  });

  test("a healthy machine with no previous config still says nothing", () => {
    const w = world({ live: { claudeJson: { numStartups: 3 } } });
    const r = spawnSync(process.execPath, [KEEL, "migrate", "--all"], {
      encoding: "utf-8",
      env: { ...process.env, PATH: `${w.bin}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: w.cfg, HOME: w.home, XDG_STATE_HOME: join(w.root, "empty") },
    });
    assert.match(r.stdout, /no previous config found — nothing to migrate/);
    assert.deepEqual(calls(w), []);
  });
});

