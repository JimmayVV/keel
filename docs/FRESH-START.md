# Fresh start: replacing an existing Claude Code setup with keel

For a machine that already has a customised harness — hooks, skills, agents,
symlinked config — and you want to start clean and install keel instead.

**Nothing here deletes anything.** Every destructive-looking step is a `mv`, so
the whole procedure reverses in one command. Read [Rollback](#rollback) first if
that matters to you, which on a work machine it should.

---

## 0. Preflight

Run these before touching anything. Two minutes now saves an evening.

```sh
claude --version          # note it; keel needs a recent build for plugin support
node --version            # required — keel's hooks are plain node
git --version             # required
echo "$CLAUDE_CONFIG_DIR" # if this is set, that path is your config dir, not ~/.claude
```

If `node` is missing, stop and install it first. keel deliberately depends on
node rather than bun because it's the version most likely to already be present.

**Close every running Claude Code session.** Moving the config directory out from
under a live session produces confusing, harmless-looking breakage.

Set a variable for the rest of the guide so the commands work whether or not you
use a custom config directory:

```sh
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
echo "$CFG"
```

---

## 1. Inventory what you have

You want to know what you're walking away from before you walk away.

```sh
ls -la "$CFG"
# Symlinks pointing outside the config dir — these came from another repo
find "$CFG" -maxdepth 2 -type l -exec ls -ld {} \;
# What's tracked, if the config dir is itself a git repo
git -C "$CFG" remote -v 2>/dev/null
git -C "$CFG" status --short 2>/dev/null | head -20
```

**If the config dir is a git repo with uncommitted changes, commit or push them
now.** That's the one thing a `mv` won't save you from wanting later.

---

## 2. Back up

```sh
STAMP=$(date +%Y%m%d-%H%M%S)
cp -a "$CFG" "$HOME/claude-backup-$STAMP"
du -sh "$HOME/claude-backup-$STAMP"
```

`cp -a` preserves symlinks as symlinks rather than copying their targets, which
is what you want — the backup should record what was linked, not duplicate it.

If the copy is large, the bulk is almost certainly session history. Check before
deciding to trim:

```sh
du -sh "$HOME/claude-backup-$STAMP"/* 2>/dev/null | sort -rh | head
```

**Verify the backup is real before continuing:**

```sh
test -f "$HOME/claude-backup-$STAMP/settings.json" && echo "backup OK"
```

---

## 3. Save the two things you actually want to keep

Everything else is configuration you're deliberately replacing. These two are
not.

**Auth** — so you don't have to log in again:

```sh
mkdir -p "$HOME/keel-carryover"
cp -a "$CFG/.credentials.json" "$HOME/keel-carryover/" 2>/dev/null
cp -a "$HOME/.claude.json"     "$HOME/keel-carryover/" 2>/dev/null
```

`~/.claude.json` lives *outside* the config directory and holds your login, your
MCP server list, and per-project trust decisions. Keeping it means you come back
with your MCP servers intact — usually what you want on a work machine.

**Auto-memory** — the genuinely valuable part, and the easiest to lose:

```sh
cp -a "$CFG/projects" "$HOME/keel-carryover/projects" 2>/dev/null
find "$HOME/keel-carryover/projects" -name 'MEMORY.md' | wc -l   # sanity check
```

Those are Claude's accumulated notes per repository — build quirks, gotchas,
decisions. They are not recreatable, and they are what makes a configured machine
feel different from a fresh one.

> Project-level `.claude/` directories *inside your work repos* are untouched by
> any of this. They live with the code and are not part of the home config.

---

## 4. Move the old setup aside

```sh
mv "$CFG" "$CFG.old-$STAMP"
```

That single move is enough, including for setups assembled out of symlinks into a
second repository. **The links live inside the config dir, so moving it removes
them** — there is no need to touch the other repository, and it's not yours to
move anyway. It stays where it is, which is your route back.

Worth knowing which directories were involved, though:

```sh
find "$CFG.old-$STAMP" -maxdepth 3 -type l -exec readlink -f {} \; 2>/dev/null \
  | grep -v "^$CFG" | sed "s|^\($HOME/[^/]*\).*|\1|" | sort -u
```

Two things do survive the move and can quietly resurrect the old setup or point
tooling at a directory that no longer exists.

**Shell aliases:**

```sh
grep -nE "alias [A-Za-z0-9_-]+=.*($(basename "$CFG")|claude)" \
  "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile" 2>/dev/null
```

Remove any that launched the old harness.

**A global git hooks path:**

```sh
git config --global --get core.hooksPath
# only if it points inside the old config dir:
git config --global --unset core.hooksPath
```

---

## 5. Start Claude Code clean

```sh
claude
```

It recreates the config directory from scratch. Confirm you're actually starting
from nothing:

```
/context
```

You should see no custom skills, no agents, and no hooks. If you still see the
old ones, something is still symlinked — stop and re-check step 4.

Exit, then restore the carryover:

```sh
cp -a "$HOME/keel-carryover/.credentials.json" "$CFG/" 2>/dev/null
cp -a "$HOME/keel-carryover/.claude.json"      "$HOME/" 2>/dev/null
cp -a "$HOME/keel-carryover/projects"          "$CFG/projects" 2>/dev/null
```

Two things do **not** come back with that, and both are handled in step 6 once
keel is installed and can do it for you:

- **Your marketplaces and plugins.** The registry lived inside the config dir, so
  the move in step 4 took all of it.
- **The official marketplace, specifically.** `~/.claude.json` — which you just
  restored — carries a flag saying it has already been auto-installed. Claude
  Code checks that flag, not whether the marketplace is actually there, so left
  set it suppresses the reinstall *permanently*. That leaves you with less than
  vanilla: no official marketplace, and no attempt to fetch one. You find out
  weeks later, in an unrelated repo, when an install fails with
  `Available marketplaces: keel`.

Start again and confirm you're still logged in and your memory came back.

---

## 6. Install keel

```
/plugin marketplace add JimmayVV/keel
/plugin install keel@keel
```

### Bring back the marketplaces and plugins you want

The old config is still sitting at `$CFG.old-$STAMP`, so keel can read what you
had and put back as much or as little of it as you like:

```sh
keel migrate --from "$CFG.old-$STAMP"
```

It lists every marketplace and plugin that config had and that this one is
missing — including which plugins were *disabled*, since restoring one of those
switched on would quietly change how the machine behaves — then offers **all**,
**none**, or **pick one at a time**. The default is none: you asked for vanilla,
and this command undoing that by default would be the same surprise in reverse.

It also clears the suppression flag described in step 5, but only when it would
otherwise leave you stuck: if the official marketplace is already in the list to
re-add, adding it settles the matter and you are not asked twice. Decline it
there and the flag stays as it is — a marketplace you just refused should not
reappear by the back door.

Nothing about it is one-shot. The old config stays where it is, so `keel migrate`
answers the same question a month from now, and re-running it after a partial
restore proposes only what is still missing.

Restart, then verify:

```sh
keel status
```

Expect the **Working now** block to be green with zero configuration — guards and
the activity log are active immediately. The **Optional** block should show
everything unconfigured, which is the correct state.

---

## 7. Confirm capture actually works

The activity log is the whole point, so prove it rather than assuming.

```sh
cd ~/some-work-repo
claude
```

Ask it one real question, exit, then:

```sh
keel log
```

You should see your prompt, attributed to that repo and branch. If the log is
empty:

```sh
keel doctor
ls -la "$CFG/keel/activity/"
echo "$KEEL_ACTIVITY_OFF"   # must be empty
```

---

## 8. Optional extras, in order of value

Take these one at a time, and only if you want them.

**Status line** — replaces a hand-written script with a maintained one that has a
live-preview configurator:

```sh
npx -y ccstatusline@latest
```

It offers to write the settings itself. To revert, remove the `statusLine` key
from `settings.json`.

**Durable notes** — needs `uv` and Python 3.12. On Ubuntu 22.04 the system Python
is 3.10 and there is no 3.12 in the repos, so `uv` does the provisioning. Install
it from PyPI rather than piping a script into a shell:

```sh
pip3 install --user uv
keel setup --memory-home "$HOME/notes"
claude plugin enable keel-memory
```

**Reflection** — not in v0.1. `keel status` explains why, and you almost certainly
don't need it: weekly summaries and priority conversations run in-session on your
existing subscription.

---

## Rollback

Any point, one command:

```sh
rm -rf "$CFG" && mv "$CFG.old-$STAMP" "$CFG"
```

Any symlinks it contained point at repositories that were never moved, so they
resolve again immediately.

Restore the shell alias and `core.hooksPath` if you removed them. The full backup
at `~/claude-backup-$STAMP` remains untouched either way.

---

## Cleanup, once you're happy

Give it a couple of weeks first — the value of the activity log is cumulative, and
you won't know whether you miss the old setup until you've tried to do something
with it.

```sh
rm -rf "$CFG.old-$STAMP" "$HOME/keel-carryover-$STAMP"
# keep ~/claude-backup-$STAMP longer, or archive it
```

---

## Config-directory isolation is not account isolation

Worth knowing before you rely on `CLAUDE_CONFIG_DIR` to separate two contexts on
one machine. Verified on a fresh profile with an empty MCP configuration:

- **Config-scoped servers are isolated.** Anything added via the CLI or declared
  in `settings.json` / `.mcp.json` does not follow you into another config
  directory. Correct.
- **claude.ai connectors are not.** Gmail, Drive, Calendar and similar
  account-hosted connectors appeared in a profile whose `mcpServers` was empty in
  both `.claude.json` and `settings.json`. They follow the **login**, not the
  directory.

So two config directories on one login give you separate *configuration*, not
separate *reach*. A "work" profile on a personal account can still read personal
email. If that matters, separate the accounts — which is the case keel's network
model assumes anyway, since networks are sets of machines rather than profiles.

## A note on work machines

If this is company hardware, two things are worth settling before you start
rather than after:

- **Check your employer's AI tooling policy.** Claude Code and approved MCP
  servers may already be cleared while *new software that reads your ticket
  tracker and stores derived work data locally* is a different conversation. It's
  a five-minute question and much cheaper asked first.
- **Work data stays work data.** keel's activity log records what you asked and
  concluded, tagged by repository. That's employer information. It must not sync
  to a personal git remote — keep it local, or use a company-hosted remote.
  Nothing in keel transmits it anywhere, but nothing stops *you* from committing
  it to the wrong repo either.
