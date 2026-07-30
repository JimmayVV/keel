---
description: Track spoken commitments and answer "where do I stand?" Use when the user states a commitment, promise, or deadline in conversation ("I need to review that PR so it can merge by Wednesday", "remind me I owe X"), or asks about standing and priorities — "where do I stand", "what's next", "what should I work on", "what are my priorities", "what's on my plate", "what's done". Merges recorded commitments with live PR/ticket status and the activity log, then curates an order from the user's spoken preferences.
---

# Deck — what's promised, what's next

The `week` skill looks backward; this one looks forward. Its job is to let the
user say a commitment out loud, shut the machine down, and get it back tomorrow
in a fresh session — merged with the technical facts the tools can see and
ordered the way the user says, not the way a due-date field sorts.

## The one file

```
$KEEL_MEMORY_HOME/work/commitments.md
```

Two sections: **Open** and **Done — <month>**. One commitment per line:

```
- <the user's own words> — by <horizon> — why: <stake> — <link> (recorded YYYY-MM-DD)
```

The note stores **promises, never states**. Whether the PR merged or the ticket
moved is derivable — checked live at triage, never written down. A stored
status is a cache with no invalidation; a stored promise is the one thing no
tool can reconstruct.

If `KEEL_MEMORY_HOME` isn't set, offer the record as text instead — don't
invent a location.

## Capture — when a commitment is spoken

In any session, any repo: when the user states a commitment or deadline
conversationally, offer once to record it. Keep their words — "review it deeply
enough that it can merge by Wednesday" carries the actual priority; "review PR"
does not. Add the horizon, the stake if they said one, and a link to the PR or
ticket if one is in view. A no is a no for that item, not the practice.

## Triage — "where do I stand?"

1. **Read the file.** Empty or absent → say so plainly and ask whether to start
   the practice. Never pad an empty deck from git.

2. **Verify every pointer live** — only via MCP servers actually connected
   (check the available tools; never assume). PR merged or approved? Ticket
   moved, due, overdue? An unreachable tracker makes an item "unverified", not
   done and not invented.

3. **Pull recent motion**: `keel log --days 3 --json` for what's actually been
   worked, so "in flight" is evidence rather than memory.

4. **Report in three parts:**
   - **Done** — commitments whose pointer says finished. Move them to the Done
     section with today's date; that's what makes "what have I accomplished?"
     answerable without archaeology.
   - **Facts first** — anything where the tools contradict or sharpen the
     promise: *"Jira says this was due last week"*, *"that PR got two new
     commits since you reviewed."* Include the quiet one: a commitment with no
     visible motion since it was recorded — a promise with no next move is
     exactly what a due-date sort never surfaces.
   - **Open, in proposed order** — with one-line reasons drawn from horizons,
     stakes, and the facts above. If a Telos note exists in this machine's
     store, its objectives ranking informs the order — a commitment serving a
     top objective outranks one serving none.

5. **Let the user reorder in natural language.** Their answer is the decided
   order — rewrite Open in that sequence and keep their words as the reason.
   Spoken preference beats a due-date field: flag the conflict ("this puts the
   overdue ticket third"), then obey.

For "what have I accomplished this week?" — that's the `week` skill's
question. Run it and lead with its answer; the Done section is a supplement,
not a substitute.

## Rules

- **Never invent status.** Unverifiable is a category, and it's said out loud.
- **Pointers, not copies.** Ticket titles and PR contents live in their
  systems; the note holds the promise and a link.
- **Forget by omission.** An item the user says no longer matters is dropped on
  the next rewrite, not marked or archived. Lapsed clutter is what makes a
  priority list unread.
- **Employer data stays put.** Commitments on a work machine are work data —
  the note must never live in a store that syncs to a personal remote (see
  NETWORKING.md). Note this in the file the first time it's created.
- **Quote the user.** The register of their own words is the interface; the
  moment it reads like a ticketing system, it has failed.

## Output shape

```
## Where you stand — <date>

Done       — <commitment>, confirmed by <source>
Facts      — <tool-derived contradictions or sharpenings, if any>
Next       — 1. <commitment> — <reason, in or near the user's words>
             2. …
Unverified — <items whose tracker was unreachable, if any>
```

Then ask whether the order matches their head — and rewrite the note if they
change it.
