/**
 * The credential scanner. Run: node --test
 *
 * Admitted by a real exposure on 2026-09-17: a session ran
 * `ssh <nas> "midclt call mail.config"` and TrueNAS returned its SendGrid API
 * key in plaintext with the config. The PreToolUse guard could not have caught
 * it — no secret path in the command, no exfiltration shape — because whether
 * that command prints a credential depends on the remote machine's state.
 *
 * Three properties carry this hook, and all three are failure modes that make
 * it worse than nothing if they break:
 *   1. it flags the shape that actually happened
 *   2. it never re-emits the value it found, anywhere
 *   3. it does not cry wolf at documentation and placeholders
 *
 * No secret in this file is real. Where a token needs to look convincing it is
 * assembled from pieces, so this file does not trip other scanners.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "..", "hooks", "credential-scan.mjs");
const KEEL = join(HERE, "..", "bin", "keel");

/** A syntactically valid, entirely fictional token of each vendor's shape. */
const FAKE = {
  sendgrid: ["SG", ".", "aB3dEfGhIjKlMnOp", ".", "qR5tUvWxYz0123456789AbCdEf"].join(""),
  github: "gh" + "p_" + "aB3dEfGhIjKlMnOpQrStUvWxYz0123456789",
  anthropic: "sk-" + "ant-" + "api03-aB3dEfGhIjKlMnOpQrStUvWx",
  aws: "AKIA" + "QRSTUVWX2345YZ67",
  slack: "xox" + "b-" + "123456789012-abcdefghijklmnop",
  // Exactly 35 characters after the prefix, as Google issues them. An earlier
  // 36-char fake matched nothing, which made the "never re-emits it" test for
  // this vendor pass because nothing was ever detected.
  gcp: "AIza" + "aB3dEfGhIjKlMnOpQrStUvWxYz012345678",
  pem: "-----BEGIN RSA PRIVATE KEY-----",
  dburl: "postgres://svc_user:n0tAr3alP4ssw0rd@db.internal:5432/app",
};

function run(payload, env = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    timeout: 10000,
    env: { ...process.env, KEEL_CREDSCAN_PROBE: "1", ...env },
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout || "{}");
  } catch { /* left null so a caller can assert on it */ }
  return { ...r, json, all: r.stdout || "" };
}

const bash = (stdout, command = "echo hi") => ({
  hook_event_name: "PostToolUse",
  tool_name: "Bash",
  session_id: "test1234",
  tool_input: { command },
  tool_response: { stdout },
});

describe("it catches the exposure that admitted it", () => {
  test("a SendGrid key in ssh output is flagged, and the user is told to rotate", () => {
    const r = run(bash(
      `{"fromemail": "a@b.com", "user": "apikey", "pass": "${FAKE.sendgrid}"}`,
      'ssh -o BatchMode=yes jimmy@192.168.68.90 "midclt call mail.config"',
    ));
    assert.equal(r.status, 0);
    assert.match(r.json.systemMessage, /SendGrid/);
    assert.match(r.json.systemMessage, /Rotate it/);
    // The honest limit has to be stated to the user, not just in a comment.
    assert.match(r.json.systemMessage, /notice, not a block/);
  });

  test("the model is told not to echo it or authenticate with it", () => {
    const r = run(bash(`pass=${FAKE.sendgrid}`));
    const ctx = r.json.hookSpecificOutput.additionalContext;
    assert.match(ctx, /Do NOT repeat, echo, quote, or copy the value/);
    assert.match(ctx, /even to test whether it is still valid/);
    assert.equal(r.json.hookSpecificOutput.hookEventName, "PostToolUse");
  });
});

describe("it never re-emits what it found", () => {
  /**
   * The one unforgivable bug. The value is already in context once; a hook that
   * quotes it into its own output has doubled the exposure and written it
   * somewhere a later summariser is more likely to copy.
   */
  for (const [vendor, token] of Object.entries(FAKE)) {
    test(`the ${vendor} value appears nowhere in the hook's output`, () => {
      const r = run(bash(`credential: ${token}`));
      assert.ok(r.json, `no JSON from the hook: ${r.all.slice(0, 200)}`);
      const secretTail = token.slice(-14);
      assert.ok(
        !r.all.includes(secretTail),
        `the hook echoed the credential body (…${secretTail})`,
      );
    });
  }

  test("the masked hint keeps the brand and drops the body", () => {
    const r = run(bash(`token: ${FAKE.github}`));
    // `ghp_` identifies it; the 36 characters after it must not be there.
    assert.match(r.json.systemMessage, /gh.?p_…\[\d+ chars\]/);
    assert.ok(!r.json.systemMessage.includes(FAKE.github.slice(4, 14)));
  });
});

