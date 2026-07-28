#!/usr/bin/env bash
# keel bootstrap — unstick a machine whose keel is too old to update itself.
#
# THE PROBLEM THIS EXISTS FOR
#
# `keel update` fixes its own failure modes: it fast-forwards the marketplace
# checkout when `claude plugin marketplace update` doesn't, compares the
# installed commit against it because version-pinned updates no-op, and points
# the PATH entry at the installed copy. Every one of those fixes lives inside
# the keel binary — so a machine running a binary from before them cannot apply
# them. It reports success and stays behind. That is circular, and no amount of
# work on `keel update` can break the circle.
#
# This script is outside the circle. It depends on nothing keel ships except
# the marketplace checkout every installed machine already has.
#
# WHAT IT WILL NOT DO
#
#   * It never runs sudo, and never installs a package manager or a runtime.
#   * It never deletes. The one destructive-looking step, replacing the PATH
#     entry, is delegated to `keel link`, which refuses to touch anything it
#     didn't write.
#   * It never force-pushes, resets, or rebases the marketplace checkout. If
#     that checkout is dirty or has diverged, it says so and stops — it is
#     Claude Code's directory, not keel's.
#   * It is re-runnable. On an already-current machine every step is a no-op.
#
# Usage:
#   bash ~/.claude/plugins/marketplaces/keel/scripts/bootstrap.sh
#   bash scripts/bootstrap.sh --dry-run

set -uo pipefail

CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
MP="$CFG/plugins/marketplaces/keel"
DB="$CFG/plugins/installed_plugins.json"
DRY=0

for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

b()   { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()  { printf '  \033[32m✔\033[0m %s\n' "$1"; }
no()  { printf '  \033[31m✖\033[0m %s\n' "$1"; }
warn(){ printf '  \033[33m!\033[0m %s\n' "$1"; }
dim() { printf '  \033[2m%s\033[0m\n' "$1"; }
run() { if [ "$DRY" = 1 ]; then dim "would run: $*"; else "$@"; fi; }

fail() { no "$1"; shift; for l in "$@"; do dim "$l"; done; printf '\n'; exit 1; }

b "keel bootstrap"
dim "config dir: $CFG"
[ "$DRY" = 1 ] && warn "dry run — nothing will be changed"

# ── 1. prerequisites ────────────────────────────────────────────────────────
# node is checked because the PATH shim execs a node script at run time. A
# missing node here becomes a confusing "command not found" days later.
command -v claude >/dev/null 2>&1 || fail "the claude CLI is not on PATH" \
  "Everything below drives it. Install Claude Code first."
command -v git >/dev/null 2>&1 || fail "git is not on PATH" \
  "Needed to advance the marketplace checkout."
command -v node >/dev/null 2>&1 || fail "node is not on PATH" \
  "keel's CLI and hooks are plain node. Install node, then re-run."

[ -d "$MP/.git" ] || fail "no keel marketplace checkout at $MP" \
  "This script repairs an existing install; it does not create one." \
  "For a first install use:  /plugin marketplace add JimmayVV/keel"

# ── 2. advance the marketplace checkout ─────────────────────────────────────
# `claude plugin marketplace update` has been observed reporting success while
# leaving HEAD where it was — it fetched into origin/main without the checkout
# tracking it. Downstream that produces a perfectly successful update to a stale
# target, so do the fast-forward here rather than trusting the report.
b "1. marketplace checkout"
dirty=$(git -C "$MP" status --porcelain 2>/dev/null)
if [ -n "$dirty" ]; then
  warn "checkout has local changes — leaving it alone"
  dim "keel will not discard edits in Claude Code's directory. Resolve them, then re-run."
else
  before=$(git -C "$MP" rev-parse --short HEAD 2>/dev/null)
  run git -C "$MP" fetch --quiet origin
  if [ "$DRY" = 0 ]; then
    ff=$(git -C "$MP" merge --ff-only origin/HEAD 2>&1)
    after=$(git -C "$MP" rev-parse --short HEAD 2>/dev/null)
    if [ "$before" != "$after" ]; then
      ok "advanced $before → $after"
    elif printf '%s' "$ff" | grep -qiE 'diverge|not possible|refusing'; then
      warn "checkout has diverged from origin — reset it by hand"
      dim "$MP"
    else
      ok "already current at $before"
    fi
  fi
fi

# ── 3. reinstall from the checkout ──────────────────────────────────────────
# `claude plugin update` decides staleness from the version string in
# plugin.json, which rarely moves, so every commit since the last bump is
# invisible to it. Uninstall + install is the only reliable way to make the
# installed copy match the checkout.
#
# Reinstalling resets a plugin to its manifest default, which is NOT the same as
# the state it was in. Adapters ship `defaultEnabled: false` on purpose, so
# reinstalling an enabled one silently disables it — the repair breaks the thing
# it was repairing, and the only symptom is an adapter that quietly stops
# working. Found by running this script: it disabled keel-memory and `keel
# doctor` caught it. Capture enablement first, restore it after.

# Prints "yes" / "no" for an installed plugin, empty when not installed or when
# the roster can't be read. Empty means "don't touch it", never "disabled".
plugin_enabled() {
  claude plugin list --json 2>/dev/null | node -e '
    let s = "";
    const want = process.argv[1];
    process.stdin.on("data", d => s += d).on("end", () => {
      try {
        const hit = JSON.parse(s).find(p => String(p.id ?? "").split("@")[0] === want);
        if (hit) process.stdout.write(hit.enabled ? "yes" : "no");
      } catch (e) { /* no roster — caller treats empty as unknown */ }
    })' "$1"
}

b "2. reinstall keel from the checkout"
if [ "$DRY" = 0 ]; then
  keel_was=$(plugin_enabled keel)
  claude plugin uninstall keel@keel >/dev/null 2>&1
  if claude plugin install keel@keel >/dev/null 2>&1; then
    if [ "$keel_was" = yes ] && [ "$(plugin_enabled keel)" = no ]; then
      claude plugin enable keel@keel >/dev/null 2>&1
    fi
    ok "reinstalled"
  else
    fail "could not install keel@keel" \
      "Run it by hand to see the error:" \
      "  claude plugin install keel@keel"
  fi

  for extra in keel-memory keel-reflect; do
    was=$(plugin_enabled "$extra")
    [ -z "$was" ] && continue   # not installed, or roster unreadable — leave it
    claude plugin uninstall "$extra@keel" >/dev/null 2>&1
    if claude plugin install "$extra@keel" >/dev/null 2>&1; then
      if [ "$was" = yes ]; then
        if claude plugin enable "$extra@keel" >/dev/null 2>&1; then
          ok "reinstalled $extra, re-enabled"
        else
          warn "reinstalled $extra but could not re-enable it"
          dim "fix: claude plugin enable $extra@keel"
        fi
      else
        ok "reinstalled $extra, left disabled as it was"
      fi
    else
      warn "could not reinstall $extra"
    fi
  done
else
  dim "would run: claude plugin uninstall keel@keel && claude plugin install keel@keel"
  dim "would preserve each plugin's enabled state across the reinstall"
fi

# ── 4. hand off to the installed binary ─────────────────────────────────────
# Resolve installPath from installed_plugins.json — Claude Code's own record of
# what it installed — rather than globbing the cache, because an update leaves
# old version directories in place and a glob would pick one at random.
#
# The PATH entry is written by `keel link` rather than here on purpose. That
# keeps one implementation of the shim, in the CLI, where it is tested. A second
# copy in this script is a copy that drifts.
b "3. PATH entry"
BIN=""
if [ "$DRY" = 0 ] && [ -r "$DB" ]; then
  BIN=$(node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      try{const p=JSON.parse(s).plugins["keel@keel"][0].installPath;if(p)process.stdout.write(p+"/bin/keel")}catch(e){}
    })' < "$DB" 2>/dev/null)
