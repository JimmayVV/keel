#!/usr/bin/env bash
# keel installer — back up, optionally reset, install, configure.
#
# Principles, because an installer that surprises you is worse than no installer:
#   * It never runs sudo. Where a system package is missing it prints the exact
#     command and waits for you to run it in another terminal. You stay the one
#     who elevates.
#   * It never deletes. The reset step is a `mv`, and it prints the one-line
#     undo before doing anything.
#   * Every step is skippable and the whole thing is re-runnable.
#
# Usage:
#   bash scripts/install.sh              # interactive
#   bash scripts/install.sh --no-reset   # install alongside an existing setup
#   bash scripts/install.sh --no-backup  # skip the backup step (e.g. using this as an updater)
#   bash scripts/install.sh --dry-run    # print the plan, change nothing

# ── architecture gate ───────────────────────────────────────────────────────
# Refuse up front rather than failing confusingly two hundred lines later.
# This script expands possibly-empty arrays under `set -u`, which aborts with
# "unbound variable" on bash 3.2 — the version macOS still ships as /bin/bash
# for licensing reasons. A wrong-shell failure should name the shell, not
# surface as a mysterious error at the dependency check.
if [ -z "${BASH_VERSINFO:-}" ]; then
  echo "keel's installer requires bash. Re-run it as:  bash scripts/install.sh" >&2
  exit 1
fi
if [ "${BASH_VERSINFO[0]}" -lt 4 ] ||
   { [ "${BASH_VERSINFO[0]}" -eq 4 ] && [ "${BASH_VERSINFO[1]}" -lt 4 ]; }; then
  cat >&2 <<EOF
keel's installer needs bash 4.4 or newer. This is bash ${BASH_VERSION}.

macOS ships bash 3.2 as /bin/bash, where this script's array handling aborts
under 'set -u'. A newer bash is one command away:

  brew install bash
  /opt/homebrew/bin/bash scripts/install.sh   # Apple silicon
  /usr/local/bin/bash scripts/install.sh      # Intel

Nothing has been changed.
EOF
  exit 1
fi

set -uo pipefail

CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
STAMP=$(date +%Y%m%d-%H%M%S)

# keel puts nothing directly in $HOME. Backups, carryover, and the displaced old
# config are the installer's files, not the user's, and a home directory full of
# claude-backup-20260727-004512 is how a tool wears out its welcome. XDG state is
# where machine-local, regenerable-ish data belongs.
KEEL_STATE="${XDG_STATE_HOME:-$HOME/.local/state}/keel"
BACKUP="$KEEL_STATE/backups/claude-$STAMP"
DRY=0; DO_RESET=""; DO_BACKUP=""; MARKETPLACE="JimmayVV/keel"

for a in "$@"; do
  case "$a" in
    --dry-run)   DRY=1 ;;
    --no-reset)  DO_RESET=no ;;
    --reset)     DO_RESET=yes ;;
    --no-backup) DO_BACKUP=no ;;
    --backup)    DO_BACKUP=yes ;;
    --marketplace=*) MARKETPLACE="${a#*=}" ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

b()   { printf '\033[1m%s\033[0m\n' "$1"; }
ok()  { printf '  \033[32m✔\033[0m %s\n' "$1"; }
no()  { printf '  \033[31m✖\033[0m %s\n' "$1"; }
warn(){ printf '  \033[33m!\033[0m %s\n' "$1"; }
dim() { printf '  \033[2m%s\033[0m\n' "$1"; }
run() { if [ "$DRY" = 1 ]; then dim "would run: $*"; else "$@"; fi; }
ask() { # ask "question" default(y|n) -> 0 for yes
  local q="$1" d="${2:-n}" a
  if [ ! -t 0 ]; then [ "$d" = y ]; return; fi
  read -r -p "  $q $([ "$d" = y ] && echo '[Y/n]' || echo '[y/N]') " a </dev/tty
  a=${a:-$d}; [[ "$a" =~ ^[Yy] ]]
}

printf '\n'; b "keel installer"
[ "$DRY" = 1 ] && warn "dry run — nothing will change"
dim "config dir: $CFG"

# ── 1. dependencies ─────────────────────────────────────────────────────────
b $'\n1. Dependencies'
MISSING=()
for c in node git; do
  if command -v "$c" >/dev/null 2>&1; then ok "$c $("$c" --version 2>&1 | head -1)"; else no "$c missing"; MISSING+=("$c"); fi
