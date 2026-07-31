---
description: Diagnose keel on this machine and offer to repair what's broken. Runs `keel doctor`, explains each finding in plain terms, and applies the fix it prints — with consent — re-checking until clean. Use when the user asks to check, diagnose, verify, or fix keel — "is keel healthy", "check keel", "keel doctor", "why isn't my memory working", "fix keel setup".
---

# Doctor — diagnose, then repair

`keel doctor` reports what's wired, what's broken, and prints the exact command
to fix each problem. The bare command diagnoses; this skill closes the loop —
it runs doctor, translates the findings, and offers to run the fixes rather than
leaving the user to copy them.

## Procedure

1. **Run `keel doctor`.** Exit 0 means healthy — say so plainly and stop; a
   clean bill is the common case and deserves a one-line answer, not a lecture.

2. **For each problem, explain and offer the fix.** Doctor prints a `fix:` line
   with each finding. Translate the finding into one plain sentence (what's
   wrong, what it costs), then offer to run its fix. Never run a fix silently —
   name it first. Apply the ones the user approves.

3. **The Basic Memory registration loop** is the one worth knowing. If doctor
   says *no project maps to this directory* or *no projects registered*, the
   printed fix is a `basic-memory project add keel … && … project default keel`.
   Run it, then run `keel doctor` again — Basic Memory keeps a project registry
   separate from the notes directory, and only a re-check confirms the notes
   store actually works. Repeat until that line goes green.

4. **Re-run `keel doctor` after applying fixes**, and report the new state. The
   run is done when doctor exits 0, or when you've named exactly what remains
   and why it isn't auto-fixable (e.g. a missing `uvx` the user must install, or
   a backend deliberately wired outside keel).

## Rules

- **Doctor is the oracle** — a fix worked when doctor agrees, not when its own
  output looked hopeful.
- **Consent per fix.** Diagnosis is free; every repair is named before it runs.
  Doctor's fixes are safe and idempotent, but they are still the user's call.
- **Distinguish broken from deliberate.** A backend "wired outside keel"
  (Hindsight via `claude mcp add`) is doctor reporting reality, not a fault —
  don't try to "fix" it.
- **Short when healthy.** The whole value on a good machine is a fast, trustworthy
  "all good." Don't pad it.