fi

if [ "$DRY" = 1 ]; then
  dim "would run: <installed keel> link"
elif [ -z "$BIN" ] || [ ! -x "$BIN" ]; then
  warn "could not resolve the installed binary from $DB"
  dim "The plugin is installed; only the PATH entry is unset. Fix it with:"
  dim "  keel link"
elif "$BIN" --help 2>&1 | grep -q '\blink\b'; then
  # Only opt a machine in if it already had a PATH entry. Repairing one is
  # this script's job; creating one is the user's decision.
  if [ -e "$HOME/.local/bin/keel" ] || [ -L "$HOME/.local/bin/keel" ]; then
    "$BIN" link
  else
    dim "no PATH entry to repair — keel is reachable as a plugin regardless"
    dim "to add one:  $BIN link"
  fi
else
  warn "the installed keel has no 'link' command — the checkout did not advance"
  dim "This machine is still on a version that predates the fix. Check step 1:"
  dim "  git -C $MP log --oneline -1"
fi

# ── 5. verify ───────────────────────────────────────────────────────────────
b "4. verify"
if [ "$DRY" = 1 ]; then
  dim "would run: keel doctor"
elif [ -n "$BIN" ] && [ -x "$BIN" ]; then
  sha=$(node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      try{const c=JSON.parse(s).plugins["keel@keel"][0].gitCommitSha;if(c)process.stdout.write(c.slice(0,7))}catch(e){}
    })' < "$DB" 2>/dev/null)
  want=$(git -C "$MP" rev-parse --short HEAD 2>/dev/null)
  if [ -n "$sha" ] && [ -n "$want" ] && [ "$sha" = "$want" ]; then
    ok "installed copy matches the checkout ($sha)"
  elif [ -n "$sha" ] && [ -n "$want" ]; then
    warn "installed $sha, checkout $want — they should match; re-run to retry"
  fi
  printf '\n'
  "$BIN" doctor
fi

printf '\n'
dim "New sessions pick this up; sessions already running keep their startup state."
dim "From here, 'keel update' maintains this machine on its own."
printf '\n'
