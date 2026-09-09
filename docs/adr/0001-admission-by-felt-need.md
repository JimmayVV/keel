---
status: accepted
---

# Admission by felt need, tiered by teardown cost

keel's two founding rules — own your config / buy your capabilities, and documented
surfaces only — govern what keel may *build* and *touch*, but not what it should
*carry*: every well-argued feature passes both, which is how harnesses accrete. So
additions are admitted by tier. **Prose is free** — teardown is `rm`. **A test is
admitted when it catches a failure class that has already occurred in this repo**, not
one imagined from someone else's. **Runtime — hooks, subcommands, anything a session
executes — requires a felt need: at least once, here, to the user.** "Another harness
found it useful" is an argument from someone else's life, not admission.

One clause with teeth: anything that fails silent on removal (a hook, unlike a
subcommand) must ship with the check that would notice — a test or a `keel doctor`
report. The one completed teardown (the sync layer, ADR-0002) was the best case for a
clean removal and still left stale doc claims behind; cheap teardown is a property you
enforce, not a prediction you make at stand-up.

A parked candidate names the event that admits it; a tripwire names the date that
removes it. **A tripwire with a date is a GitHub issue with that date in its title.**
The memory file or ADR holds the reasoning; the issue holds the alarm. A date that
lives only in a note fires only when someone happens to read the note — the telos
tripwire (2026-09-01) was found a week late that way.
