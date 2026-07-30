---
description: Explain how keel works and how to use what it ships — the guards, the CLI, and the skills. Use when the user asks what keel is or added, how a keel skill works ("how does deck work", "explain telos", "what can keel do", "keel help"), or wants a demo or walkthrough of a keel skill without committing to it.
---

# Guide — keel, explained from the live tree

Answer from the source of truth, never from memory of it. keel's own history
proves why: docs once described a sync layer three days dead. The skills
directory this file lives in *is* the registry of what keel currently does —
so the guide reads it, every time.

## Rule one: read, don't recall

- **Skills** — list the sibling directories of this skill's own base directory;
  each `SKILL.md`'s frontmatter description is the current truth about when it
  fires, and its body is the current truth about what it does. Explain from
  that text, quoting its own rules. Never paraphrase a keel skill from prior
  knowledge.
- **CLI** — run `keel` (bare, for the help text) and `keel status` (what's
  wired on *this* machine). What they print today beats any description.
- **The deep answers** — constitution and design live in the repo: `README.md`,
  `CONTEXT.md`, `docs/adr/`, `docs/MEMORY-ARCHITECTURE.md`. Point there for
  "why", read them for direct questions.

If the user asks about a skill that isn't in the sibling list, say so — their
machine may be behind; `keel update` is the fix, not improvisation.

## The stable shape (safe to say without looking)

Three layers, one direction of trust:

- **Hooks capture** — guards at the ingest boundary, the activity log.
  Deterministic, no model calls, fail toward not breaking your session.
- **The CLI computes** — `keel status`, `keel log`, setup and repair verbs.
  Read-mostly; Claude usually runs it for you.
- **Skills interpret** — everything with judgment lives here, invoked by your
  intent, never running behind your back.

The skills form a why-stack: `telos` (what it's all for) ranks objectives that
inform `deck` (what's promised and what's next), and `week` reconstructs what
actually happened. Each layer is checkable against the one below.

## Walkthrough mode — "show me, don't sign me up"

When the user wants to see a skill work without committing, run **only its
read-only gathering steps**, show what would happen next, and stop.
Walkthroughs never write a file, never rewrite a note, and never start an
interview.

- **week** — safe to run outright; skip the open-work snapshot step.
- **deck** — read the commitments file if one exists and show the triage
  report with live data; do not rewrite the note. If none exists, show the
  format and what capture would look like for something the user said today.
- **telos** — gather the evidence (`keel log`, commitments, git), present the
  drafted objectives with citations, and name what the goals and mission
  layers would need from the user — then stop, explicitly, where the
  interview would begin. The point of the demo is that they can see the
  bottom layers are derived and the top layer is theirs.

End every walkthrough by saying what the real invocation is and what it would
do that the demo didn't.

## Escape hatches worth volunteering

When explaining guards or the log, mention the off-switches — a layer you
can't turn off is a layer you'll eventually resent: `KEEL_GUARD_OFF=1`,
`KEEL_ACTIVITY_OFF=1`, the user policy at `~/.config/keel/policy.json`
(documented in the README, including the exempt-a-shipped-rule shape), and
`keel settings --list` to read the recommended posture without applying it.

## Rules

- **Guide mode writes nothing.** Not a note, not a file, not a setting.
- **Live text beats memory.** If the explanation contradicts the SKILL.md on
  disk, the disk is right.
- **Say what's absent.** A skill or backend not present on this machine is
  reported, with the one command that would change that — not papered over.
- **Keep the exit visible.** Every explanation of a keel behavior includes how
  to turn it off or remove it. Easy teardown is a keel promise, and the guide
  is where it's kept audible.
