/**
 * install.sh reset contract tests. Run: node --test
 *
 * The reset step moves the whole config dir aside. The plugin registry lives
 * INSIDE that dir; the flag saying the official marketplace has already been
 * auto-installed lives OUTSIDE it, in ~/.claude.json. Getting only half of that
 * right produces a machine with less than vanilla — no marketplaces, and Claude
 * Code certain there is nothing to do about it. That shipped once; these tests
 * are why it should not ship again.
 *
 * Hermetic: a stub `claude` on a temp PATH, a temp HOME, no network.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const INSTALL = join(HERE, "..", "..", "..", "scripts", "install.sh");

/** A home directory as it looks before a reset, with whatever state a case needs. */
function world({ marketplaces, claudeJson } = {}) {
  const root = mkdtempSync(join(tmpdir(), "keel-inst-"));
  const bin = join(root, "bin");
  const home = join(root, "home");
  mkdirSync(bin);
  mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
  // Every `claude` call succeeds and does nothing: the reset is what's under test.
  writeFileSync(join(bin, "claude"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "claude"), 0o755);
  if (marketplaces !== undefined) {
    writeFileSync(join(home, ".claude", "plugins", "known_marketplaces.json"), marketplaces);
  }
  if (claudeJson !== undefined) writeFileSync(join(home, ".claude.json"), claudeJson);
  return { root, bin, home };
}

function install(w, args = ["--reset", "--no-backup"]) {
  const env = { ...process.env, HOME: w.home, PATH: `${w.bin}:${process.env.PATH}` };
  // The installer derives both the config dir and its state dir from HOME.
  // An inherited value from the developer's own shell would aim the test at it.
  delete env.CLAUDE_CONFIG_DIR;
  delete env.XDG_STATE_HOME;
  const r = spawnSync("bash", [INSTALL, ...args], { encoding: "utf-8", env, stdio: ["ignore", "pipe", "pipe"] });
  // Strip colour so assertions match on text, not escape codes.
  return { ...r, out: `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "") };
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf-8"));
const carryover = (w) => {
  const d = join(w.home, ".local", "state", "keel");
  return join(d, readdirSync(d).find((n) => n.startsWith("carryover-")));
};

const TWO_MARKETPLACES = JSON.stringify({
  "claude-plugins-official": {
    source: { source: "github", repo: "anthropics/claude-plugins-official" },
    installLocation: "/somewhere/claude-plugins-official",
  },
  keel: { source: { source: "github", repo: "JimmayVV/keel" } },
  "some-private": { source: { source: "git", url: "https://git.example.com/x/mp.git" } },
});

describe("install.sh --reset and the plugin registry", () => {
  test("names every marketplace it moved aside, as a runnable add line", () => {
    const w = world({ marketplaces: TWO_MARKETPLACES });
    const { out } = install(w);
    assert.match(out, /claude plugin marketplace add anthropics\/claude-plugins-official/);
    assert.match(out, /claude plugin marketplace add https:\/\/git\.example\.com\/x\/mp\.git/);
    // keel is re-added by the installer itself two steps later — listing it would
    // be noise, and noise in this block is how the real ones get skimmed past.
    assert.doesNotMatch(out, /marketplace add JimmayVV\/keel\n.*marketplace add JimmayVV\/keel/s);
  });

  test("hands the restore to `keel migrate`, and says so at the end", () => {
    const w = world({ marketplaces: TWO_MARKETPLACES });
    const { out } = install(w);
    // Step 5 delegates rather than reimplementing the restore, so the same
    // decision stays available long after the installer has exited.
    assert.match(out, /5\. Carry over/);
    assert.match(out.split("\nDone\n").pop(), /Carry over:\s+keel migrate/);
  });

  test("without a reset there is nothing to carry over", () => {
    const w = world({ marketplaces: TWO_MARKETPLACES });
    const { out } = install(w, ["--no-reset", "--no-backup"]);
    assert.match(out, /no reset — your marketplaces and plugins are untouched/);
    assert.doesNotMatch(out.split("\nDone\n").pop(), /keel migrate/);
  });

  test("clears the official-marketplace auto-install flags, keeping the rest of ~/.claude.json", () => {
    const w = world({
      marketplaces: TWO_MARKETPLACES,
      claudeJson: JSON.stringify({
        officialMarketplaceAutoInstallAttempted: true,
        officialMarketplaceAutoInstalled: true,
        numStartups: 362,
        oauthAccount: { emailAddress: "x@y.z" },
      }),
    });
    install(w);
    const after = readJson(join(w.home, ".claude.json"));
    // Left set, these outlive the config dir and suppress the reinstall forever.
    assert.equal("officialMarketplaceAutoInstalled" in after, false);
    assert.equal("officialMarketplaceAutoInstallAttempted" in after, false);
    assert.equal(after.numStartups, 362);
    assert.deepEqual(after.oauthAccount, { emailAddress: "x@y.z" });
    // The pre-clear copy is the undo, and the Done section points at it.
    assert.equal(readJson(join(carryover(w), ".claude.json")).officialMarketplaceAutoInstalled, true);
  });

  test("a malformed ~/.claude.json is refused, not clobbered", () => {
    const w = world({ marketplaces: TWO_MARKETPLACES, claudeJson: '{"numStartups":3,,,' });
    const { out } = install(w);
    assert.equal(readFileSync(join(w.home, ".claude.json"), "utf-8"), '{"numStartups":3,,,');
    assert.match(out, /could not read/);
    assert.match(out, /marketplace add anthropics\/claude-plugins-official/);
  });

  test("a machine with nothing to carry says nothing about marketplaces", () => {
    const w = world();
    const { out } = install(w);
    assert.match(out, /reset — login and per-project memory carried over/);
    assert.doesNotMatch(out, /moved aside/);
  });

  test("--no-reset touches neither the registry nor ~/.claude.json", () => {
    const w = world({ marketplaces: TWO_MARKETPLACES, claudeJson: '{"officialMarketplaceAutoInstalled":true}' });
    const { out } = install(w, ["--no-reset", "--no-backup"]);
    assert.equal(readFileSync(join(w.home, ".claude.json"), "utf-8"), '{"officialMarketplaceAutoInstalled":true}');
    assert.equal(readFileSync(join(w.home, ".claude", "plugins", "known_marketplaces.json"), "utf-8"), TWO_MARKETPLACES);
    assert.doesNotMatch(out, /moved aside/);
  });

  test("--dry-run reads the registry in place and changes nothing", () => {
    const w = world({ marketplaces: TWO_MARKETPLACES, claudeJson: '{"officialMarketplaceAutoInstalled":true}' });
    const { out } = install(w, ["--dry-run", "--reset", "--no-backup"]);
    assert.match(out, /would clear officialMarketplaceAutoInstall\*/);
    assert.match(out, /add anthropics\/claude-plugins-official/);
    assert.equal(readFileSync(join(w.home, ".claude.json"), "utf-8"), '{"officialMarketplaceAutoInstalled":true}');
    assert.equal(existsSync(join(w.home, ".claude", "plugins", "known_marketplaces.json")), true);
  });
});