done
if command -v claude >/dev/null 2>&1; then ok "claude $(claude --version 2>&1 | head -1)"; else no "claude missing"; MISSING+=(claude); fi


if [ ${#MISSING[@]} -gt 0 ]; then
  printf '\n'; warn "keel needs these first. Run the right line yourself — this script never sudos:"
  for m in "${MISSING[@]}"; do
    case "$m" in
      node) dim "sudo apt install -y nodejs      # or: brew install node / winget install OpenJS.NodeJS" ;;
      git)  dim "sudo apt install -y git         # or: brew install git" ;;
      claude) dim "see https://code.claude.com — install it, then run 'claude' once to log in" ;;
    esac
  done
  printf '\n'; dim "then re-run this script. It is safe to run repeatedly."
  # A dry run exists to show the whole plan. Exiting here would hide it, so keep
  # going and let the reader see everything that would happen once deps are in.
  if [ "$DRY" = 0 ]; then exit 1; else warn "continuing anyway to show the rest of the plan (dry run)"; fi
fi

# Readiness of the OPTIONAL adapters — worth knowing before you start, not after.
printf '\n'; dim "optional adapter readiness:"
PYV=$(python3 --version 2>/dev/null | awk '{print $2}')
if command -v uvx >/dev/null 2>&1; then
  dim "notes adapter: uv present — ready"
elif [ -n "$PYV" ] && [ "$(printf '%s\n3.12\n' "$PYV" | sort -V | head -1)" = "3.12" ]; then
  dim "notes adapter: python $PYV is new enough; needs uv — pip3 install --user uv"
else
  dim "notes adapter: python ${PYV:-none} is below 3.12; uv will provision one — pip3 install --user uv"
fi
dim "reflection:    not in v0.1 — nothing to prepare"

# ── 2. back up ──────────────────────────────────────────────────────────────
b $'\n2. Back up'
if [ ! -d "$CFG" ]; then
  dim "no existing config dir — nothing to back up"
elif [ "$DO_BACKUP" = no ]; then
  dim "skipped (--no-backup)"
elif [ "$DO_BACKUP" = yes ] || ask "Back up $CFG before continuing?" y; then
  if git -C "$CFG" rev-parse --git-dir >/dev/null 2>&1; then
    AB=$(git -C "$CFG" rev-list --left-right --count HEAD...@{upstream} 2>/dev/null || echo "? ?")
    DIRTY=$(git -C "$CFG" status --porcelain 2>/dev/null | wc -l)
    dim "config dir is a git repo — ahead/behind: $AB, dirty: $DIRTY file(s)"
    [ "$DIRTY" -gt 0 ] && warn "uncommitted changes present; consider committing before you continue"
  fi
  run mkdir -p "$BACKUP/secrets"
  [ "$DRY" = 1 ] || chmod 700 "$BACKUP" "$BACKUP/secrets"
  for f in "$CFG/.credentials.json" "$CFG/settings.local.json" "$HOME/.claude.json"; do
    [ -e "$f" ] && run cp -a "$f" "$BACKUP/secrets/"
  done
  [ "$DRY" = 1 ] || chmod 600 "$BACKUP"/secrets/* 2>/dev/null
  # Config + memory, without the bulk that is regenerable or already in git.
  run tar -czf "$BACKUP/claude-config.tar.gz" -C "$(dirname "$CFG")" \
      --exclude="$(basename "$CFG")/.git" \
      --exclude="$(basename "$CFG")/projects/*/*.jsonl" \
      --exclude="$(basename "$CFG")/history.jsonl" \
      --exclude="$(basename "$CFG")/file-history" \
      --exclude="$(basename "$CFG")/sessions" \
      --exclude="$(basename "$CFG")/shell-snapshots" \
      --exclude="$(basename "$CFG")/session-env" \
      --exclude="$(basename "$CFG")/plugins/cache" \
      "$(basename "$CFG")" 2>/dev/null
  if [ "$DRY" = 0 ] && [ -f "$BACKUP/claude-config.tar.gz" ]; then
    ok "backup: $BACKUP ($(du -sh "$BACKUP" | cut -f1))"
    dim "memory files preserved: $(tar -tzf "$BACKUP/claude-config.tar.gz" | grep -c 'memory/.*\.md' || echo 0)"
  else
    [ "$DRY" = 1 ] && dim "would back up to $BACKUP"
  fi
