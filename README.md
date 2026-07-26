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
| **`keel`** | enabled | Security guard, ingest boundary, commit hygiene, activity log, the `week` skill, and the `keel` CLI |
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

### Security guard

Blocks irreversible catastrophe — recursive deletes of the filesystem root or a
system directory, `mkfs`, raw writes to block devices, fork bombs — and asks before
exfiltration-shaped commands: piping a remote script into a shell, uploading a
credential file over HTTP, copying an ssh key to a remote host, force pushes,
publishing local content to a gist.

Those exfiltration rules are why this exists rather than deferring to
`permissions.deny`. The native deny list matches command *prefixes*, which handles
`Bash(rm -rf /:*)` perfectly and cannot express "curl with a credential file as its
payload". Run both — the deny list is a cheaper, earlier stop where it applies.

It distinguishes **data from code in a heredoc**. Writing a Dockerfile that happens
to contain a recursive delete is file content and passes; the same text piped into
`bash` is code and is still blocked. That distinction is the reason this was ported
rather than copied — the original scanned the whole command string and blocked you
for writing documentation.

Policy ships inside the plugin, so it cannot drift from the code that reads it, and
it **fails closed**: an unreadable or invalid policy blocks Bash rather than
silently allowing everything. `KEEL_GUARD_OFF=1` is the deliberate escape hatch.

### Activity log

Records what you asked and what was concluded, tagged by repo and branch — so the
research, review, and dead-end work that never produces a commit is still
recoverable weeks later. `keel log` shows it; the `week` skill turns it into a
summary you can send.

Captured from documented hook payloads (`UserPromptSubmit` and `Stop`), never by
parsing transcripts. `KEEL_ACTIVITY_OFF=1` disables it; `KEEL_ACTIVITY_DIR`
relocates it.

### Commit hygiene

Blocks unwanted attribution trailers in commit messages. Whether you want those in your git
history is a preference — but it's a preference a model will forget, because it's one line
competing with a hundred others. A hook doesn't forget.

Configure with `KEEL_BLOCKED_TRAILERS` (comma-separated). Fails **open** on any internal
error, and only inspects actual `git commit` invocations, so `git log --grep` still works.

---

## Install

One command, and it walks the whole thing — dependency check, backup, optional
reset to vanilla, install, then the configuration TUIs:

```sh
git clone https://github.com/JimmayVV/keel && bash keel/scripts/install.sh
```

Two promises it keeps. It **never runs `sudo`**: where a system package is missing
it prints the exact command and waits for you to run it yourself. And it **never
deletes**: the reset step is a `mv`, and it prints the one-line undo before doing
anything. Every step is skippable, and the script is safe to re-run.

```sh
bash scripts/install.sh --dry-run    # print the plan, change nothing
bash scripts/install.sh --no-reset   # install alongside an existing setup
```

Or by hand:

```sh
/plugin marketplace add JimmayVV/keel
/plugin install keel@keel
```

For the manual reset with every step explained, see
[docs/FRESH-START.md](docs/FRESH-START.md).

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
