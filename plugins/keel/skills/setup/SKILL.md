---
description: Walk a machine through keel's configuration conversationally — device name, memory backend, recommended settings, PATH — by driving the keel CLI, so a Claude Code session produces the exact same result as running the CLI by hand. Use when the user asks to set up keel, configure keel, wire memory or a network backend, finish a fresh install, add keel to PATH, or check a new machine — "set up keel", "configure this machine", "wire up my notes", "finish setting up keel".
---

# Setup — the CLI experience, driven from a session

The goal is parity: what a user gets from running `keel setup`, `keel settings`,
and `keel link` by hand, they get from this skill — the difference is only that
Claude runs the commands and interprets the output. The CLI is flags-first
precisely so a session can drive it; this skill is that driver. It never
reimplements the CLI's logic, and it never edits config files directly.

Works the same on a fresh machine and an existing install, because step one is
always *look*: on a configured machine most steps find nothing missing and say
so, which makes this safe to run any time as a check-up.

## Absolutes

- **Never destructive.** Never runs `install.sh`'s reset path, never moves or
  deletes an existing config. Writes are the `KEEL_*` keys keel owns, plus —
  only through `keel settings --yes`, after showing every rule — the
  `permissions` entries the user approves.
- **Existing values are reported, not overwritten** — changed only on request.
- **Name every write before it happens**, and **let the CLI do the writing.**
  Flags in, keel's idempotent writes out.
- **The oracle is `keel doctor`.** Don't declare a step done because a command
  printed something hopeful — declare it done when `keel doctor` agrees. The
  run isn't finished until doctor exits 0 or you've named exactly what it still
  reports.

## Procedure

1. **Inspect.** Run `keel doctor` and `keel status`. This decides everything —
   only gaps and failures become questions.

2. **Device name** (if `keel status`/doctor shows it unset). Ask what to call
   this machine; the log falls back to `hostname()`, which under WSL is the
   *Windows* name and can collide silently. Then:
   `keel setup --device <name> --non-interactive`

3. **Memory** (if no adapter is wired). Ask what this machine should remember
   with:
   - **Nothing** — everything else works; skip.
   - **Local notes (Basic Memory)** — the default keel path. Run
     `keel setup --memory-home <dir> --non-interactive` (surface the default
     dir), which now also registers the Basic Memory project and sets it as
     default — that registration is the step that makes notes actually work,
     not just the directory. Then install the bridge (it is not enabled until
     installed): `claude plugin install keel-memory@keel`.
   - **A shared self-hosted backend (e.g. Hindsight)** — keel does not manage
     this; it is wired as an MCP server *outside* keel with `claude mcp add`,
     and `keel doctor` reports it as "wired outside keel," which is correct and
     not a problem. Confirm the server shows up in doctor.

   **Then verify, and fix in a loop.** Run `keel doctor`. If the notes adapter
   shows *mapping unverified* or *no project maps to this directory*, run the
   exact command doctor prints (a `basic-memory project add keel … && … project
   default keel`), then run `keel doctor` again. Repeat until doctor is clean or
   it reports something you must relay verbatim. A green directory line is not
   enough — the project registration is what a fresh machine is missing, and
   doctor is the only thing that confirms it landed. (Background: Basic Memory
   keeps a project registry separate from the notes directory; keel registers
   the project during setup, but a machine set up by an older keel, or one whose
   registry got into a bad state, needs this loop.)

4. **Projects registry note** — only when a memory store is wired and no
   `Project registry` note exists in it. Derive it: repos from
   `keel log --json`, remotes from each checkout's `git remote get-url origin`.
   Ask only for what machinery can't know — the one-line purpose per project,
   and which projects belong in this store (work projects stay out of a personal
   store, and the reverse). Write pointers, not descriptions. Offer, don't
   insist.

5. **Recommended settings.** Show `keel settings --list` — every rule with its
   reason. If the user wants them: `keel settings --yes` (appends only; say so).

6. **PATH** (offer). By design the `keel` binary is on the *Bash tool's* PATH,
   so Claude can already run it — the user does **not** need it on their shell
   PATH for anything in a session to work. If they'd like to run `keel` in their
   own terminal, offer `keel link` (adds a shim to `~/.local/bin`; `--dir` to
   choose elsewhere). Frame it as convenience, not a requirement.

7. **Migrate** — only if doctor or the conversation reveals a displaced old
   config from a reset. Default is none; `keel migrate` stays available forever.

8. **Verify and hand off.** `keel doctor` must exit 0; if it doesn't, fix or
   plainly report what's left. Note that newly installed plugins and MCP servers
   load at session start — the user should restart Claude Code (or
   `/reload-plugins`) to pick up the notes bridge. Close by pointing at the
   `guide` skill.

## Rules

- **Look before asking.** A question doctor already answered is noise.
- **Gaps only.** An existing install missing one thing gets one question.
- **Doctor is the finish line**, per-step and overall — not a command's
  optimistic stdout.
- **The CLI does the writing.** If a needed knob has no flag, that's a CLI gap
  to report, not a reason to hand-edit a file.
- **No network choices on the user's behalf.** Which machines share a backend is
  a boundary decision (NETWORKING.md) — present, never presume. A work machine
  defaulting to local-only is worth suggesting, with the reason.
- **End state, stated.** Finish with what changed, what didn't, and
  `keel doctor` as the proof.
