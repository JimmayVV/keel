# Documented surfaces — the durability contract

`keel` builds on Claude Code. Claude Code ships frequently (2.1.199 → 2.1.220
inside a single week of its own changelog). The only way a harness survives that
is to depend exclusively on surfaces Anthropic documents and treats as contract.

**The rule: if it isn't in the official docs, `keel` does not read, write, or
parse it.** No exceptions for convenience. A feature that requires an
undocumented surface is a feature `keel` does not ship.

## Allowed — documented contract

| Surface | What we use it for | Docs |
|---|---|---|
| `settings.json` schema + precedence | install, doctor, feature config | [settings](https://code.claude.com/docs/en/settings) |
| Hook events — `PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd`, `Stop`, `UserPromptSubmit`, `InstructionsLoaded` | guards, auto-update | [hooks](https://code.claude.com/docs/en/hooks) |
| `CLAUDE.md` hierarchy, `@imports`, `claudeMdExcludes` | instruction layering | [memory](https://code.claude.com/docs/en/memory) |
| `.claude/rules/` with `paths:` frontmatter | conditional instructions | [memory](https://code.claude.com/docs/en/memory) |
| Auto memory dir + `autoMemoryDirectory` | data sync target | [memory](https://code.claude.com/docs/en/memory) |
| Skills frontmatter — `description`, `disable-model-invocation`, `user-invocable`, `paths` | capability packaging | [skills](https://code.claude.com/docs/en/skills) |
| Subagents + `memory:` field | scoped specialists | [sub-agents](https://code.claude.com/docs/en/sub-agents) |
| `.mcp.json`, MCP scopes, `--strict-mcp-config` | **bolting on third-party memory backends** | [mcp](https://code.claude.com/docs/en/mcp) |
| `CLAUDE_CONFIG_DIR` | whole-profile relocation | shipped env var |
| `/context`, `/doctor`, `/memory` | verification the user runs | [commands](https://code.claude.com/docs/en/commands) |

## Forbidden — weather, not contract

| Surface | Why it's off-limits |
|---|---|
| `projects/*/*.jsonl` transcripts | Undocumented shape, actively churned. v2.1.208 *"reduced transcript size up to 79x"* — any parser built on this breaks without warning. |
| `history.jsonl` | Undocumented, unbounded, format-unstable. |
| `.credentials.json` | Undocumented, and reading credential stores is a security posture violation regardless. |
| `daemon/`, `sessions/`, internal caches | Runtime internals. Not an API. |
| Statusline cache files | Internal. Read `/context` or nothing. |

### Why this matters more than it sounds

A previous iteration of this system ingested transcript JSONL into Postgres to
power recall. It worked, and it was the single least durable component owned —
one transcript-format change away from silent breakage, with no test that would
have caught it. Recall reads markdown under the documented auto-memory directory
and arrives through the documented `UserPromptSubmit` field; durable notes go
through an MCP memory server, a documented integration point maintained by
someone whose job it is.

That trade — *give up a bespoke capability to stand on documented ground* — is
the central design decision of this project.

## Acknowledged exceptions — undocumented, depended on, said out loud

The rule says a feature needing an undocumented surface does not ship. Three
shipped anyway, as repairs for observed breakage, and a cold review
(2026-07-30) caught the code calling one of them "documented." It is not, and
pretending was worse than depending. Each is listed with its blast radius and
the condition under which keel stops touching it.

| Surface | Used for | If the surface changes | Leaves when |
|---|---|---|---|
| `installed_plugins.json` (`installPath`, `gitCommitSha`) | the PATH shim resolves the current install; `keel update` detects version-pinned no-op updates | the shim errors loudly (Claude's own plugin dispatch is unaffected); update loses the sha repair and says so | a documented surface exposes the installed path/commit |
| `~/.claude.json` — `officialMarketplaceAutoInstall*` keys (write), `mcpServers`/`projects` maps (read) | `keel migrate` repairs the one state no vanilla install can reach; `keel doctor` detects backends wired outside keel | the repair becomes a no-op; doctor's external-wiring note disappears; nothing else is affected | Claude Code repairs that state itself / documents an MCP inventory surface |
| `known_marketplaces.json` (read) | `keel migrate` lists what this machine already has, so a re-run proposes only what is missing | migrate over-proposes and the user declines duplicates — annoying, not harmful | a documented marketplace inventory appears (treated as undocumented until a docs link is found) |
| `plugins/marketplaces/keel` git checkout | `keel update` fast-forwards a checkout that `marketplace update` has been observed to leave stale | ff-only on a clean tree — the worst case is "already up to date," the state it started in | `marketplace update` reliably moves the checkout |

These are exceptions, not precedent: each exists because the breakage was
observed on a real machine, each fails toward doing nothing, and each names
its own exit.

## Enforcing it

**A test checks the names; review checks the rest.** `surfaces.test.mjs` reads
the tables in this file and scans the CLI and every hook for the file names they
contain. A forbidden name may not appear in source at all — the one exemption is
the security guard's own denylist, where naming a credential file is how it gets
protected. An undocumented name may appear only if the exceptions table below
carries a row for it, with all four columns filled. The test runs with the rest
of the suite before every push.

What the test cannot see, and does not claim to: runtime access. A path built at
run time from pieces would pass it, and `keel doctor` does not watch the
filesystem for violations. Those stay on review — a feature needing a new
surface gets a row here with a docs link, or it does not ship.

An earlier draft of this document claimed a `src/surfaces.ts` that encoded and
enforced the list. It never existed, and for a month afterwards this section
said enforcement was "open work." Stating a guarantee you do not implement is
worse than stating none, because a reader budgets trust against it — so the
paragraph above says exactly what the check covers and stops.

## keel's own data

`keel/activity/*.jsonl` under the Claude config directory is **keel's** file, not
Claude Code's — a monthly, append-only log written by the activity hook. It is
listed here for completeness rather than as an exception: the allowlist governs
what keel may touch of *Claude's* state, and this is keel's own.

Its location is deliberately relative to the config directory, so two networks on
one machine keep separate logs with no extra configuration. `KEEL_ACTIVITY_DIR`
overrides it; `KEEL_ACTIVITY_OFF=1` disables capture without uninstalling.

The hook writes bounded, single-line records and performs **no model call** —
hooks capture, skills interpret. `UserPromptSubmit` drops tool timeouts to 30s,
so anything slow or clever belongs in a skill instead.
