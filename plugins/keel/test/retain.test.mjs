/**
 * The retain ledger. Run: node --test
 *
 * The failure class these pin has already happened here, and is the reason the
 * ledger exists: the document-id convention lived as a sentence in a CLAUDE.md,
 * and seven weeks later one bank held 80 documents under six id shapes, three
 * notes under two ids each with the losing copy months stale, and ids typed by
 * hand that no retain could ever update.
 *
 * Two properties carry all of it:
 *   1. the id is a pure function of the path, identical on every machine
 *   2. doctor calls a duplicate a problem, loudly, without being asked
 *
 * Hermetic: a stub Hindsight on loopback, a temp HOME, stub `claude`/`uvx`.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const KEEL = join(HERE, "..", "bin", "keel");

/**
 * A stub Hindsight, in its own process.
 *
 * It has to be: the tests drive keel with spawnSync, which blocks this
 * process's event loop, so a server listening *here* could never accept the
 * child's connection — every fetch would sit until keel's own 4s deadline and
 * the suite would report a timeout as a failed assertion. The stub reads its
 * document list from a file on each request, which is also how a test changes
 * what the bank holds.
 */
let STUB;
let BASE;

const STUB_SRC = `
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const docsFile = process.argv[2];
createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const json = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  let docs = [];
  try { docs = JSON.parse(readFileSync(docsFile, "utf8")); } catch {}
  if (url.pathname === "/health") return json({ status: "healthy" });
  if (url.pathname === "/v1/default/banks") return json({ banks: [{ bank_id: "personal", fact_count: 1 }] });
  if (url.pathname === "/v1/default/banks/personal/documents") {
    const limit = Number(url.searchParams.get("limit") ?? 100);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    return json({ items: docs.slice(offset, offset + limit), total: docs.length, limit, offset });
  }
  res.writeHead(404).end("{}");
}).listen(0, "127.0.0.1", function () { console.log(this.address().port); });
`;

function setDocs(docs) {
  writeFileSync(STUB.docsFile, JSON.stringify(docs));
}

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "keel-stub-"));
  const src = join(dir, "stub.mjs");
  const docsFile = join(dir, "docs.json");
  writeFileSync(src, STUB_SRC);
  writeFileSync(docsFile, "[]");
  const proc = spawn(process.execPath, [src, docsFile], { stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("stub Hindsight did not start")), 10000);
    proc.stdout.once("data", (d) => { clearTimeout(t); resolve(String(d).trim()); });
  });
  STUB = { dir, proc, docsFile };
  BASE = `http://127.0.0.1:${port}`;
});

after(() => {
  STUB?.proc.kill();
  if (STUB?.dir) rmSync(STUB.dir, { recursive: true, force: true });
});

/**
 * A temp world with the reflect adapter wired and a memory corpus on disk.
 * `files` is a map of project slug -> [memory file names].
 */
function world(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "keel-retain-"));
  const bin = join(root, "bin");
  const cfg = join(root, "cfg");
  mkdirSync(bin);
  mkdirSync(cfg);
  writeFileSync(join(cfg, "settings.json"), JSON.stringify({ env: { KEEL_HINDSIGHT_URL: BASE, KEEL_HINDSIGHT_BANK: "personal" } }));
  writeFileSync(join(bin, "uvx"), "#!/bin/sh\nexit 0\n");
  const list = JSON.stringify([{ id: "keel-reflect@keel", enabled: true }]);
  writeFileSync(join(bin, "claude"), `#!/bin/sh\nif [ "$1 $2" = "plugin list" ]; then printf '%s' '${list}'; exit 0; fi\nexit 1\n`);
  chmodSync(join(bin, "uvx"), 0o755);
  chmodSync(join(bin, "claude"), 0o755);
  for (const [slug, names] of Object.entries(files)) {
    const dir = join(cfg, "projects", slug, "memory");
    mkdirSync(dir, { recursive: true });
    for (const n of names) writeFileSync(join(dir, n), `---\nname: ${n.replace(/\.md$/, "")}\n---\n\nbody\n`);
  }
  return { root, bin, cfg };
}

function keel(w, args, extraEnv = {}) {
  return spawnSync(process.execPath, [KEEL, ...args], {
    encoding: "utf-8",
    env: { ...process.env, PATH: `${w.bin}:${process.env.PATH}`, HOME: w.root, CLAUDE_CONFIG_DIR: w.cfg, ...extraEnv },
  });
}

const doc = (id, updated = "2030-01-01T00:00:00+00:00") => ({ id, updated_at: updated, bank_id: "personal" });

