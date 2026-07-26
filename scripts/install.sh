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
#   bash scripts/install.sh --dry-run    # print the plan, change nothing
set -uo pipefail

CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$HOME/claude-backup-$STAMP"
DRY=0; DO_RESET=""; MARKETPLACE="JimmayVV/keel"

for a in "$@"; do
  case "$a" in
    --dry-run)   DRY=1 ;;
    --no-reset)  DO_RESET=no ;;
    --reset)     DO_RESET=yes ;;
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
  printf '\n'; warn "keel needs these before it can install. Run the right line yourself:"
  for m in "${MISSING[@]}"; do
    case "$m" in
      node) dim "sudo apt install -y nodejs      # or: brew install node / winget install OpenJS.NodeJS" ;;
      git)  dim "sudo apt install -y git         # or: brew install git" ;;
      claude) dim "see https://code.claude.com — install and run 'claude' once to log in" ;;
    esac
  done
  printf '\n'; dim "then re-run this script. It is safe to run repeatedly."
  exit 1
fi

# ── 2. back up ──────────────────────────────────────────────────────────────
b $'\n2. Back up'
if [ -d "$CFG" ]; then
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
  dim "no existing config dir — nothing to back up"
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
  dim "Undo at any time:  rm -rf '$CFG' && mv '$CFG.old-$STAMP' '$CFG'"
  if [ "$DO_RESET" = yes ] || ask "Reset to vanilla?" n; then
    warn "close every other Claude Code session before continuing"
    ask "All sessions closed?" y || { no "aborted — nothing changed"; exit 1; }
    CARRY="$HOME/keel-carryover-$STAMP"
    run mkdir -p "$CARRY"
    [ -e "$CFG/.credentials.json" ] && run cp -a "$CFG/.credentials.json" "$CARRY/"
    [ -e "$HOME/.claude.json" ]     && run cp -a "$HOME/.claude.json" "$CARRY/"
    [ -d "$CFG/projects" ]          && run cp -a "$CFG/projects" "$CARRY/projects"
    run mv "$CFG" "$CFG.old-$STAMP"
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
        "$CFG"*|"$CFG.old-$STAMP"*) warn "global git core.hooksPath points into the old config dir ($HP) — unset it:"; dim "git config --global --unset core.hooksPath" ;;
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
run claude plugin marketplace add "$MARKETPLACE"
run claude plugin install keel@keel
[ "$DRY" = 0 ] && ok "installed" || true

# ── 5. configure ────────────────────────────────────────────────────────────
b $'\n5. Configure'
KEELBIN=""
for cand in "$CFG"/plugins/*/keel/plugins/keel/bin/keel "$CFG"/plugins/**/keel/bin/keel; do
  [ -f "$cand" ] && KEELBIN="$cand" && break
done
[ -z "$KEELBIN" ] && [ -f "$(dirname "$0")/../plugins/keel/bin/keel" ] && KEELBIN="$(cd "$(dirname "$0")/.." && pwd)/plugins/keel/bin/keel"

if [ -n "$KEELBIN" ] && [ "$DRY" = 0 ]; then
  node "$KEELBIN" status
  printf '\n'
  if ask "Configure optional adapters now? (interactive)" n; then node "$KEELBIN" setup; fi
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
dim "Verify:      keel status && keel doctor"
dim "Prove it:    start a session, ask something, exit, then: keel log"
dim "Backup:      $BACKUP"
[ -d "$CFG.old-$STAMP" ] && dim "Undo reset:  rm -rf '$CFG' && mv '$CFG.old-$STAMP' '$CFG'"
printf '\n'
