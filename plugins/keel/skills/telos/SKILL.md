---
description: Build or refresh a TELOS file — rank-sorted objectives, season-scale goals, and a mission statement — from the evidence this machine can see, then interrogate the user about its accuracy, hardest at the top. Deliberately never loaded ambiently. Invoked as /telos.
disable-model-invocation: true
---

# Telos — what it's all for, checked against what you actually do

A telos file states purpose in layers, so decisions at every scale have something
to answer to. This skill exists because such a file has two failure modes: it
drifts stale, and it describes who the user wishes they were rather than who
they are. The countermeasure for both is the same — **confront the stated telos
with the revealed one**, on demand, and never let the file steer a session the
user didn't point it at.

**Never injected.** No hook reads this file, no session loads it ambiently.
It is read when the user invokes `/telos`, or when another skill deliberately
consults it (deck's triage may use the objectives ranking to inform order).
Staleness is handled by ritual, not machinery: on every invoke, say how old the
file is, and suggest a check-in if a season has passed.

## The file

One note in this machine's memory store, titled **Telos** (fallback:
`$KEEL_MEMORY_HOME/telos.md` if no notes tool is wired; offer text if neither).

**The store defines the scope.** A work machine's store holds a work telos,
built only from work sources, rank-sorting work objectives — personal feelings
left at the door by construction, because the personal network's evidence
isn't reachable from here. A personal machine's store holds the personal one.
Never blend them; state the scope in the file's first line.

## Three layers, three evidence standards

| Layer | Scale | Where it comes from | Grilling |
|---|---|---|---|
| **Objectives** | weeks–quarter | derived from tools, rank-sorted | light — mostly facts |
| **Goals** | season–year | proposed from evidence, confirmed by user | moderate |
| **Mission** | years | **stated by the user only** | hardest |

The register rule, and it is absolute: observation and conclusion are different
things. Objectives may be *derived* ("six of your last ten sessions touched the
migration — cited"). A mission may **never** be derived — presenting a pattern
mined from logs as the user's purpose is a fumbled week laundered into an
identity. For the top layer the skill drafts nothing as fact: it offers
hypotheses marked as hypotheses, and interrogates.

## Procedure

1. **Gather the revealed telos** — what this machine can actually see:
   `keel log --days 90 --json` for where the time went; the commitments file
   for what was promised; git across the checkouts the log names; ticket/PR
   MCP servers if connected (check, never assume); the existing Telos note if
   one exists. Cite everything — each derived line carries its evidence.

2. **Draft bottom-up.** Rank-sort objectives from evidence. Propose goals the
   objectives appear to serve. For the mission: if the file has one, keep it on
   screen; if not, offer two or three *labeled hypotheses* and no default.

3. **Present the gaps before the questions.** The most valuable output is the
   divergence: *"the file says X matters most; the log shows no motion on it in
   six weeks"* or *"nothing you stated explains where the last month actually
   went."* Gaps are findings, not accusations — either the file is wrong or the
   weeks were, and which one is the user's call to make.

4. **Grill, one question at a time,** intensity rising with the layer.
   Recommended answers are allowed; leading answers are not. The top layer gets
   the relentless treatment: what would you give up for this, what evidence
   would change it, does this survive being read aloud. Stop when answers
   stabilize, not when the outline is filled — an honest hole beats a fluent
   placeholder, and "mission: unresolved" is a legitimate state for the file.

5. **Rewrite the whole file** to its agreed next state — forgetting by
   omission, no appended archaeology. Date it, record the check-in, and note
   the next suggested one (a quarter is a reasonable default). The words are
   the user's, kept verbatim wherever they gave them.

## Rules

- **Never injected, never ambient.** If the user wants it in a session, they
  will say so. This rule is the reason the skill is safe to own.
- **Cite, don't assert.** Every derived line names its evidence; every stated
  line is marked as stated. The file must be refutable in one read.
- **The top layer belongs to the user.** Hypotheses are labeled, never
  defaulted, never smuggled in as summary.
- **One store, one scope.** Work telos from work evidence on the work box;
  personal from personal. A telos that blends networks leaks in both
  directions.
- **Quote the user.** After grilling, their phrasing wins over polish — a
  mission statement that doesn't sound like them will be ignored by them.

## Output shape

```
## Telos check-in — <date>   (file age: <n> weeks)

Gaps       — <stated-vs-revealed divergences found, cited>
Confirmed  — <layers that survived grilling unchanged>
Changed    — <what was rewritten, and the user's words for why>
Unresolved — <honest holes, kept visible>
```

Then write the file, and say when the next check-in is due — as a suggestion,
not a hook.
