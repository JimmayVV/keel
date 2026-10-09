---
status: accepted
---

# Hooks stay off the network; networked memory runs on request

On 2026-10-09 a `UserPromptSubmit` hook was built that sent each prompt with three or
more topic words to a self-hosted Hindsight instance and injected what its recall
returned. It was well gated: a 2-second deadline, silence on any failure, a relevance
floor, an off switch, and no request at all on a machine without `KEEL_HINDSIGHT_URL`.
The same afternoon the instance slowed down: recall went from about 1 s to over 60 s,
and then its health check timed out. With the hook installed, every topical prompt in
every session would have waited the full 2 s and received nothing. The gates bounded
the damage. They did not remove it, because a passive call is paid on every turn,
whether or not the answer was wanted.

Decision: **a hook makes no network call.** Memory that needs a server (search,
reflection, anything another machine holds) runs only when a session chooses to:
the `reflect` skill, whose description scopes it to questions about the user's own
memory, or a `keel` command. The first half is code, checked by a test (below);
the second is a skill description a model follows. Recall from local files stays passive
(`memory-recall.mjs`), because a file read on the same machine has no failure mode
that costs a turn.

This restates a decision first recorded around 2026-09-20, when a recall hook built on
a hosted classifier was rejected for sending every prompt off-box. That record
survives only as a fact in a Hindsight bank: the note it came from was deleted. Its
reason was stated as security (prompts carry secrets, and a third party would see
them). This record adds the reason the 2026-10-09 build demonstrated: latency and
fragility on every turn, even when the server is your own. Either reason alone
decides it.

Cost: semantic recall (a question asked in words the note does not use) happens
only when a session runs the `reflect` skill or `keel search`, never from a hook. The branch `archive/hindsight-recall-hook`
(never to be merged) holds the dropped hook and its measured gates, in case a local
embedding model ever makes an on-box version possible. That would be a file read by another name, and
this decision would not cover it.

`hooks-offline.test.mjs` checks the hook source: every `hooks.json` command runs
node on a file in `hooks/`, and no hook names an HTTP client or spawns curl or wget.
It reads source text, so a call assembled at runtime would get past it.
