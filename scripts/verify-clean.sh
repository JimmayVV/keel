#!/usr/bin/env bash
# verify-clean.sh — prove keel works on a machine that has nothing.
#
# The failure this exists to catch is "works on my machine": a guide written from
# a developer box silently assumes bun, jq, python3.12, a warm npm cache, or a
# $PATH that took years to accumulate. This runs the parts of the install that
# don't need authentication, on a clean image, and fails loudly.
#
# What it CANNOT verify: anything requiring a logged-in Claude Code — marketplace
# install, plugin registration, live hook dispatch. Those are verified on a real
# machine instead. This covers the code we wrote, which is the part most likely
# to carry a bad assumption.
#
# Usage:  docker build -f Dockerfile.verify -t keel-verify . && docker run --rm keel-verify
set -uo pipefail

PASS=0; FAIL=0
ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31m✖\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

KEEL="${KEEL_SRC:-/keel}/plugins/keel"
export CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-/tmp/cfg}"
export KEEL_ACTIVITY_DIR="$CLAUDE_CONFIG_DIR/keel/activity"
mkdir -p "$CLAUDE_CONFIG_DIR"

head_ "Environment (what a clean box actually has)"
command -v node >/dev/null && ok "node $(node --version)" || bad "node missing — keel's hard requirement"
command -v git  >/dev/null && ok "git $(git --version | awk '{print $3}')" || bad "git missing"
for absent in bun deno jq uv uvx; do
  command -v "$absent" >/dev/null && printf '  \033[2m·\033[0m %s present (not required)\n' "$absent" \
    || printf '  \033[2m·\033[0m %s absent — correct, keel must not need it\n' "$absent"
done
PY=$(python3 --version 2>/dev/null | awk '{print $2}' || echo none)
printf '  \033[2m·\033[0m python3 %s %s\n' "$PY" \
  "$(printf '%s\n3.12' "$PY" | sort -V | head -1 | grep -q '^3.12' && echo '(≥3.12: notes adapter could run natively)' || echo '(<3.12: notes adapter needs uv to provision)')"