else
  dim "skipped — editing $CFG in place"
fi

# ── 3. reset (optional) ─────────────────────────────────────────────────────
b $'\n3. Reset to vanilla'
if [ ! -d "$CFG" ]; then
  dim "already vanilla"
elif [ "$DO_RESET" = no ]; then
  dim "skipped (--no-reset) — keel will install alongside your current setup"
else
  # Some harnesses assemble the config dir out of symlinks into a second
  # repository. Report those rather than guessing at a path: the links live
  # INSIDE the config dir, so moving it aside already breaks them, and the other
  # repository is not ours to move.
  EXTERNAL=$(find "$CFG" -maxdepth 3 -type l -exec readlink -f {} \; 2>/dev/null \
             | grep -v "^$CFG" | sed "s|^\($HOME/[^/]*\).*|\1|" | sort -u || true)
  if [ -n "$EXTERNAL" ]; then
    warn "parts of your config are symlinked in from elsewhere:"
    printf '%s\n' "$EXTERNAL" | while read -r t; do dim "$t"; done
    dim "Those links live inside the config dir, so moving it aside removes them."
    dim "The directories above are left untouched — that is your route back."
  fi

  dim "This moves your current setup aside and keeps your login and memory."
  dim "Undo at any time:  rm -rf '$CFG' && mv '$KEEL_STATE/previous-config-$STAMP' '$CFG'"
  if [ "$DO_RESET" = yes ] || ask "Reset to vanilla?" n; then
    warn "close every other Claude Code session before continuing"
    ask "All sessions closed?" y || { no "aborted — nothing changed"; exit 1; }
    CARRY="$KEEL_STATE/carryover-$STAMP"
    run mkdir -p "$CARRY"
    [ -e "$CFG/.credentials.json" ] && run cp -a "$CFG/.credentials.json" "$CARRY/"
    [ -e "$HOME/.claude.json" ]     && run cp -a "$HOME/.claude.json" "$CARRY/"
    [ -d "$CFG/projects" ]          && run cp -a "$CFG/projects" "$CARRY/projects"
    run mv "$CFG" "$KEEL_STATE/previous-config-$STAMP"
    run mkdir -p "$CFG"
    [ -e "$CARRY/.credentials.json" ] && run cp -a "$CARRY/.credentials.json" "$CFG/"
    [ -d "$CARRY/projects" ]          && run cp -a "$CARRY/projects" "$CFG/projects"
    [ "$DRY" = 1 ] && dim "would reset, carrying over login and per-project memory" \
                   || ok "reset — login and per-project memory carried over"
    # Two things that survive a config-dir move and can quietly resurrect the old
    # setup or point tooling at a directory that no longer exists.
    HP=$(git config --global --get core.hooksPath 2>/dev/null || true)
    if [ -n "$HP" ]; then
      case "$HP" in
        "$CFG"*|"$KEEL_STATE/previous-config-$STAMP"*) warn "global git core.hooksPath points into the old config dir ($HP) — unset it:"; dim "git config --global --unset core.hooksPath" ;;
        *) dim "global git core.hooksPath is set to '$HP' (outside the config dir — left alone)" ;;
      esac
    fi
    for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
      [ -f "$rc" ] || continue
      if grep -qsE "alias [A-Za-z0-9_-]+=.*($(basename "$CFG")|claude)" "$rc"; then
        warn "$rc defines aliases referencing your config dir — review them:"
        grep -nsE "alias [A-Za-z0-9_-]+=.*($(basename "$CFG")|claude)" "$rc" | head -4 | while read -r l; do dim "$l"; done
      fi
    done
  else
    dim "skipped — installing alongside your current setup"
  fi
fi

# ── 4. install ──────────────────────────────────────────────────────────────
b $'\n4. Install keel'
if ! run claude plugin marketplace add "$MARKETPLACE"; then
  no "could not add marketplace $MARKETPLACE"; exit 1