describe("keel retain-id derives the id, so no session has to remember it", () => {
  test("a memory file gets the project-relative form, with no home in it", () => {
    const w = world({ "-my-proj": ["a-note.md"] });
    const r = keel(w, ["retain-id", join(w.cfg, "projects", "-my-proj", "memory", "a-note.md")]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "projects/-my-proj/memory/a-note.md");
    assert.ok(!r.stdout.includes(w.root), "the id must not carry this machine's home");
    rmSync(w.root, { recursive: true, force: true });
  });

  test("any other file under home gets its home-relative path", () => {
    const w = world();
    mkdirSync(join(w.root, "personal", "journal", "entries"), { recursive: true });
    const f = join(w.root, "personal", "journal", "entries", "2026-09-14.md");
    writeFileSync(f, "x");
    const r = keel(w, ["retain-id", f]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "personal/journal/entries/2026-09-14.md");
    rmSync(w.root, { recursive: true, force: true });
  });

  test("a path outside home is refused, not guessed", () => {
    const w = world();
    const r = keel(w, ["retain-id", "/etc/hosts"]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /no machine-independent id/);
    rmSync(w.root, { recursive: true, force: true });
  });

  /**
   * The property the whole scheme rests on. Two machines with different homes
   * must derive one id for the same note, or they write two documents and
   * recall gets a choice nobody made.
   */
  test("two machines with different homes derive the same id", () => {
    const a = world({ "-proj": ["note.md"] });
    const b = world({ "-proj": ["note.md"] });
    const ra = keel(a, ["retain-id", join(a.cfg, "projects", "-proj", "memory", "note.md")]);
    const rb = keel(b, ["retain-id", join(b.cfg, "projects", "-proj", "memory", "note.md")]);
    assert.notEqual(a.root, b.root);
    assert.equal(ra.stdout.trim(), rb.stdout.trim());
    rmSync(a.root, { recursive: true, force: true });
    rmSync(b.root, { recursive: true, force: true });
  });
});

describe("doctor reports the ledger without being asked", () => {
  test("one note under two ids is a problem, with the audit as the fix", () => {
    const w = world({ "-proj": ["note.md"] });
    setDocs([
      doc("projects/-proj/memory/note.md"),
      doc(join(w.cfg, "projects", "-proj", "memory", "note.md")), // the absolute-id copy
    ]);
    const r = keel(w, ["doctor"]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /stored under two document ids/);
    assert.match(r.stdout, /keel retain-id --audit/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("a canonical bank is all good, and says what it checked", () => {
    const w = world({ "-proj": ["note.md"] });
    setDocs([doc("projects/-proj/memory/note.md")]);
    const r = keel(w, ["doctor"]);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /retain ledger/);
    assert.match(r.stdout, /1 of 1 memory file\(s\) retained/);
    rmSync(w.root, { recursive: true, force: true });
  });

  /**
   * A file with no document is the normal state of a bank created after the
   * notes. Backfilling is the user's call, so it must never fail doctor.
   */
  test("never-retained files are reported, not failed", () => {
    const w = world({ "-proj": ["a.md", "b.md"] });
    setDocs([doc("projects/-proj/memory/a.md")]);
    const r = keel(w, ["doctor"]);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /1 of 2 memory file\(s\) retained/);
    rmSync(w.root, { recursive: true, force: true });
  });

  /**
   * The endpoint caps a page at 100. A ledger that read only the first page
   * would call every file beyond it un-retained — a wall of false alarms that
   * would teach the user to ignore the check.
   */
  test("the document list is paged, so a big bank is not silently truncated", () => {
    const names = Array.from({ length: 120 }, (_, i) => `n${i}.md`);
    const w = world({ "-proj": names });
    setDocs(names.map((n) => doc(`projects/-proj/memory/${n}`)));
    const r = keel(w, ["doctor"]);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /120 of 120 memory file\(s\) retained/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("the check has an off switch", () => {
    const w = world({ "-proj": ["note.md"] });
    setDocs([doc("projects/-proj/memory/note.md"), doc(join(w.cfg, "projects", "-proj", "memory", "note.md"))]);
    const r = keel(w, ["doctor"], { KEEL_RETAIN_CHECK_OFF: "1" });
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /retain ledger check off/);
    assert.doesNotMatch(r.stdout, /stored under two document ids/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("an unparseable document list is unverified, not a fault", () => {
    const w = world({ "-proj": ["note.md"] });
    const r = keel(w, ["doctor"], { KEEL_HINDSIGHT_BANK: "nosuchbank" });
    // The bank check above fails (bank absent) — but the ledger must not add a
    // second, contradictory verdict from a 404 document list.
    assert.doesNotMatch(r.stdout, /stored under two document ids/);
    rmSync(w.root, { recursive: true, force: true });
  });
});

describe("keel retain-id --audit names the repair", () => {
  test("it says which copy to keep and which to drop", () => {
    const w = world({ "-proj": ["note.md"] });
    const abs = join(w.cfg, "projects", "-proj", "memory", "note.md");
    setDocs([doc("projects/-proj/memory/note.md"), doc(abs)]);
    const r = keel(w, ["retain-id", "--audit"]);
    assert.equal(r.status, 0, r.stdout);
    // Colour codes sit between the label and the id, so compare on plain text.
    const plain = r.stdout.replace(/\x1b\[[0-9;]*m/g, "");
    assert.match(plain, /stored twice/);
    assert.match(plain, /keep\s+projects\/-proj\/memory\/note\.md/);
    assert.match(plain, new RegExp(`drop\\s+${abs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    rmSync(w.root, { recursive: true, force: true });
  });

  test("a hand-written id is called out as unupdatable", () => {
    const w = world({ "-proj": ["note.md"] });
    setDocs([doc("memory:keel:some-machine")]);
    const r = keel(w, ["retain-id", "--audit"]);
    assert.match(r.stdout, /names no file/);
    rmSync(w.root, { recursive: true, force: true });
  });

  test("with no backend configured it says so instead of failing", () => {
    const w = world();
    writeFileSync(join(w.cfg, "settings.json"), JSON.stringify({ env: {} }));
    const r = keel(w, ["retain-id", "--audit"]);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /no reflection backend configured/);
    rmSync(w.root, { recursive: true, force: true });
  });
});
