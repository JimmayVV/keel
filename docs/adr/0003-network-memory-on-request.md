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
reflection, anything another machine holds) runs only when the user asks: the
`reflect` skill, or a `keel` command. Recall from local files stays passive
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
only when asked for, never unprompted. The stashed hook (`git stash list`,
"hindsight-recall-hook") holds the measured gates if a local embedding model ever
makes an on-box version possible. That would be a file read by another name, and
this decision would not cover it.

Today no file under `plugins/keel/hooks/` imports an HTTP client or calls `fetch`.
Nothing tests for that yet.