head_ "Syntax — every shipped script parses on this node"
for f in "$KEEL"/hooks/*.mjs "$KEEL"/bin/keel; do
  node --check "$f" 2>/dev/null && ok "$(basename "$f")" || bad "$(basename "$f") failed to parse"
done

head_ "Guards fire, and fail open"
r=$(printf '%s' '{"hook_event_name":"PostToolUse","tool_name":"WebFetch","tool_input":{"url":"https://x.test"},"tool_response":"hi"}' \
    | node "$KEEL/hooks/untrusted-content.mjs" 2>/dev/null)
printf '%s' "$r" | grep -q 'untrusted-content' && ok "ingest boundary wraps web results" || bad "ingest boundary did not wrap"
printf '%s' 'not json' | node "$KEEL/hooks/untrusted-content.mjs" >/dev/null 2>&1 \
  && ok "ingest boundary fails open on garbage" || bad "ingest boundary crashed on garbage"

TRAILER="Co-Authored""-By: Claude"
printf '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \\"x\\n\\n%s\\""}}' "$TRAILER" \
  | node "$KEEL/hooks/commit-trailer-guard.mjs" >/dev/null 2>&1
[ $? -eq 2 ] && ok "commit guard blocks with exit 2" || bad "commit guard did not block"
printf '%s' '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git commit -m \"clean\""}}' \
  | node "$KEEL/hooks/commit-trailer-guard.mjs" >/dev/null 2>&1
[ $? -eq 0 ] && ok "commit guard allows clean commits" || bad "commit guard blocked a clean commit"

head_ "Activity capture — including outside a git repo"
rm -rf "$KEEL_ACTIVITY_DIR"
printf '%s' '{"hook_event_name":"UserPromptSubmit","session_id":"s1","cwd":"/tmp","prompt":"which data fetching library should I use?"}' \
  | node "$KEEL/hooks/activity-log.mjs" >/dev/null 2>&1
[ -n "$(ls -A "$KEEL_ACTIVITY_DIR" 2>/dev/null)" ] && ok "captures with no git repo present" || bad "captured nothing outside a repo"
grep -q '"repo":null' "$KEEL_ACTIVITY_DIR"/*.jsonl 2>/dev/null \
  && ok "records repo:null rather than guessing" || bad "expected repo:null outside a repo"

# Inside a real repo, attribution must appear.
R=/tmp/repo; rm -rf "$R"; mkdir -p "$R"; cd "$R"
git init -q . && git -c user.email=a@b -c user.name=A commit -q --allow-empty -m init 2>/dev/null
printf '{"hook_event_name":"UserPromptSubmit","session_id":"s2","cwd":"%s","prompt":"investigating the failing release gate"}' "$R" \
  | node "$KEEL/hooks/activity-log.mjs" >/dev/null 2>&1
grep -q '"repo":"repo"' "$KEEL_ACTIVITY_DIR"/*.jsonl 2>/dev/null \
  && ok "attributes work to the repo" || bad "repo attribution failed"

# A linked worktree must group under its parent project, not look like a new one.
git -C "$R" worktree add -q -b wt /tmp/wt 2>/dev/null
printf '{"hook_event_name":"UserPromptSubmit","session_id":"s3","cwd":"/tmp/wt","prompt":"testing the worktree grouping behaviour"}' \
  | node "$KEEL/hooks/activity-log.mjs" >/dev/null 2>&1
python3 - <<'PY' && ok "worktree groups under parent project" || bad "worktree did not group under parent"
import glob, json, sys, os
rows = [json.loads(l) for f in glob.glob(os.environ["KEEL_ACTIVITY_DIR"] + "/*.jsonl") for l in open(f) if l.strip()]
wt = [r for r in rows if r.get("worktree")]
sys.exit(0 if wt and all(r["repo"] == "repo" for r in wt) else 1)
PY

printf '%s' '{"hook_event_name":"UserPromptSubmit","session_id":"s4","cwd":"/tmp","prompt":"x"}' \
  | node "$KEEL/hooks/activity-log.mjs" >/dev/null 2>&1
[ "$(grep -c '"kind":"ask"' "$KEEL_ACTIVITY_DIR"/*.jsonl)" -eq 3 ] \
  && ok "skips trivial prompts" || bad "did not skip a trivial prompt"

KEEL_ACTIVITY_OFF=1 node "$KEEL/hooks/activity-log.mjs" \
  <<< '{"hook_event_name":"UserPromptSubmit","cwd":"/tmp","prompt":"this must not be recorded"}' >/dev/null 2>&1
grep -q 'must not be recorded' "$KEEL_ACTIVITY_DIR"/*.jsonl 2>/dev/null \
  && bad "KEEL_ACTIVITY_OFF was ignored" || ok "KEEL_ACTIVITY_OFF disables capture"

head_ "CLI on a clean box"
node "$KEEL/bin/keel" status >/dev/null 2>&1 && ok "status runs with no config" || bad "status failed"
node "$KEEL/bin/keel" status 2>/dev/null | grep -q "Working now" && ok "status leads with what works unconfigured" || bad "status missing the free tier"
node "$KEEL/bin/keel" log >/dev/null 2>&1 && ok "log runs" || bad "log failed"
node "$KEEL/bin/keel" log --json 2>/dev/null | python3 -c 'import json,sys; json.load(sys.stdin)' \
  && ok "log --json emits valid JSON" || bad "log --json invalid"
node "$KEEL/bin/keel" doctor >/dev/null 2>&1; [ $? -le 1 ] && ok "doctor exits 0 or 1, never crashes" || bad "doctor crashed"

# The setup path must not hang when nothing is a TTY — the bug that shipped once.
timeout 10 node "$KEEL/bin/keel" setup --non-interactive </dev/null >/dev/null 2>&1
[ $? -ne 124 ] && ok "setup does not hang without a TTY" || bad "setup hung waiting for input"

# And it must never damage foreign config.
printf '%s' '{"model":"opus","env":{"KEEP_ME":"yes"},"permissions":{"defaultMode":"auto"}}' > "$CLAUDE_CONFIG_DIR/settings.json"
node "$KEEL/bin/keel" setup --memory-home /tmp/notes --skip reflect >/dev/null 2>&1
python3 - <<PY && ok "setup preserves foreign settings keys" || bad "setup damaged foreign config"
import json,sys
d=json.load(open("$CLAUDE_CONFIG_DIR/settings.json"))
sys.exit(0 if d.get("model")=="opus" and d["env"].get("KEEP_ME")=="yes"
         and d["permissions"]["defaultMode"]=="auto" and "KEEL_MEMORY_HOME" in d["env"] else 1)
PY

head_ "Result"
printf '  %d passed, %d failed\n\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
