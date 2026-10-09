---
status: accepted
---

# Recommend another author's plugins and skills; don't wrap them

keel is how its owner rebuilds a working setup on a fresh machine, and part of that
setup is other people's tools: Matt Pocock's skills, and plannotator if its trial
holds up. Claude Code can't suggest them for keel. Native plugin suggestions only
come from the official marketplace or a managed-settings allowlist, and
cross-marketplace `dependencies` are blocked by default. So keel either repackages
these tools or points at them.

Decision: **keel recommends another author's plugins and skills; it does not wrap
them.** Wrapping means shipping the tool under keel's name in any of these ways:
- vendoring its files;
- listing it in keel's marketplace;
- declaring it as a dependency;
- running its installer or updater on the owner's behalf.

A recommendation is an entry that names:
- the tool, and why it's recommended;
- what it costs: binaries, hooks, network, context;
- the install command, from the author's own source;
- its update and removal commands.

The owner runs those commands. `claude plugin list` then shows the author's
marketplace, so "a tool I value" and "a tool keel suggested" stay distinguishable,
and uninstalling keel leaves the tools alone.

The adapters (`keel-memory`, `keel-reflect`) are not wrapping. They configure an
engine keel has to wire in (an `.mcp.json` entry, a URL) and ship no one else's
plugin or skill.

There are two lists. keel's public list is opinionated for anyone who installs keel;
the claims rule applies to it, and an entry earns its place by meeting all of these:
- two weeks of use on real work, across more than one project;
- a one-sentence cost line;
- a clean removal path;
- installation from the author's source;
- an honest note when one person maintains it.

The owner's personal list is a decided fact, so it lives in the notes store and
carries no bar. A tool can sit there for months before it reaches the public one.

Cost: updating is one command per tool, which the owner runs, not one `keel update`.
`keel status` may later report which recommended tools are installed and print each
one's update and removal lines, because reporting a command is not running it.

The spike that led here is `docs/spikes/recommended-plugins.md`. Today
`.claude-plugin/marketplace.json` lists only plugins built in this repo, and no
`plugin.json` declares `dependencies`. Nothing tests for either yet.
