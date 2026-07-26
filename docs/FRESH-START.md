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

If a separate repo was feeding it symlinks, move that aside too rather than
deleting it:

```sh
[ -d "$HOME/.pai-doctrine" ] && mv "$HOME/.pai-doctrine" "$HOME/.pai-doctrine.old-$STAMP"
```

Clean the shell hooks that pointed at the old setup — check before editing:

```sh
grep -n 'pai\|\.claude' "$HOME/.zshrc" "$HOME/.bashrc" 2>/dev/null
```

Remove any alias lines you find that launched the old harness. Also check whether
a global git hooks path was pointing into the old directory:

```sh
git config --global --get core.hooksPath
# if it points inside the old config dir:
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

Start again and confirm you're still logged in and your memory came back.

---

## 6. Install keel

```
/plugin marketplace add JimmayVV/keel
/plugin install keel@keel
```

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
[ -d "$HOME/.pai-doctrine.old-$STAMP" ] && mv "$HOME/.pai-doctrine.old-$STAMP" "$HOME/.pai-doctrine"
```

Restore the shell alias and `core.hooksPath` if you removed them. The full backup
at `~/claude-backup-$STAMP` remains untouched either way.

---

## Cleanup, once you're happy

Give it a couple of weeks first — the value of the activity log is cumulative, and
you won't know whether you miss the old setup until you've tried to do something
with it.

```sh
rm -rf "$CFG.old-$STAMP" "$HOME/.pai-doctrine.old-$STAMP" "$HOME/keel-carryover"
# keep ~/claude-backup-$STAMP longer, or archive it
```

---

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
