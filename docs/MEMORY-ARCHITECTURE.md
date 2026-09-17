# Memory architecture

keel's position on agentic memory, and why it is shaped this way.

---

## The bet

There is an arms race in agentic memory — Hindsight, Mem0, Honcho, and whatever
lands next quarter. Claude Code has not picked a winner and probably will not
soon; there are bigger fish. That is not a gap to wait out. It is a gap to
**own the interface across**.

So keel does not build a memory engine and does not marry one:

> **keel owns the interface and the substrate. Engines are swappable.**

The substrate is markdown in a git repo you control. The interface is Claude
Code's own documented hooks. An engine is a thing that turns transcripts into
facts — replaceable, and never load-bearing for remembering.

This is the same trade the rest of keel makes: give up a bespoke capability to
stand on documented ground.

---

## What belongs in memory at all

Classify a fact by who can falsify it (the vocabulary is in [CONTEXT.md]):

- A fact **a grep can falsify** is *derivable* — never store it. Its carrier is
  looking: the project registry names the repo, the live code answers. A stored
  copy is a cache with no invalidation.
- A fact **only you can falsify** is *decided* — a preference, convention, or
  choice with its why. That is what the notes store holds: pointers and reasons,
  never copies of what grep can find.
- A fact **a test suite can falsify** is *logic* — its carrier is a package, and
  memory describing code is strictly dominated by code both projects import.

Memory holds decided facts, machine facts, and observations. Everything else has
a better carrier.

[CONTEXT.md]: ../CONTEXT.md

---

## Two operations, not one

