# keel

A thin, durable layer under Claude Code. This glossary is the vocabulary for deciding
what keel carries and where knowledge lives; the decisions behind it are in `docs/adr/`.

## Language

### Knowledge

**Derivable fact**:
A fact whose source of truth is code — a `grep` can falsify it. Never stored; its
carrier is looking (registry → open the repo → read the live truth).
_Avoid_: cached fact, synced fact

**Decided fact**:
A fact whose source of truth is the user — a preference, convention, or decision,
recorded with its why. Only the user can falsify it, by deciding otherwise.
_Avoid_: wisdom, learnings

**Machine fact**:
A fact true only on one box — toolchain paths, WSL quirks, which shell builds what.
Lives in auto-memory and correctly stays behind.

**Observation**:
An append-only record of what happened — the activity log. Never stale, only old.
Distinct from a conclusion drawn from it, which is a decided fact and contestable.

**Logic**:
Reusable behavior. Its carrier is software — a package or template — never memory.
Extracted only after real duplication, never speculatively.

**Registry**:
The one note listing projects: name, remote, one-line purpose. The sole deliberate
cache of a derivable fact, because there is no root to grep across machines.

**Convention**:
A decided fact that deletes per-machine variation instead of adapting to it
(e.g. "personal projects live at `~/personal/<name>`").
_Avoid_: configuration — that is the thing a convention replaces

### System

**Carrier**:
The single named mechanism responsible for moving a datum. Every datum has exactly
one — two carriers is ambiguity with no rule for which wins; zero is a gap someone
rediscovers later as a missing feature.
_Avoid_: transport, sync

**Network**:
A set of machines pointed at the same memory backend. A local adapter is a network
of one. Networks never meet, and keel has no concept that spans them.

**Adapter**:
A keel bridge plugin that wires an external memory engine into Claude Code through
documented surfaces (`.mcp.json`).
_Avoid_: integration, backend plugin

**Engine**:
The external system an adapter wires in (Basic Memory, Hindsight). Swappable, and
never load-bearing for remembering.

**Felt need**:
A need that has occurred at least once, here, to the user — not in someone else's
demo, repo, or documentation. The admission bar for anything beyond prose (ADR-0001).
