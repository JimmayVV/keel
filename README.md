# keel

**A thin, durable layer under [Claude Code](https://code.claude.com).** Guardrails at the
ingest boundary, plus a CLI that wires third-party memory backends — and nothing else.

> **Status:** v0.1, personal tool built in the open. Issues and PRs welcome and may be
> politely declined. Fork freely; that's what the licence is for.

---

## Why this exists

Most agent harnesses grow until they're a second product you have to maintain. This one
stays small by obeying two rules.

### 1. Own your config, buy your capabilities

Sync, guardrails, and setup are **configuration** — personal, unshippable, correctly yours,
a few hundred lines. Memory, recall, and reflection are **capabilities** — general, valuable
to strangers, and already built better by people who do it full time. keel wires them in.
It does not reimplement them.

This rule was learned the hard way. Six separate times during design, the answer to "should
I build this?" turned out to be "someone already did": auto-memory, notes storage, profile
isolation, feature distribution, per-machine sync, and the status line all had mature
answers already shipping. What survived as genuinely worth owning is small and unglamorous.

### 2. Documented surfaces only

If Anthropic hasn't documented it, keel doesn't read, write, or parse it. No exceptions for
convenience. A feature that needs an undocumented surface is a feature that doesn't ship.

This has teeth. The system keel replaced parsed session transcripts out of an undocumented
JSONL format to power search. It worked — and it was the least durable thing in the stack,
one format change from silent breakage. Claude Code's own changelog notes a release that
*"reduced transcript size up to 79×"*: exactly the kind of change that breaks a parser with
no test to catch it.

The allowlist is enforced in [`src/surfaces.ts`](docs/DOCUMENTED-SURFACES.md), not just
promised in prose. See [docs/DOCUMENTED-SURFACES.md](docs/DOCUMENTED-SURFACES.md) for the
full table of what's allowed and what's forbidden, each with a docs link.

---

## What's in the box

| Plugin | Default | What it does |
|---|---|---|
| **`keel`** | enabled | The ingest boundary, commit hygiene, and the `keel` CLI |
| **`keel-memory`** | **disabled** | Wires [Basic Memory](https://github.com/basicmachines-co/basic-memory) as a local MCP server over plain markdown |

Adapters ship `defaultEnabled: false` — documented for *"plugins that add cost or scope a
user should opt into"* — so they install dormant. One command turns each on.

### The ingest boundary

Every `WebFetch`, `WebSearch`, and `mcp__*` result is wrapped in an envelope marking it as
untrusted **data**, not instructions. This closes the indirect prompt-injection path where a
poisoned web page or ticket body tells the agent to exfiltrate, install, or approve
something. It also flags zero-width characters and bidirectional overrides — the standard
ways to hide instructions from human review.

Strictly read-only: it never blocks a call and never mutates a result. A guard that can
break your workflow is a guard you'll eventually disable.

### Commit hygiene

Blocks unwanted attribution trailers in commit messages. Whether you want those in your git
history is a preference — but it's a preference a model will forget, because it's one line
competing with a hundred others. A hook doesn't forget.

Configure with `KEEL_BLOCKED_TRAILERS` (comma-separated). Fails **open** on any internal
error, and only inspects actual `git commit` invocations, so `git log --grep` still works.

---

## Install

```sh
/plugin marketplace add JimmayVV/keel
/plugin install keel@keel
```

Replacing an existing customised harness? See
[docs/FRESH-START.md](docs/FRESH-START.md) — a reversible, move-aside procedure
that preserves your login and your accumulated per-project memory.

Then wire the notes adapter, if you want it:

```sh
keel setup --memory-home ~/notes
claude plugin enable keel-memory
```

### The CLI

```
keel status    what's wired                    (default)
keel setup     interactive or flag-driven wiring
keel doctor    verify prerequisites; exit 1 on problems
```

`keel` owns no runtime. It configures other people's tools and gets out of the way — which
means every write is idempotent and surgical. It touches only the `KEEL_*` keys it owns in
`settings.json`, backs the file up before the first write, and preserves everything else.
Config files belong to the user; a setup tool that clobbers them is a bug with a nice
interface.

`setup` is **flags-first** and only prompts on a TTY, so it works in scripts and CI. A tool
whose job is automation but which can only be driven by a human isn't automation.

---

## Requirements

- **Node.js** — the hooks are plain `.mjs` with zero dependencies. Your machines may not
  have bun, deno, python, or jq; node is the portable floor.
- **For `keel-memory`:** [`uv`](https://github.com/astral-sh/uv) and **Python ≥ 3.12**.
  Note the floor — on Ubuntu 22.04 (Python 3.10, with no 3.12 in its repos) the adapter
  cannot run natively. `uv` provisions a suitable interpreter, which is *why* upstream
  recommends `uvx` rather than a bare pip install.

---

## Networks

A **network** is a set of machines sharing one data repo. Your personal machines are one
network; your work machines are a different one. They are not connected, they don't know
about each other, and keel has no concept that spans them — the same way two Tailscale
tailnets or two Google accounts don't meet.

```
        ┌──────── keel (this repo) ────────┐
        │    features flow downward only    │
        ▼                                   ▼
┌───────────────────┐          ┌───────────────────┐
│ network: personal │ ← never  │ network: work     │
│ data: your repo   │  meets → │ data: their repo  │
└───────────────────┘          └───────────────────┘
```

There is deliberately **no bridge, no export, and no sanitiser.** An earlier design kept
features and data in one repo, which forced an elaborate gated export — with a scanner that
refused to proceed if personal names appeared in the outbound diff — just to get
architecture onto a work machine safely. Separating features from data *deletes* that
problem rather than guarding it. About 600 lines of gating logic stopped existing.

---

## Development

```sh
node --test plugins/keel/test/guards.test.mjs   # 10 tests
claude plugin validate .                        # marketplace
claude plugin validate ./plugins/keel           # each plugin
claude --plugin-dir ./plugins/keel              # load without installing
```

Guard tests assert two properties: that each guard fires on what it should, and that it
**fails open** on anything unexpected rather than breaking the session.

One quirk worth knowing: trailer fixtures are assembled from fragments at runtime. Writing
the literal string into a file a shell might echo will trip a correctly-configured commit
guard on your own machine — a nice proof the idea works, and a very annoying way to run a
test suite.

---

## Deliberately not included

- Parsing transcripts, `history.jsonl`, or any undocumented file
- A memory system, vector store, or LLM call of its own
- A daemon, web UI, or background service
- Credential management
- A status line — use [ccstatusline](https://github.com/sirmalloc/ccstatusline), which has a
  live-preview TUI and already covers usage limits, reset timers, and worktree state

---

## Licence

MIT — see [LICENSE](LICENSE).

Hook patterns descend from [PAI](https://github.com/danielmiessler/PAI) by Daniel Miessler
(MIT), since renamed LifeOS. Credit where due; this is an independent implementation, not a
fork.
