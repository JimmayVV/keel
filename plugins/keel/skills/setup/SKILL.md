---
description: Walk a machine through keel's configuration conversationally — device name, memory backend, recommended settings — driving the CLI's flag form behind the scenes. Use when the user asks to set up keel, configure keel, wire memory or a network backend, finish a fresh install, or check a new machine — "set up keel", "configure this machine", "wire up my notes".
---

# Setup — the install ceremony, as a conversation

The `keel` CLI is flags-first precisely so something else can drive it. This
skill is that something: it inspects what is already wired, asks only about
the gaps, and executes with flags — `keel setup --device … --memory-home …
--non-interactive`, `keel settings --yes` — so the user answers questions in
plain language and never has to babysit a TTY prompt.

Works the same on a fresh machine and an existing install, because the first
step is always *look*: on a configured machine it finds nothing missing and
says so, which makes it safe to run any time as a check-up.

## Absolutes, before anything else

- **Never destructive.** This skill never runs `install.sh`'s reset path,
  never moves or deletes an existing config, never touches settings keys
  outside `KEEL_*`. The reset-and-carry-over ceremony is `install.sh`'s job,
  run by a human on purpose.
- **Existing values are respected.** Something already set is *reported*, not
  overwritten — changing it happens only if the user asks for that change.
- **Every write is named before it happens.** One line: what command, what it
  touches. The CLI's own writes are append-only and backed up, but consent is
  this skill's job, not the CLI's.

## Procedure

1. **Inspect.** `keel doctor` and `keel status` — what's active, what's
   wired, what's broken. This decides everything that follows: only gaps and
   failures become questions.

2. **Device name** (if unset). Ask what to call this machine. Why it matters,
   said briefly: the log falls back to `hostname()`, which under WSL is the
   *Windows* machine name — two boxes collide silently and a month of work
   gets attributed to the wrong one. Then:
   `keel setup --device <name> --non-interactive`

3. **Memory** (if no adapter is wired). Ask what this machine should
   remember with, offering the honest menu:
   - **Nothing** — fine, everything else works; skip.
   - **Local notes** — `keel setup --memory-home <dir> --non-interactive`
     (default is a hidden dir; surface it), then
     `claude plugin enable keel-memory@keel`.
   - **A shared backend** — keel wires Basic Memory locally; a shared
     instance (e.g. a self-hosted server on the tailnet) is wired as an MCP
     server *outside* keel, and `keel doctor` will report it as exactly that.
     Say so rather than pretending keel manages it.

   After wiring, verify the mapping doctor checks: a Basic Memory project
   must actually point at the memory home. If none does, offer the fix
   (`uvx basic-memory project add main <dir>`), then re-run doctor.

4. **Recommended settings.** Show `keel settings --list` — every rule with
   its reason. If the user wants them: `keel settings --yes`. It only ever
   appends; say that.

5. **Migrate** — only if doctor or the conversation reveals a displaced old
   config from a reset. Default is none: `keel migrate` stays available
   forever, so declining costs nothing. Never propose `--all` unprompted.

6. **Verify and hand off.** `keel doctor` must exit 0; if it doesn't, fix or
   plainly report what's still wrong. Note what needs a session restart
   (newly enabled plugins and MCP servers load at session start). Close by
   pointing at the `guide` skill for how everything works.

## Rules

- **Look before asking.** A question doctor already answered is noise.
- **Gaps only.** An existing install with one thing missing gets one
  question.
- **The CLI does the writing.** This skill never edits settings files
  directly — flags in, `keel`'s idempotent writes out. If a needed knob has
  no flag, that's a CLI gap to report, not a reason to hand-edit.
- **No network choices on the user's behalf.** Which machines share a memory
  backend is a boundary decision (see NETWORKING.md) — present, never
  presume. A work machine defaulting to local-only is worth suggesting out
  loud, with the reason.
- **End state, stated.** Finish with what changed, what didn't, and the one
  command that proves it (`keel doctor`).
