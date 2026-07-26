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

## Output shape

```
## Week of <date range>

### <project>
Shipped — <merged work, with PR or commit refs>
Decided — <conclusion reached, and what was rejected>
In flight — <open branches, blocked items>

### Also
- <one-off work, with a guess at where it belongs>

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
