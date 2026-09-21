/**
 * Inbox-bridge contract tests. Run: node --test
 *
 * The properties that matter:
 *   1. a file that arrived by Taildrop reaches the prompt unasked, by path
 *   2. nothing arrived means silence — this runs on every turn, so the quiet
 *      case is the common case and must cost nothing and say nothing
 *   3. no tailscale, no tailnet, a hung CLI, an unwritable inbox: the turn
 *      still proceeds. A convenience must never be able to fail a prompt
 *   4. `keel send` degrades Taildrop → scp → printed instructions, and always
 *      names which rung it used, because a silent success over an unexpected
 *      path sends you debugging the wrong machine
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "..", "hooks", "inbox-drain.mjs");
const CLI = join(HERE, "..", "bin", "keel");

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "keel-inbox-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  return { root, bin };
}

/** A stand-in for a third-party CLI, so the tests never touch a real tailnet. */
function fakeBin(dir, name, body) {
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

function runHook({ root, bin }, env = {}) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "what is in this screenshot?" }),
    encoding: "utf-8",
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: root,
      ...env,
    },
  });
  assert.equal(res.status, 0, `hook exited ${res.status}: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

function context(out) {
  return out.hookSpecificOutput?.additionalContext ?? "";
}

describe("inbox-drain hook", () => {
  test("a file that arrived is named by absolute path", () => {
    const sb = sandbox();
    const inbox = join(sb.root, "inbox");
    mkdirSync(inbox);
    fakeBin(sb.bin, "tailscale", `touch "${inbox}/shot.png"`);

    const out = runHook(sb, { KEEL_INBOX_DIR: inbox });
    assert.equal(out.continue, true);
    assert.match(context(out), /shot\.png/);
    assert.match(context(out), new RegExp(inbox.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    rmSync(sb.root, { recursive: true, force: true });
  });

  test("nothing new means no context at all", () => {
    const sb = sandbox();
    const inbox = join(sb.root, "inbox");
    mkdirSync(inbox);
    writeFileSync(join(inbox, "old.png"), "x");
    fakeBin(sb.bin, "tailscale", "exit 0");

    const out = runHook(sb, { KEEL_INBOX_DIR: inbox });
    assert.equal(out.continue, true);
    assert.equal(out.hookSpecificOutput, undefined);
    rmSync(sb.root, { recursive: true, force: true });
  });

  test("no tailscale installed is the quiet case, not an error", () => {
    const sb = sandbox(); // empty fake bin dir: `tailscale` is absent
    const out = runHook(sb, { KEEL_INBOX_DIR: join(sb.root, "inbox") });
    assert.equal(out.continue, true);
    assert.equal(out.hookSpecificOutput, undefined);
    rmSync(sb.root, { recursive: true, force: true });
  });

  test("a hung tailscale is bounded and the turn still proceeds", () => {
    const sb = sandbox();
    const inbox = join(sb.root, "inbox");
    mkdirSync(inbox);
    fakeBin(sb.bin, "tailscale", "sleep 5");

    const started = Date.now();
    const out = runHook(sb, { KEEL_INBOX_DIR: inbox, KEEL_INBOX_DEADLINE_MS: "200" });
    assert.equal(out.continue, true);
    assert.ok(Date.now() - started < 4000, "deadline did not bound the call");
    rmSync(sb.root, { recursive: true, force: true });
  });

  test("KEEL_INBOX_OFF=1 disables it without uninstalling", () => {
    const sb = sandbox();
    const inbox = join(sb.root, "inbox");
    mkdirSync(inbox);
    fakeBin(sb.bin, "tailscale", `touch "${inbox}/shot.png"`);

    const out = runHook(sb, { KEEL_INBOX_DIR: inbox, KEEL_INBOX_OFF: "1" });
    assert.equal(out.continue, true);
    assert.equal(out.hookSpecificOutput, undefined);
    assert.equal(readdirSync(inbox).length, 0, "off switch still ran the CLI");
    rmSync(sb.root, { recursive: true, force: true });
  });

  test("an inbox that cannot be created does not take the turn down", () => {
    const sb = sandbox();
    const locked = join(sb.root, "locked");
    mkdirSync(locked);
    chmodSync(locked, 0o500);
    fakeBin(sb.bin, "tailscale", "exit 0");

    const out = runHook(sb, { KEEL_INBOX_DIR: join(locked, "inbox") });
    assert.equal(out.continue, true);
    chmodSync(locked, 0o700);
    rmSync(sb.root, { recursive: true, force: true });
  });
});

function runCli(args, { root, bin }, env = {}) {
  return spawnSync(process.execPath, [CLI, "send", ...args], {
    encoding: "utf-8",
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root, ...env },
  });
}

describe("keel send", () => {
  test("a missing file is refused before any transport is tried", () => {
    const sb = sandbox();
    const r = runCli([join(sb.root, "nope.png"), "somehost"], sb);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /no such file/);
    rmSync(sb.root, { recursive: true, force: true });
  });

  test("no target and no KEEL_INBOX_TARGET names the missing input", () => {
    const sb = sandbox();
    const f = join(sb.root, "a.png");
    writeFileSync(f, "x");
    const r = runCli([f], sb);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /KEEL_INBOX_TARGET/);
    rmSync(sb.root, { recursive: true, force: true });
  });

  test("Taildrop is preferred and says so", () => {
    const sb = sandbox();
    const f = join(sb.root, "a.png");
    writeFileSync(f, "x");
    fakeBin(sb.bin, "tailscale", "exit 0");
    const r = runCli([f, "paddock"], sb);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Taildrop/);
    rmSync(sb.root, { recursive: true, force: true });
  });

  test("when Taildrop fails it falls through to scp and names that rung", () => {
    const sb = sandbox();
    const f = join(sb.root, "a.png");
    writeFileSync(f, "x");
    fakeBin(sb.bin, "tailscale", "echo 'no such host' >&2; exit 1");
    fakeBin(sb.bin, "ssh", "exit 0");
    fakeBin(sb.bin, "scp", "exit 0");
    const r = runCli([f, "paddock"], sb);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /over SSH/);
    rmSync(sb.root, { recursive: true, force: true });
  });

  test("the ssh rungs carry a host-key policy, because a prompt nobody can answer hangs the send", () => {
    // Found on real hardware 2026-09-21: `ssh -o BatchMode=yes` against a host
    // this machine had not seen waited ~70s instead of failing. BatchMode alone
    // was not enough; accept-new is what makes an unattended run terminate.
    const sb = sandbox();
    const f = join(sb.root, "a.png");
    writeFileSync(f, "x");
    const argsLog = join(sb.root, "args.txt");
    fakeBin(sb.bin, "tailscale", "exit 1");
    fakeBin(sb.bin, "ssh", `echo "ssh $@" >> "${argsLog}"; exit 0`);
    fakeBin(sb.bin, "scp", `echo "scp $@" >> "${argsLog}"; exit 0`);

    const r = runCli([f, "paddock"], sb);
    assert.equal(r.status, 0);
    const logged = readFileSync(argsLog, "utf-8");
    for (const line of logged.trim().split("\n")) {
      assert.match(line, /StrictHostKeyChecking=accept-new/, `missing host-key policy: ${line}`);
      assert.match(line, /BatchMode=yes/, `missing BatchMode: ${line}`);
    }
    rmSync(sb.root, { recursive: true, force: true });
  });

  test("when both fail the file is still reachable and the commands are printed", () => {
    const sb = sandbox();
    const f = join(sb.root, "a.png");
    writeFileSync(f, "x");
    fakeBin(sb.bin, "tailscale", "exit 1");
    fakeBin(sb.bin, "ssh", "exit 255");
    fakeBin(sb.bin, "scp", "exit 1");
    const r = runCli([f, "paddock"], sb);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /tailscale file cp/);
    assert.match(r.stdout, /scp /);
    assert.ok(r.stdout.includes(f), "the local path must survive a total failure");
    rmSync(sb.root, { recursive: true, force: true });
  });
});
