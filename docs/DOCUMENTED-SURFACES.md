# Documented surfaces — the durability contract

`rig` builds on Claude Code. Claude Code ships frequently (2.1.199 → 2.1.220
inside a single week of its own changelog). The only way a harness survives that
is to depend exclusively on surfaces Anthropic documents and treats as contract.

**The rule: if it isn't in the official docs, `rig` does not read, write, or
parse it.** No exceptions for convenience. A feature that requires an
undocumented surface is a feature `rig` does not ship.

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
have caught it. Recall now comes from an MCP memory server, which is a
documented integration point maintained by someone whose job it is.

That trade — *give up a bespoke capability to stand on documented ground* — is
the central design decision of this project.

## Enforcing it

`src/surfaces.ts` encodes the allowlist. Any path `rig` touches under the
Claude config directory is checked against it, and `rig doctor` reports a
violation as a failure, not a warning. If a future feature needs a new surface,
it gets added here with a docs link, or it does not ship.

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