A memory system is two things ([Herrington's framing][tanstack], and it is the
right one):

| | When | What |
|---|---|---|
| **Recall** | before the turn | pull facts relevant to this prompt into context |
| **Retain** | after the turn | extract durable facts from what happened, store them |

Everything below follows from one rule about these two:

> **Recall is local file reads. Retain is remote LLM work. Never invert it.**

Recall sits in the path of every prompt you type. It must be fast, offline-safe,
and incapable of failing in a way you notice. Retain is derivation about the
past — it can be slow, batched, asynchronous, and running on a machine that is
currently switched off.

Invert this and you get a system that stops remembering when your homelab
reboots. That is not a memory system, it is a dependency.

### Where the deployed system stands against that rule (2026-07-28)

Honestly: half-inverted, on purpose, and it is worth stating rather than
quietly leaving the rule above to rot.

The Hindsight instance on the homelab serves recall over a private overlay
network. That
is a network call in the path of a prompt, which is exactly what the rule says
not to do. It was accepted deliberately on 2026-07-27: when the homelab is
unreachable, a session is **dumber, not broken**, and the features that existed
only to paper over that seam — a local markdown floor, hybrid recall,
export-to-markdown as a requirement, two-speed retain — were deleted rather
than maintained.

What keeps this from being the failure the rule warns about is the layer under
it. Ambient recall still works with the homelab switched off: Claude Code loads
the per-project memory directory natively, `MEMORY.md` is still a flat index of
local files, and nothing in that path touches the network. So the floor the
rule is protecting is still there — it is Claude Code's own, not keel's, which
is why keel could stop shipping one.

Hindsight sits **above** that floor, and measurement on 2026-07-28 says that is
the right place for it. Extraction over raw transcripts produced narration and
decisions the conversation had already reversed; extraction over a curated
end-state summary was close to a passthrough. The engine is not what does the
remembering. It provides retrieval — embeddings, reranking, entity graph,
temporal queries — over facts that were already written down locally.

So the rule stands as written for the substrate, and the deployed system adds a
networked index on top of it. If that index is ever allowed to become the only
copy of a fact, the rule has been broken for real and this section is the thing
that should stop it.

---

## Recall

### It must be unprompted

The failure mode to design against is a memory that waits to be asked. A
[public test of Honcho][honcho] captured it exactly: the agent had solved a
problem the week before, and only retrieved that fact after the user got
frustrated and said *don't you remember?* The cue triggered the memory. The
memory should have preceded the cue.

Their diagnosis was that the fact was remembered but never became an
**actionable file** — something the agent naturally reads rather than something
it must decide to query. A vector store the model may call is cue-dependent by
construction. A file already in context is not.

So keel recalls on two levels, both unprompted:

**Ambient recall — free, already working.** Claude Code natively loads the
per-project memory directory. `MEMORY.md` is a flat index, one bullet per fact,
each pointing at a detail file. That index is *progressive disclosure*: the
bullet is always in context, the detail file is read only when relevant. This
requires no hook and no engine. It is why the discipline matters — one fact per
file, one line in the index. A memory system that writes essays into the index
defeats itself.

**Query recall — the `UserPromptSubmit` hook.** For facts the index does not
surface, keel injects them alongside the prompt using the documented field:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "Relevant to this prompt: <facts, with citations>"
  }
}
```

Because this runs on every prompt, it reads **local markdown only**. No network,
no MCP round trip, no engine. A prompt must never wait on a memory service.

### It must degrade to nothing

If query recall fails, errors, or times out, the hook returns no context and the
turn proceeds. Ambient recall still works, because it is just files on disk that
git already synced. The floor of this system is "Claude reads your notes," and
that floor has no moving parts.

---

## Retain

### This is where the engines live, and where the danger is

Retain runs an LLM over a transcript and decides what is true about you. That is
the step that can conclude you *super duper want X* because you fumbled a
sentence on a Tuesday. Three rules:

**1. Observation and conclusion are different registers.**

- *Observation* — "on 2026-07-27 you chose the boring option over the clever one"
  — is a fact about the past. keel's activity log already holds these:
  append-only, timestamped, device-tagged.
- *Conclusion* — "you prefer boring solutions" — is derived, contestable, and
  must be marked as such.

Conflating them is what makes a belief unchallengeable.

**2. Cite, don't assert.** Retain output must carry its evidence:

> Across 6 sessions between Jul 12–26 you chose the simpler option four times
> — [links to log entries]

not

> Jimmy prefers simple solutions.

The first can be refuted in one read. The second is a fumbled sentence laundered
into an identity.

**3. Confidence decays.** A preference mentioned once does not outrank one
reinforced across ten sessions. Recurrence thresholds and a half-life are the
mechanism; without them, every offhand remark is permanent.

**4. Forget by omission.** A curator rewrites the whole file to its desired next
state; a stale fact is dropped by not being included. Full-state replacement,
not append — appending never forgets, and a memory that never forgets is
clutter with provenance. (The `deck` skill already works this way.)

**5. A worker has tiers, not a pen.** Before any retain worker runs unattended,
its write permissions are classified per target: *append-only* for its own
derived-facts files, *propose-only* for anything the user wrote by hand
(`MEMORY.md`, notes, conventions — it drafts, the user applies), and
*untouchable* for config, hooks, and code. An autonomous writer with uniform
write access is how a fumbled extraction becomes a rewritten identity.

### The one part of retain keel owns: the address

keel extracts nothing and sends nothing. But a retained document is addressed by
an id, and the id decides whether re-sending a file **updates** that document or
adds a second copy beside it. Recall then has two answers to one question and no
rule for picking, so it can return the older one.

That convention started as a sentence in a `CLAUDE.md` — instruction text, which
a model follows approximately. Seven weeks of that, measured on 2026-09-17: 80
documents under six id shapes, three notes under two ids each with the losing
copy months stale, 24 ids a re-retain would have duplicated rather than updated,
and four typed by hand that no retain could ever address again.

So the id is computed:

```
keel retain-id <path>
```

Two forms, both independent of `$HOME` and of the username, because the whole
property being bought is that two machines pointed at one bank derive one id for
one note:

| File | Id |
|---|---|
| `<config dir>/projects/<slug>/memory/x.md` | `projects/<slug>/memory/x.md` |
| anything else under `$HOME` | its path relative to `$HOME` |

A path outside `$HOME` is refused rather than guessed — keyed on an absolute
path, an id means a different thing on the next box, which is the failure being
ended.

`keel retain-id --audit` compares the bank against disk, and `keel doctor`
reports the same in summary: notes stored under two ids (a problem — it is the
one that returns a wrong answer rather than merely wasting a document), ids that
are not what keel would derive, documents whose file is gone, files changed
since they were last retained, and files never retained. Never-retained is not a
problem: a bank created after the notes is the normal case, and backfilling is
the user's call. `KEEL_RETAIN_CHECK_OFF=1` turns the check off.

Neither command writes anything, to the bank or to disk. The convention that
tells a session to use them ships as a skill with `keel-reflect`, so a machine
gets it by installing the plugin rather than by inheriting someone's `CLAUDE.md`.

Freshness is judged by modification time. The retained text is a session's
summary of a file rather than the file's bytes, so the document's
`content_hash` cannot be recomputed from disk — "changed since retained" is a
hint worth checking, not proof of drift, and is reported that way.

### It runs where a log lives

Retain does not need to be reachable. It needs to reach a log — and the activity
log is machine-scoped by declaration ([ADR-0002]): its only reader lives on the
machine that writes it. The work box asks "what did I do this week" of its own
log; personal boxes share knowledge through the notes store, not through each
other's activity records.

So a retain worker is a cron job on the machine whose log it reads, writing its
conclusions into the notes store through the adapter — the same carrier every
other decided fact uses. An earlier design routed this through a synced data
repo; that layer was removed (`1d19d66`, [ADR-0002]) and the transport went with
it.

The consequences of a worker being absent are unchanged:

| Failure | Effect on Claude Code |
|---|---|
| worker offline | none — log accrues, worker catches up |
| worker destroyed | none on past facts; they live in the notes store |
| you are travelling | none — you were never talking to it |

Every fact it ever derived survives it. You lose future derivation, not memory.

[ADR-0002]: adr/0002-one-carrier-per-datum.md

---

## The driver interface

An engine implements two calls. Nothing else about it is keel's business.

```
recall(scope, prompt) -> Fact[]      // must be local + synchronous-safe
retain(scope, transcript) -> Fact[]  // may be remote + async
```

A `Fact` is a markdown file with front matter: the claim, its provenance
(observed vs derived), the evidence it came from, when, and by which device.
Files, because files are what a coding agent already reads, what git already
merges, what you can already grep, and what you can delete with an editor.

`scope` is who and what session — the same idea every engine already has.

Engines ship as bridge plugins declaring an MCP server, the way `keel-memory`
wires Basic Memory today. `.mcp.json` is a documented integration point, which
is the whole reason keel is allowed to use it.

**Recall must be implementable without the engine.** Any engine that can only
recall through its own service fails the offline floor and can be used for
retain only.

---

## Why this survives more than one machine

The point is not sync for its own sake. It is that a new machine should not need
re-training.

- Decided facts live in the notes store → the adapter carries them to every
  machine on the network.
- Machine facts live in auto-memory → correctly stay behind.
- Machine identity lives in `settings.local.json` → never conflicts.
- Paths are convention, not configuration → `~/personal/<name>` on every
  personal box, so a note that points at a project is true everywhere —
  including on a machine that hasn't cloned it yet, where the registry entry
  carries enough (name, remote, purpose) to offer the clone.

Onboarding a new box is `install.sh`, `keel setup`, and pointing the adapter at
the backend. There is no re-training step because there is no per-machine model
state.

---

## What exists today, and what does not

**Working:**

- Substrate — auto-memory for machine facts, the notes store for decided facts
- Ambient recall — native, no keel code involved
- Query recall — `memory-recall.mjs` on `UserPromptSubmit`, scoring the fact
  files under `<config dir>/projects/*/memory/` (index and >64 KB files
  excluded, within a 1.2 s budget) against the prompt with IDF-weighted term
  overlap, and injecting them inside a fence marked as data.
  Copies of one fact across projects share a slot and name each other.
  `keel recall "<prompt>"` shows what a prompt would receive; `keel doctor`
  runs the hook and reports duplicated names; `KEEL_RECALL_OFF=1` disables it.
- Observation layer — `keel/activity/*.jsonl`, append-only, device-scoped,
  machine-local by declaration ([ADR-0002])
- Two engine bridges — `keel-memory` (Basic Memory, local) and `keel-reflect`
  (Hindsight over http; URL and bank from `settings.json`, bank created by
  `keel setup`, health and bank checked by `keel doctor`)
- Retain addressing — `keel retain-id` derives a document id from a path, so the
  id is computed rather than remembered; `keel retain-id --audit` and `keel
  doctor` compare the bank against disk. Addressing and auditing only: keel
  neither extracts facts nor sends them.

**Not built:**

- **Retain. There is no fact-extraction step at all.** This is the real gap —
  keel addresses and audits retained documents, but nothing in keel decides what
  is worth retaining or sends it.
- Vocabulary-gap recall — `daily` and `day` do not match; closing that needs
  embeddings, which need a service in the keystroke path, which the rule above
  forbids
- The driver interface above — currently one hard-coded adapter shape

The honest summary: keel does recall's substrate well and does not retain at
all. Everything you remember today, you wrote down yourself — keel now makes
sure it went in under an address it can be found and replaced at.

---

## Surfaces this depends on

All documented, per [DOCUMENTED-SURFACES.md](DOCUMENTED-SURFACES.md):

| Surface | Used for |
|---|---|
| `UserPromptSubmit` + `hookSpecificOutput.additionalContext` | query recall |
| Auto memory directory | fact substrate |
| `.mcp.json` | engine bridges |
| `settings.json` / `settings.local.json` | config, machine-local values |

Nothing here reads a transcript file. Transcript JSONL is explicitly forbidden —
undocumented and actively churned — which is precisely why retain consumes
keel's own activity log instead.

[tanstack]: https://www.youtube.com/watch?v=whyz0m302ZI
[honcho]: https://www.youtube.com/watch?v=3GybJGsnYak
