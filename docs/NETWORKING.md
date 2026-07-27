# Several machines

Two separate problems that get conflated. Solve them separately.

| | Direction | Mechanism | Effort |
|---|---|---|---|
| **Features** — plugin, hooks, skills, policy | repo → every machine | the plugin marketplace | **already done** |
| **Memory** — what the assistant knows about you | machine ↔ machine | a memory adapter | pick one |

---

## Features: nothing to do

Every machine installs the same plugin from the same marketplace:

```sh
/plugin marketplace add JimmayVV/keel
/plugin install keel@keel
claude plugin update keel@keel      # later
```

Each machine pulls independently. No push, no merge, no shared state — which is
exactly why this half needs no thought.

---

## Memory: pick the adapter that matches the machine

keel does not implement a memory store and does not sync one. It configures
somebody else's and gets out of the way. Two shapes, and the right answer is
usually per-machine rather than per-person.

### Local only — one machine, nothing leaves it

[Basic Memory](https://github.com/basicmachines-co/basic-memory): markdown files
plus a local SQLite index, exposed over MCP. No server, no container, no account,
no network.

```sh
pip3 install --user uv
keel setup --memory-home "$HOME/.local/share/keel/notes"
claude plugin install keel-memory@keel && claude plugin enable keel-memory@keel
```

Point Obsidian at that directory and it is an ordinary vault. This is the right
answer for a work machine: everything on the box, nothing to explain to anyone,
and no dependency on a service being up.

### Shared — several machines, one brain

A self-hosted [Hindsight](https://hindsight.vectorize.io) instance that every
machine talks to. **This is not sync.** There is no repo, no merge, and no
conflict resolution, because there is only one store. Memory banks are selected
by URL path, so pointing three machines at the same path makes them one brain:

```sh
claude mcp add --transport http hindsight \
  http://<host>.<tailnet>.ts.net:8888/mcp/personal/
```

Add a machine by giving it that URL. Remove one by taking the URL away. Reach it
from outside the house over your tailnet — do not expose the port to the LAN or
the internet, because it holds everything it has learned about you.

The trade, stated plainly: when the instance is unreachable, that session has no
shared memory. Native per-project memory still works, the guards still work, the
activity log still records — the session is dumber, not broken. If that is
unacceptable, use the local adapter instead.

---

## Machine identity

One value differs per machine, and it is not optional:

```sh
keel setup --device laptop
```

The activity log scopes files by month **and** device — `2026-07-desktop.jsonl`,
`2026-07-laptop.jsonl`. Without an explicit name the fallback is `hostname()`,
which under WSL is the *Windows* machine name, so two boxes can collide. The
collision is invisible until you compare logs and find a month of work attributed
to the wrong machine.

It lives in `settings.local.json`, which is machine-local by convention — the
right home for anything that differs per box, including `KEEL_MEMORY_HOME`.

---

## Instructions

`CLAUDE.md` is small, hand-edited, and changes rarely. keel has no opinion about
how you move it between machines. If you already keep dotfiles in git or use
[chezmoi](https://www.chezmoi.io/), put it there. If not, copying it across when
it changes is a perfectly good answer for a file you touch monthly.

keel used to ship a git-repo sync mechanism for this and for memory. It was
removed: once a memory adapter provides the sharing, a second sharing mechanism
is two stores with no rule for which wins.

---

## Keep work and personal apart

A **network** here is just a set of machines pointed at the same memory backend.
Work machines are a different network from personal machines — a different
backend, or none.

Two rules make that hold:

1. **Work data never reaches personal infrastructure.** Ticket contents and
   repo-tagged activity are employer information. A work machine gets the local
   adapter, or nothing. Do not point it at a homelab instance.
2. **Personal aspirations never land on company hardware.** They simply are not
   in that network, so there is nothing to filter.

Worth knowing before you rely on one machine for both: `CLAUDE_CONFIG_DIR`
isolates config-scoped MCP servers, but **claude.ai account connectors ignore it**
— Gmail, Drive, and Calendar appear in a fresh profile whose MCP config is empty,
because they follow the login. Two config directories on one login give you
separate configuration, not separate reach. Separate accounts on separate
machines is what actually separates them.