describe("it does not cry wolf", () => {
  const benign = {
    "AWS's own documented example key": "AKIAIOSFODNN7EXAMPLE",
    "an obvious placeholder": "sk-ant-api03-xxxxxxxx",
    "an angle-bracket template": "AIza<YOUR_API_KEY_HERE>",
    "a masked value": "SG.****************.****************",
    "a git commit sha": "commit 9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c",
    "a plain UUID": "550e8400-e29b-41d4-a716-446655440000",
    "an unremarkable config dump": '{"port": 587, "security": "TLS", "smtp": true}',
    "a sha256 digest": "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  };
  for (const [what, text] of Object.entries(benign)) {
    test(`${what} is not flagged`, () => {
      const r = run(bash(text));
      assert.equal(r.status, 0);
      assert.equal(r.json.systemMessage, undefined, `flagged: ${r.all.slice(0, 200)}`);
    });
  }
});

describe("the audit record is a rotation to-do, never a second copy of the secret", () => {
  function world() {
    const root = mkdtempSync(join(tmpdir(), "keel-cred-"));
    mkdirSync(join(root, "activity"), { recursive: true });
    return { root, dir: join(root, "activity") };
  }
  const readLog = (dir) =>
    readdirSync(dir)
      .filter((f) => f.startsWith("security-"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("");

  test("it records the vendor, the tool and the command — and not the value", () => {
    const w = world();
    const r = run(
      bash(`pass=${FAKE.sendgrid}`, 'ssh nas "midclt call mail.config"'),
      { KEEL_CREDSCAN_PROBE: "0", KEEL_ACTIVITY_DIR: w.dir, KEEL_DEVICE: "testbox" },
    );
    assert.equal(r.status, 0);
    const log = readLog(w.dir);
    assert.match(log, /credential-exposed/);
    assert.match(log, /SendGrid/);
    assert.match(log, /midclt call mail\.config/);
    assert.ok(!log.includes(FAKE.sendgrid.slice(-14)), "the log contains the credential body");
    rmSync(w.root, { recursive: true, force: true });
  });

  test("a credential in the COMMAND is masked before the log is written", () => {
    const w = world();
    run(
      bash(`ok`, `curl -H "Authorization: Bearer ${FAKE.github}" https://api.github.com`),
      { KEEL_CREDSCAN_PROBE: "0", KEEL_ACTIVITY_DIR: w.dir },
    );
    // Nothing was in the output, so nothing is recorded at all — but if a future
    // change starts recording on command matches, the value must still be masked.
    const log = readLog(w.dir);
    assert.ok(!log.includes(FAKE.github.slice(4, 18)), "the log contains a credential from the command");
    rmSync(w.root, { recursive: true, force: true });
  });

  test("probe mode detects without recording, so the self-check leaves no false event", () => {
    const w = world();
    const r = run(bash(`pass=${FAKE.sendgrid}`), { KEEL_CREDSCAN_PROBE: "1", KEEL_ACTIVITY_DIR: w.dir });
    assert.match(r.json.systemMessage, /SendGrid/);
    assert.equal(readLog(w.dir), "");
    rmSync(w.root, { recursive: true, force: true });
  });

  test("keel log --security lists the exposure and still not the value", () => {
    const w = world();
    run(bash(`pass=${FAKE.sendgrid}`, 'ssh nas "midclt call mail.config"'),
      { KEEL_CREDSCAN_PROBE: "0", KEEL_ACTIVITY_DIR: w.dir, KEEL_DEVICE: "testbox" });
    const r = spawnSync(process.execPath, [KEEL, "log", "--security"], {
      encoding: "utf-8",
      env: { ...process.env, KEEL_ACTIVITY_DIR: w.dir },
    });
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /credential exposures/);
    assert.match(r.stdout, /SendGrid/);
    assert.ok(!r.stdout.includes(FAKE.sendgrid.slice(-14)));
    rmSync(w.root, { recursive: true, force: true });
  });
});

describe("it cannot take a session down", () => {
  test("unparseable stdin is a no-op, not a crash", () => {
    const r = spawnSync(process.execPath, [HOOK], { input: "not json at all", encoding: "utf-8" });
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /systemMessage/);
  });

  test("a bare-string tool_response is still scanned", () => {
    // tool_response is documented as an object, but arrives as a string often
    // enough that assuming one shape would make the hook silently blind.
    const r = run({ hook_event_name: "PostToolUse", tool_name: "Read", tool_response: `key=${FAKE.gcp}` });
    assert.match(r.json.systemMessage, /Google API key/);
  });

  test("an unwritable activity dir does not stop the warning", () => {
    // A read-only directory, not a /proc path: mkdirSync under /proc hangs on
    // WSL, which would test the platform rather than the hook. The property
    // under test is that the notice is emitted before the log is touched.
    const root = mkdtempSync(join(tmpdir(), "keel-cred-ro-"));
    const dir = join(root, "locked");
    mkdirSync(dir);
    chmodSync(dir, 0o500);
    const r = run(bash(`pass=${FAKE.sendgrid}`), {
      KEEL_CREDSCAN_PROBE: "0",
      KEEL_ACTIVITY_DIR: join(dir, "activity"),
    });
    assert.equal(r.status, 0);
    assert.match(r.json.systemMessage, /SendGrid/);
    chmodSync(dir, 0o700);
    rmSync(root, { recursive: true, force: true });
  });

  test("the off switch silences it completely", () => {
    const r = run(bash(`pass=${FAKE.sendgrid}`), { KEEL_CREDSCAN_OFF: "1" });
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.all, /SendGrid/);
  });
});

describe("the hook is actually registered on the tools that can leak", () => {
  test("hooks.json runs it on PostToolUse for Bash and Read", () => {
    const hooks = JSON.parse(readFileSync(join(HERE, "..", "hooks", "hooks.json"), "utf8"));
    const entry = hooks.hooks.PostToolUse.find((e) =>
      e.hooks.some((h) => h.command.includes("credential-scan.mjs")),
    );
    assert.ok(entry, "credential-scan.mjs is not registered on PostToolUse");
    // A hook that exists but matches nothing is the failure this catches.
    assert.match(entry.matcher, /Bash/);
    assert.match(entry.matcher, /Read/);
  });
});
