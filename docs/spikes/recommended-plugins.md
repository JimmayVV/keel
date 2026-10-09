# Spike: recommended plugins

**Question:** can keel recommend plugins the way VS Code recommends extensions, and
how should a recommendation relate to keel itself?

**Status:** spike, 2026-10-09. Not a decision. Annotate freely; what survives becomes
ADR-0004 or gets dropped.

---

## 1. Recommend, don't wrap

Two relationships are possible between keel and another tool.

| | Wrap | Recommend |
|---|---|---|
| What keel ships | a bridge plugin that installs or configures the tool | a line that says what the tool is, why, and how to install it |
| Provenance | the tool arrives under keel's name | the tool arrives from its author's own marketplace (`plannotator@plannotator`) |
| Uninstalling keel | takes the tool with it | leaves the tool alone |
| keel's claims | now cover the other tool's behaviour too | cover only the recommendation |

**Proposed rule:** keel wraps a tool only when keel has to *configure* it, as with
`keel-memory` and `keel-reflect`: something has to write the `.mcp.json` and know the
URL. Everything else is a recommendation.

That answers "is this a plugin I value, or is it here because keel thinks it helps?"
structurally. `claude plugin list` shows the author's marketplace, not keel's.

## 2. What Claude Code gives us

Everything below has to be a documented surface (`docs/DOCUMENTED-SURFACES.md`).

| Surface | Usable by keel? | Note |
|---|---|---|
| `claude plugin marketplace add <owner/repo>` and `claude plugin install <name>@<marketplace>` | yes | runs without prompting; this is the install line a recommendation prints |
| `extraKnownMarketplaces` / `enabledPlugins` in `settings.json` | yes | settings already appear in DOCUMENTED-SURFACES |
| Native plugin suggestions and CLI hints | **no** | limited to the official marketplace or a managed-settings allowlist |
| `dependencies` in a plugin manifest | **no** (and unwanted) | cross-marketplace dependencies are blocked by default, and declaring one is wrapping by another name |
| `claude plugin list --json` | maybe | needed for stage 2; confirm it's documented and add a row before use |
| skills.sh installs (`~/.agents/skills`, symlinked into `~/.claude/skills`) | files only | these aren't plugins, so `claude plugin list` can't see them |

## 3. Three stages, each admitted only by a felt need (ADR-0001)

1. **Prose.** A "Plugins keel recommends" section in the README. Each entry gets four
   lines: why, what it costs (binaries, hooks, network, context), how to remove it,
   and the install command. Nothing runs. *Felt need: already here.* This is how you
   rebuild your MVP setup from scratch.
2. **`keel status` marks them.** "recommended: plannotator ✓, mattpocock/skills ✗".
   *Felt need: the first time you can't remember what a machine has.* This stage needs
   the list to be machine-readable. Under one carrier per datum (ADR-0002), that means
   a JSON file the CLI reads and `docs.test.mjs` checks the README against, not two
   hand-kept copies.
3. **Fresh-machine offer.** `keel setup` offers each entry y/n. *Felt need: the next
   time you set up a new box.* `keel migrate` covers only same-machine resets today.

## 4. Two lists, not one

- **keel's public list** is opinionated for anyone who installs keel. The claims rule
  applies, it gets reviewed in PRs, and it stays short.
- **Your personal list** is "my ideal setup", which is a *decided fact*. Its carrier is
  the notes store (the `House conventions` note, or a sibling), not keel's repo. Stage 3
  would read it there.

A tool can sit on your list for months before it earns the public one.

## 5. The bar for the public list

Proposed. Every line is up for annotation.

- Used on real work for **at least two weeks**, on more than one project.
- A cost line you can state in one sentence, including what it runs and what it opens to the network.
- A removal path that leaves nothing behind, or names what it leaves.
- Installed from the author's own source.
- An honest bus-factor note when one person maintains it.

## 6. Candidates

### Matt Pocock's skills — `mattpocock/skills`

- **Install (your preference, editable raw files):** `npx skills@latest add mattpocock/skills`, and include `setup-matt-pocock-skills`.
- **Update:** `npx skills@latest update`. Re-run `add` to pick up newly added skills.
- **Alternative:** `mattpocock-skills@claude-plugins-official`, which updates itself. Pick one: installing both gives every skill twice.
- **Cost:** each model-invocable skill puts its description into every session's context.
- **Open:** should `keel update` also run `npx skills@latest update`? The upside is one command; the cost is that keel then shells out to npm.

### Plannotator — `backnotprop/plannotator` (on trial since 2026-10-09)

- **What you'd actually use:** the binary plus three user-invoked skills: `/plannotator-annotate`, `/plannotator-review` and `/plannotator-last`. Its plan-mode hooks never fire for you, because you don't use plan mode.
- **Installed here:** binary 0.28.8 at `~/.local/bin/plannotator`; skills in `~/.claude/skills` and `~/.agents/skills`; data and config in `~/.plannotator`. The Claude Code plugin is **not** installed.
- **Network:** each review starts a short-lived local server.
  - Under SSH, plannotator detects a remote session and binds `0.0.0.0`, so the home LAN can reach it too.
  - With `--tailscale`, it stays on loopback and publishes through `tailscale serve` over HTTPS. Only the tailnet can reach it, and it removes its mapping when the review ends.
  - Sharing is user-initiated; `PLANNOTATOR_SHARE=disabled` turns it off.
- **Plan-mode warning (only if the plugin is ever installed):** its Claude Code mod makes plan approval non-blocking, and it's on by default. Turn it off with `PLANNOTATOR_CLAUDE_MOD=0` or `"claudeCodeMod": false`. In keel's entry, say: "this doesn't rely on Claude Code's plan mode".
- **Updates:** off by default (`autoUpdate: false`). The skills.sh lock file doesn't list plannotator's skills, so `npx skills update` won't touch them. Re-running its installer is how you update.
- **Removal:** `plannotator uninstall`.
- **Bus factor:** one dominant maintainer, about 1,150 commits.
- **Trial question for you:** after two weeks, did you reach for it unprompted?

## 7. Decisions this spike needs from you

Answered 2026-10-09 by annotation: 1 yes (ADR-0004 written); 2 owner's call either way;
3 notes store, note not yet chosen; 4 yes; 5 owner could go either way.

1. Recommend-don't-wrap as ADR-0004: yes or no?
2. Should the public list ship in keel's README now (stage 1), or only after an entry clears the bar?
3. Should the personal list live in the notes store, and under which note?
4. Is the bar in §5 right?
5. Should `keel update` run `npx skills update`?