fi
# `add` is a no-op once the marketplace is known — `update` is what actually
# re-fetches it, which is why a re-run needs both.
run claude plugin marketplace update || warn "marketplace refresh failed — proceeding with what's on disk"
if [ "$DRY" = 0 ]; then
  # Likewise: `install` no-ops if keel is already installed, so a re-run needs
  # `update` too, or you're stuck on whatever version you first installed.
  if claude plugin install keel@keel && claude plugin update keel@keel; then
    ok "installed (latest)"
  else
    no "install failed — see errors above"; exit 1
  fi
  # Adapter bridge plugins (installed later via `keel setup`) rot on the same
  # schedule keel itself would have: update every keel-marketplace plugin that
  # is actually installed, not just the one this script installs.
  for extra in keel-memory keel-reflect; do
    if claude plugin list --json 2>/dev/null | grep -q "\"$extra@keel\""; then
      run claude plugin update "$extra@keel" && ok "$extra updated" \
        || warn "$extra update failed — run: claude plugin update $extra@keel"
    fi
  done
else
  dim "would run: claude plugin install keel@keel"
  dim "would run: claude plugin update keel@keel"
  dim "would update any installed bridge plugins (keel-memory, keel-reflect)"
fi

# ── 5. configure ────────────────────────────────────────────────────────────
b $'\n5. Configure'
# Prefer the actually-installed cache copy over the marketplace checkout — the
# two can diverge (e.g. a marketplace add that didn't refresh).
KEELBIN=""
for base in "$CFG/plugins/cache" "$CFG/plugins/marketplaces"; do
  [ -d "$base" ] || continue
  found=$(find "$base" -type f -path "*/bin/keel" 2>/dev/null | sort | tail -1)
  [ -n "$found" ] && KEELBIN="$found" && break
done
[ -z "$KEELBIN" ] && [ -f "$(dirname "$0")/../plugins/keel/bin/keel" ] && KEELBIN="$(cd "$(dirname "$0")/.." && pwd)/plugins/keel/bin/keel"

if [ -n "$KEELBIN" ] && [ "$DRY" = 0 ]; then
  node "$KEELBIN" status
  printf '\n'

  # Name this machine. The activity log scopes files by month and device, and
  # the fallback is hostname() — which on WSL is the Windows machine name, so
  # two boxes can collide silently. One prompt now beats finding a month of work
  # attributed to the wrong machine later.
  if ask "Name this machine for the activity log?" y; then
    node "$KEELBIN" setup --skip memory,reflect
  else
    dim "later:  keel setup --device <name>"
  fi

  if ask "Configure optional adapters now? (interactive)" n; then node "$KEELBIN" setup; fi

  # keel deliberately isn't on your shell's PATH by default — Claude's Bash tool
  # finds it on its own. Linking it into ~/.local/bin is opt-in, for people who'd
  # rather type `keel` themselves.
  #
  # `keel link` writes a shim rather than a symlink, and owns the whole decision
  # — including refusing to touch a file it didn't write. A symlink here would
  # name a version, and an update leaves the old version directory in place, so
  # the link would go on resolving to stale code with nothing to indicate it.
  # One implementation of that rule, in the CLI, not two that can drift.
  printf '\n'
  LOCALBIN="$HOME/.local/bin"
  if grep -q "keel-path-shim" "$LOCALBIN/keel" 2>/dev/null; then
    dim "keel already on your PATH: $LOCALBIN/keel"
  elif ask "Add 'keel' to your PATH ($LOCALBIN)?" n; then
    node "$KEELBIN" link --dir "$LOCALBIN"
  fi
else
  dim "run 'keel status' in a new session to see what is active"
fi

b $'\n6. Status line (optional)'
dim "ccstatusline is a maintained status line with a live-preview configurator."
dim "It covers usage limits, reset timers, git and worktree state out of the box."
if ask "Launch the status line configurator?" n; then
  run npx -y ccstatusline@latest
else
  dim "later:  npx -y ccstatusline@latest"
fi

# ── done ────────────────────────────────────────────────────────────────────
b $'\nDone'
if [ -e "$HOME/.local/bin/keel" ]; then
  dim "Verify:      keel status && keel doctor"
  dim "Prove it:    start a session, ask something, exit, then: keel log"
else
  dim "Verify:      ask Claude to run 'keel status && keel doctor'"
  dim "Prove it:    start a session, ask something, exit, then ask Claude: keel log"
fi
[ -d "$BACKUP" ] && dim "Backup:      $BACKUP"
[ -d "$KEEL_STATE/previous-config-$STAMP" ] && dim "Undo reset:  rm -rf '$CFG' && mv '$KEEL_STATE/previous-config-$STAMP' '$CFG'"
printf '\n'
