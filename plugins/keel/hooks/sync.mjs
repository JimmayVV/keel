#!/usr/bin/env node
/**
 * sync.mjs — SessionStart / SessionEnd hook. Opt-in, off unless KEEL_DATA_DIR is set.
 *
 * The problem this solves: git already gives you an offline-first, sync-on-
 * reconnect data store. What it does not give you is *seamlessness* — somebody
 * has to run pull and push. That somebody should not be you, at the exact moment
 * you are trying to start work.
 *
 * So: pull when a session starts, push when it ends. Nothing else. This hook
 * deliberately does not resolve conflicts, rewrite history, or make any decision
 * a human would want to have made themselves. It runs the two commands you would
 * have run, and gets loud when it can't.
 *
 * Asymmetric on purpose:
 *
 *   SessionStart  bounded-synchronous. Memory has to be on disk BEFORE Claude
 *                 reads it, so an async pull would leave you one session stale —
 *                 which is precisely the bug this exists to prevent. Capped, and
 *                 rate-limited so back-to-back sessions don't each pay for it.
 *
 *   SessionEnd    fully detached. Nothing is waiting on the result, and blocking
 *                 teardown to talk to a network is how a sync tool earns a
 *                 reputation for being slow.
 *
 * Failure is never silent and never fatal. A failed sync writes sync-status.json,
 * which `keel doctor` reports. Offline is not a failure — it's Tuesday.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

const done = () => {
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
};

if (process.env.KEEL_SYNC_OFF === "1") done();

const REPO = process.env.KEEL_DATA_DIR?.trim();
if (!REPO || !existsSync(join(REPO, ".git"))) done(); // not configured — nothing to do

let event = "";
try {
  event = String(JSON.parse(readFileSync(0, "utf-8"))?.hook_event_name ?? "");
} catch {
  done(); // no parseable event — nothing to act on
}

const STATUS = join(REPO, "sync-status.json");
const LOCK = join(REPO, ".keel-sync.lock");
const STAMP = join(REPO, ".keel-last-pull");

/** Minutes between pulls. Back-to-back sessions shouldn't each pay network latency. */
const PULL_EVERY_MIN = Number(process.env.KEEL_SYNC_PULL_INTERVAL_MIN ?? 5);

/** Seconds before a network git call is abandoned. Offline must cost seconds, not minutes. */
const TIMEOUT_S = Number(process.env.KEEL_SYNC_TIMEOUT_S ?? 10);

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0", // never block waiting for credentials
  GIT_ASKPASS: "true",
  GCM_INTERACTIVE: "never",
};

function status(ok, phase, detail) {
  try {
    writeFileSync(
      STATUS,
      JSON.stringify({ ok, phase, detail: String(detail ?? "").slice(0, 500), at: new Date().toISOString() }, null, 2),
    );
  } catch { /* status reporting must never be the thing that breaks */ }
}

/** mkdir is atomic — a plain existsSync check would race two session-ends. */
function takeLock() {
  try {
    mkdirSync(LOCK);
    return true;
  } catch {
    // A lock older than five minutes is a crashed run, not a live one.
    try {
      if (Date.now() - statSync(LOCK).mtimeMs > 5 * 60_000) {
        rmSync(LOCK, { recursive: true, force: true });
        mkdirSync(LOCK);
        return true;
      }
    } catch { /* lost the race to another process — fine, it will do the work */ }
    return false;
  }
}

if (event === "SessionStart") {
  let due = true;
  try {
    due = Date.now() - statSync(STAMP).mtimeMs > PULL_EVERY_MIN * 60_000;
  } catch { /* no stamp yet — first run is due */ }
  if (!due) done();

  // --autostash so a half-finished local edit never turns a pull into a conflict
  // the user has to resolve before they can start working.
  const r = spawnSync("git", ["-C", REPO, "pull", "--rebase", "--autostash"], {
    encoding: "utf-8",
    timeout: TIMEOUT_S * 1000,
    env: GIT_ENV,
  });
  try { writeFileSync(STAMP, ""); } catch { /* stamp is an optimisation, not state */ }

  if (r.status === 0) status(true, "pull", "up to date");
  else status(false, "pull", r.stderr || r.error?.message || `exit ${r.status}`);
  done();
}

if (event === "SessionEnd") {
  if (!takeLock()) done();
  // Detached: session teardown returns immediately and this finishes on its own.
  // The lock directory is removed by the shell, so a crash mid-push still clears
  // it on the next run via the staleness check above.
  const script =
    `git -C "${REPO}" add -A && ` +
    `(git -C "${REPO}" diff --cached --quiet || git -C "${REPO}" commit -q -m "keel sync: ${new Date().toISOString()}") ; ` +
    `git -C "${REPO}" push -q ; ` +
    `rmdir "${LOCK}" 2>/dev/null`;
  try {
    const p = spawn("sh", ["-c", script], { stdio: "ignore", detached: true, env: GIT_ENV });
    p.unref();
  } catch (e) {
    rmSync(LOCK, { recursive: true, force: true });
    status(false, "push", e?.message);
  }
  done();
}

done();
