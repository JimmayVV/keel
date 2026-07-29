# keel

**A thin, durable layer under [Claude Code](https://code.claude.com).** Guardrails at the
ingest boundary, plus a CLI that wires third-party memory backends — and nothing else.

> **Status:** v0.2, personal tool built in the open. Issues and PRs welcome and may be
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

The allowlist is currently a written convention, not a runtime check — there is no code
that enforces it and `keel doctor` does not verify it. See
[docs/DOCUMENTED-SURFACES.md](docs/DOCUMENTED-SURFACES.md) for the full table of what's
allowed and what's forbidden, each with a docs link.

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
silently allowing everything.

Because the shipped policy lives in the plugin cache — which updates replace
wholesale — editing it there isn't a real escape hatch. Yours lives at
`~/.config/keel/policy.json`, survives updates, and can both add rules and
**exempt** shipped ones via `bash.allow`, which is checked first and wins
outright. A block tells you that file's path and the shape to write. An escape
hatch documented only in the source isn't one. `KEEL_GUARD_OFF=1` still disables
the guard entirely.

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
reset to vanilla, install, carry-over of whatever you want back from the old
setup, then the configuration TUIs:

```sh
git clone https://github.com/JimmayVV/keel && bash keel/scripts/install.sh
```

Two promises it keeps. It **never runs `sudo`**: where a system package is missing
it prints the exact command and waits for you to run it yourself. And it **never
deletes**: the reset step is a `mv`, and it prints the one-line undo before doing
anything. Every step is skippable, and the script is safe to re-run.

If you do reset, nothing is stranded. The old config is kept, and `keel migrate`
reads it to put back marketplaces and plugins — all of them, none of them, or one
at a time. It defaults to none, and stays available long after the install, so
declining costs nothing.

```sh
bash scripts/install.sh --dry-run    # print the plan, change nothing
bash scripts/install.sh --no-reset   # install alongside an existing setup
bash scripts/install.sh --no-backup  # skip the backup step (e.g. using this as an updater)
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

keel adds **no launcher, no wrapper, and no alias.** You invoke `claude`, exactly as
you would without it. Everything keel contributes — guards, the activity log,
skills — loads into a plain session.

The `keel` command is a small, read-mostly configuration tool. It lives on the
**Bash tool's** PATH rather than your shell's, so in practice Claude runs it for
you:

```
> what did I do last week?     → invokes the week skill
> check keel status            → Claude runs it and reports
```

```
keel status    what's active, what's optional, what each option costs   (read-only)
keel log       your activity records; --json feeds the week skill       (read-only)
keel doctor    verify prerequisites; exit 1 on problems                 (read-only)
keel settings  recommended posture, each rule explained and linked
               (--list reads without applying; nothing is written
                without a yes, and it only ever appends)
keel setup     names this machine and wires the adapters — portable keys
               to settings.json, machine-specific ones to settings.local.json
               (--device <name> sets the activity-log device non-interactively)
keel update    pull the latest keel + any installed bridge plugins
               (the update slice of install.sh; the script stays the
                full-ceremony path for backup, reset, and first install)
keel migrate   restore marketplaces + plugins from a config a reset moved
               aside — lists what this machine is missing, then --all,
               --none, or --pick one at a time (default: none)
               (--from DIR, --dry-run; re-runnable for as long as the old
                config is on disk, which is indefinitely)
keel link      put keel on your PATH (--dir, default ~/.local/bin)
```

If you'd rather type it yourself, `keel link` puts it in `~/.local/bin` — the
installer offers the same thing at step 6. You don't need it; Claude's Bash tool
finds the plugin binary on its own.

What it writes there is a shim, not a symlink, and that distinction is load-bearing.
A symlink has to name a version (`…/cache/keel/keel/<version>/bin/keel`), and an
update leaves the old version directory in place — so the link goes on resolving
perfectly well, to code that is weeks old, with no symptom. The shim reads
`installPath` from `installed_plugins.json` on every run instead, so there is no
versioned path left to go stale. `keel doctor` reports it if one ever does; `keel
update` migrates an old symlink the first time it sees one, and never touches a
file keel didn't write.

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

See [docs/NETWORKING.md](docs/NETWORKING.md) for the practical setup. In short:
**features need no sync** — every machine installs the same plugin from the same
marketplace — and **memory is whatever adapter that machine points at.** keel
does not sync memory, because the adapter already decides whether it's shared.

A **network** is a set of machines pointed at the same memory backend. A local
adapter is a network of one; a self-hosted shared instance is a network of
several. Your work machines are a different network — a different backend, or
none. They are not connected and keel has no concept that spans them.

```
        ┌──────── keel (this repo) ────────┐
        │    features flow downward only    │
        ▼                                   ▼
┌────────────────────┐        ┌────────────────────┐
│ personal           │ ←never │ work               │
│ shared instance    │ meets→ │ local adapter only │
└────────────────────┘        └────────────────────┘
```

keel used to ship a git-repo sync for memory and instructions. It was removed:
once an adapter provides the sharing, a second sharing mechanism is two stores
with no rule for which one wins. One value still differs per machine — the
device name in `settings.local.json` — and that is the whole of it.

There is deliberately **no bridge, no export, and no sanitiser.** An earlier design kept
features and data in one repo, which forced an elaborate gated export — with a scanner that
refused to proceed if personal names appeared in the outbound diff — just to get
architecture onto a work machine safely. Separating features from data *deletes* that
problem rather than guarding it. About 600 lines of gating logic stopped existing.

---

## Development

```sh
node --test plugins/keel/test/*.test.mjs        # 125 tests
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
fork. [NOTICE](NOTICE) scopes exactly what was derived and carries the upstream licence.
