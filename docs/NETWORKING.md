# Networking several machines

Two separate problems that people usually conflate. Solve them separately.

| | Direction | Mechanism | Effort |
|---|---|---|---|
| **Features** — the plugin, hooks, skills, policy | repo → every machine | the plugin marketplace | **already done** |
| **Data** — activity, instructions, preferences | machine ↔ machine | a private git repo | some setup |

---

## Features: nothing to do

This is already solved and needs no sync tooling at all. Every machine installs
the same plugin from the same marketplace:

```sh
/plugin marketplace add JimmayVV/keel
/plugin install keel@keel
```

To pick up new versions later:

```sh
claude plugin update keel
```

Each machine pulls independently. There is no push, no merge, and no state shared
between them — which is exactly why this half needs no thought.

---

## Data: what's worth syncing, and what fights back

Four kinds of local state, with very different behaviour under sync. With
auto-memory left machine-local (below), everything you *do* sync is conflict-free
by construction — which is the whole reason to accept two stores rather than
force one.

### 1. Activity log — safe to sync

`<config>/keel/activity/*.jsonl`

Files are scoped by **month and device** — `2026-07-desktop.jsonl`,
`2026-07-laptop.jsonl` — specifically so this can be synced. Only one machine ever
writes a given file, so a merge conflict is impossible. Readers glob the whole
directory, so a merged log reads as one continuous history, and every record
carries its `device` field.

This is the one you most want shared: it means a weekly summary covers everything
you did, not just what you did on one box.

### 2. Instructions and preferences — safe to sync

`<config>/CLAUDE.md`, `<config>/rules/`, `<config>/settings.json`

Small, hand-edited, and rarely touched on two machines the same day. Ordinary git
conflicts, ordinary resolutions.

One caveat: `settings.json` can hold machine-specific values (paths, an activity
directory override). Keep those in `settings.local.json` — which is
gitignored-by-convention and not synced — so the shared file stays portable.

### 3. Auto-memory — leave it machine-local (recommended)

`<config>/projects/<repo>/memory/`

The tempting move is to force this into git, because it's the richest thing on the
machine. Don't. Anthropic documents it as machine-local, Claude rewrites it on
every machine, and `MEMORY.md` — the index both machines rewrite — conflicts
constantly. You'd be fighting the tool's design for the rest of its life.

**The better framing is that two memory stores are correct, because they hold
different kinds of knowledge:**

| Store | Holds | Example |
|---|---|---|
| **Auto-memory** (machine-local, automatic) | facts about *this machine* | "npm install from WSL strips the win32 bindings"; toolchain paths; which shell can build what |
| **A notes store** (synced, deliberate) | facts that are true everywhere | "we moved off React Router to TanStack Start because of typed loaders"; architecture; conventions |

Once you see it that way, machine-local stops being a limitation. **Environment
quirks *should* be environment-scoped** — a note about WSL's `/mnt/c` slowness is
noise on a Mac. And portable decisions belong somewhere portable, which is what a
notes adapter is for.

The payoff is large: with auto-memory out of the sync set, **everything left syncs
without ever conflicting.** No merge resolution, no lost edits, no fighting.

The one real friction, stated plainly: **auto-memory is automatic and the notes
store isn't.** Claude writes to auto-memory on its own; writing a durable decision
to the portable store is a choice it has to make. Expect some things to land in the
wrong place. A line in your `CLAUDE.md` helps —

> Machine-specific quirks go to auto memory. Decisions and rationale that are true
> on every machine go to the notes store.

— and periodically promoting the portable bits out of auto-memory is a five-minute
job, not a system.

### 4. Never sync

`.credentials.json`, `~/.claude.json`, `history.jsonl`, `projects/*/*.jsonl`,
caches, `sessions/`, `shell-snapshots/`.

Auth, session transcripts, and machine-local runtime state. Large, secret, or both.

---

## A minimal setup

One private repo, symlinked into place. Roughly twenty minutes.

```sh
# Once, on the machine with the state you want to keep
mkdir -p ~/keel-data && cd ~/keel-data && git init
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

# Move the shareable pieces in, then link them back
# Note: `projects` is deliberately absent — auto-memory stays machine-local.
for item in CLAUDE.md rules keel; do
  [ -e "$CFG/$item" ] && mv "$CFG/$item" ~/keel-data/ && ln -s ~/keel-data/"$item" "$CFG/$item"
done

cat > .gitignore <<'IGN'
# never leaves the machine
.credentials.json
*.jsonl.tmp
IGN

git add -A && git commit -m "initial keel data" && git remote add origin <your-private-repo> && git push -u origin main
```

On the second machine, clone and link the same way. Then syncing is just git:

```sh
cd ~/keel-data && git pull --rebase && git add -A && git commit -m "sync" && git push
```

Wrap that in a shell function if you like. Deliberately not part of keel — this is
your data and your remote, and a tool that manages someone's git history is a tool
that eventually surprises them.

### Alternatives worth knowing

- **[chezmoi](https://www.chezmoi.io/)** — mature dotfile manager with templating
  for per-machine differences and real secret-manager integration. The right answer
  if you're already managing dotfiles, or want secrets handled properly rather than
  gitignored.
- **[Syncthing](https://syncthing.net/)** — continuous, no commits, peer-to-peer.
  Excellent for the activity log (append-only, per-device files, nothing to merge).
  Riskier for `MEMORY.md`, where last-write-wins can silently discard an edit.

---

## Keep work and personal apart

A **network** is a set of machines sharing one data repo. Work machines are a
different network from personal machines: a different repo, a different account,
and no path between them.

Two rules make that hold:

1. **Work data never goes to a personal remote.** Ticket contents, your manager's
   stated priorities, and repo-tagged activity are employer information. Keep the
   work data repo company-hosted, or keep it local with a local backup.
2. **Personal aspirations never land on company hardware.** They simply aren't in
   the work network, so there's nothing to filter.

Worth knowing before you rely on one machine for both: `CLAUDE_CONFIG_DIR`
isolates config-scoped MCP servers, but **claude.ai account connectors ignore it**
— Gmail, Drive and Calendar appear in a fresh profile whose MCP config is empty,
because they follow the login. Two config directories on one login give you
separate configuration, not separate reach. Separate accounts on separate machines
is what actually separates them.
