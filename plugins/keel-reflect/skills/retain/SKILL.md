---
description: Retain a memory file, journal entry, or note into the Hindsight bank under the id that makes re-sending an update rather than a duplicate. Use whenever about to call Hindsight's retain or sync_retain, after writing or updating a file under a project's memory/ directory, when asked to "save this to hindsight", "retain this", or "push memory to the bank", and when reconciling what the bank holds against what is on disk.
---

# Retain — one document per file, forever

Hindsight addresses a document by its id. Re-sending a file under the **same**
id updates that document; under a different one it adds a second copy, and
nothing reconciles the two. Recall then has two answers to one question and no
rule for choosing, so it can return the older.

That is not hypothetical. It is what happened here over seven weeks: 80
documents under six id shapes, notes stored twice with the losing copy months
stale, and ids typed by hand that no retain can ever update.

## The rule

**Never type a document id. Ask for it:**

```
keel retain-id <path-to-file>
```

Its output is the `document_id`. It is derived from the path, is identical on
every machine pointed at the bank, and contains no `/home/<user>` prefix — which
is the whole point: the desktop and the laptop must derive the same id for the
same note, or they are writing two documents.

One path, one document, for the life of the file.

## Retaining

1. `keel retain-id <path>` for the id.
2. Send the file's **content** as the text. Curated prose extracts well;
   transcripts extract badly and cost more.
3. Set `context` to what the file is (`"keel project memory"`, `"Jimmy's
   personal journal entry, <date>. Personal, private."`), and tag it — memory
   files carry `memory`, journal entries carry `journal` and `private`.
4. Retain after the file is written, not before. The file is the source of
   truth; the bank is a copy that recall can reach from another machine.

## When a file moves or is deleted

The id follows the path, so moving a note between project directories strands
the old document. Retain under the new id, then delete the old document — two
steps, because only the second one removes the stale answer.

## Checking

```
keel retain-id --audit
```

Compares the bank against disk: notes stored twice (with the copy to keep and
the one to drop), ids that are not what keel would derive, documents whose file
is gone, files changed since they were last retained, and files never retained.
`keel doctor` reports the same thing in summary and counts a duplicate as a
problem. Neither writes anything — repairs are yours to make, with consent.

Freshness is judged by modification time, because the retained text is a
summary of a file rather than its bytes and cannot be hashed back to it. Treat
"changed since retained" as a hint worth checking, not proof of drift.
