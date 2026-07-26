---
description: Reconstruct what the user actually worked on over a period and draft a summary. Use when they ask "what did I do last week", "what have I been working on", "weekly summary", "help me write my standup/status update", or want to recall work they've forgotten. Combines keel's activity log with git history and pull-request activity.
---

# Weekly work summary

Reconstruct what the user did, grouped by project, and draft something they can
actually use — a status update, a standup note, or evidence for a review.

## Why this needs three sources

`git log` records **artifacts**, not work. A large share of senior engineering
output leaves no commit: evaluating options and picking one, reviewing someone
else's change, reading an unfamiliar subsystem, or investigating something and
concluding not to do it. If you summarise from git alone you will systematically
under-report the most valuable work, and the user will read the summary and feel
like they did nothing.

So use all three, in this order:

| Source | Covers | Command |
|---|---|---|
| keel activity log | questions asked, conclusions reached, dead ends | `keel log --days N --json` |
| git | commits, merges, branches created | `git log` per checkout |
| PRs / tickets | reviews performed, work shipped, tickets moved | Bitbucket / GitHub / Jira MCP if connected |

## Procedure

1. **Start with the activity log**, because it also tells you where to look:

   ```sh
   keel log --days 7 --json
   ```

   The `repos` array lists every checkout with recorded activity. That's your
   search set for step 2 — don't guess at directories or scan the filesystem.

   If the log is empty or nearly so, say so plainly rather than padding from git.
   A young log is not a light week, and conflating them is misleading. Tell the
   user the log has only N days of history and that coverage improves from here.

2. **Get the artifacts.** For each checkout in `repos`:

   ```sh
   git -C <checkout> log --since="<since>" --author="$(git -C <checkout> config user.email)" \
       --pretty=format:'%h %ad %s' --date=short --no-merges
   ```

   Also worth checking, when the branches suggest it: `git -C <checkout> log --since=… --merges`
   for things they landed, and `git -C <checkout> branch --sort=-committerdate` for
   work started but not finished.

3. **Get review and shipping activity** *only if* an MCP server for it is
   connected — check the available tools rather than assuming. Pull requests they
   reviewed are work that appears nowhere else, and they are usually the most
   under-credited item in a status update. Do not invent this section if no
   server is available; omit it and note the omission.

4. **Group by project, not by day.** The user thinks in projects. Within each
   project, lead with what *shipped*, then what was *decided*, then what is *in
   flight*. Merge the three sources — one project's entry should read as a single
   narrative, not three lists stapled together.

5. **Name the loose ends.** Records with no repo, or one-off questions that don't
   match any project, are exactly the work the user told you they cannot
   remember. Surface them in a short "also" section rather than dropping them,
   and propose which project each might belong to — flagging that it's a guess.

6. **Snapshot open work — state, not just flow.** The summary above records what
   *moved*; a snapshot records what's *on the plate*, and productivity is the
   delta between two snapshots plus the flow in between. If ticket/PR MCP servers
   are connected (same discovery as step 3), capture open items assigned to the
   user — issues, PRs authored, PRs awaiting their review — as a dated markdown
   file:

   ```
   $KEEL_MEMORY_HOME/work/snapshots/YYYY-MM-DD-open-work.md
   ```

   One line per item with its key, status, and a link. Consent lives in the
   directory, not in config: if previous snapshots exist there, the practice is
   established — take the new one automatically and **diff against the latest**:
   items gone are throughput, new keys are intake, unchanged items are aging.
   Fold that into a "Delta" section of the summary. If the directory is empty or
   absent, ask once whether to start the practice; a no is a no for this run,
   not forever. If `KEEL_MEMORY_HOME` isn't set, offer the snapshot as text
   output instead — don't invent a location.

## Output shape

```
## Week of <date range>

### <project>
Shipped — <merged work, with PR or commit refs>
Decided — <conclusion reached, and what was rejected>
In flight — <open branches, blocked items>

### Also
- <one-off work, with a guess at where it belongs>

### Delta            (only when a previous snapshot exists)
Closed — <keys that left the open set since last snapshot>
Intake — <new keys that appeared>
Aging — <still open, unchanged status, worth flagging past ~30d>

### Not captured
<anything the sources genuinely couldn't see>
```

Then ask whether they want it reshaped for a specific audience — a standup is
three lines, a manager update leads with outcomes, and review evidence needs
impact and scope rather than activity.

## Rules

- **Never invent activity.** If a source is unavailable or empty, say which and
  move on. A summary the user cannot trust is worse than a short one.
- **Quote their own words** from the activity log for decisions. "Chose TanStack
  Query over SWR for cache invalidation" is far more useful than "researched
  data fetching", and it's already in the log.
- **Distinguish "no evidence" from "no work."** Say "git shows no commits in this
  repo" rather than "you didn't work on this."
- **Keep it short.** The whole point is that they can read it, edit it, and send
  it. Aim for something that fits on one screen per project.
- **Offer to save it.** If they like it, propose writing it into project memory
  so next week's summary has continuity to build on.
- **Snapshots are work data.** Ticket contents and PR titles are employer
  information — the snapshot folder must never sync to a personal remote
  (see NETWORKING.md). Note this in the file itself the first time you write one.
