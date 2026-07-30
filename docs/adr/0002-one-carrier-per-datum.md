---
status: accepted
---

# One carrier per datum; knowledge classified by falsifiability

Removing the data-repo sync layer (`1d19d66`) was right for memory — the adapter
already carried it, and two carriers is ambiguity with no rule for which wins — but the
removal was one mechanism carrying four data classes, and it left the others (activity
log, instructions, onboarding) with zero carriers, discovered later as stale docs.
Decision: **every datum keel touches is classified and gets exactly one named
carrier** — zero is a gap, two is ambiguity.

Knowledge classifies by who can falsify it. **Derivable** (a grep can): carrier is
looking — registry, then the live repo — never stored, so it cannot go stale.
**Decided** (only the user can): carrier is the notes store, as a pointer and a why,
never a copy of what grep can find. **Logic** (a test suite can): carrier is a package,
extracted only after real duplication. Machine facts stay in auto-memory;
observations stay in the machine-local activity log, whose only reader lives where it
is written.

Per-machine variation is handled by **convention, not configuration**: personal
projects live at `~/personal/<name>` on every personal machine. A box that deviates is
fixed with `mv`, not adapted to — the alternative (a typed config loader mapping paths
per machine) is permanent load-bearing machinery solving a problem a one-line decision
deletes.
