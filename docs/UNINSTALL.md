# Uninstalling keel

Two commands remove the software:

```sh
claude plugin uninstall keel@keel        # and keel-memory@keel if you enabled it
claude plugin marketplace remove keel
```

That removes every hook, skill, and the CLI. **It deliberately does not remove
your data or your config edits** — your work diary is not keel's to delete, and
a silent purge on uninstall would be the real betrayal. Here is everything that
stays, and how to remove each piece if you want it gone:

| What stays | Where | Remove with |
|---|---|---|
| Activity log (your work diary) | `<config dir>/keel/activity/*.jsonl` | `rm -r <config dir>/keel` |
| Security audit log | same directory (`security-*.jsonl`) | same command |
| Settings backups keel took before writing | `settings.json.keel-backup`, `settings.local.json.keel-backup`, `~/.claude.json.keel-backup` | `rm` each |
| `KEEL_*` keys keel setup wrote | `settings.json` / `settings.local.json` under `env` | edit the file, delete the keys |
| Permission rules `keel settings --yes` appended (with your consent) | `permissions.deny` / `permissions.ask` in `settings.json` | edit the file, delete the entries |
| The PATH shim, if you opted in | `~/.local/bin/keel` | `rm ~/.local/bin/keel` |
| Your notes store, if you wired one | `KEEL_MEMORY_HOME` (default `~/.local/share/keel/notes`) | yours — move it or delete it |
| Your policy overlay, if you wrote one | `~/.config/keel/policy.json` | `rm` it |
| Installer state: backups and displaced configs | `~/.local/state/keel/` | `rm -r ~/.local/state/keel` |
| Pre-XDG installer runs (older keel versions) | `~/claude-backup-*`, `~/keel-carryover` | `rm -r` each, after checking contents |
| Flag-repair backup, if `keel migrate` ran the repair | `~/.claude.json.keel-backup` (or under `CLAUDE_CONFIG_DIR`) | `rm` it |

`<config dir>` is `~/.claude` unless you set `CLAUDE_CONFIG_DIR`.

Notes:

- The env kill switches (`KEEL_GUARD_OFF`, `KEEL_ACTIVITY_OFF`,
  `KEEL_TRAILERS_OFF`, `KEEL_INGEST_OFF`) need no cleanup — with the plugin gone there is nothing
  for them to switch off.
- `keel migrate` once *deleted* stale keys from `~/.claude.json` (a repair, with
  a backup); there is nothing of keel's inside that file to remove.
- The Basic Memory engine itself (installed via `uv`) is a separate tool with
  its own uninstall; keel only ever pointed at it.

The test of a clean exit is the same as the test of a clean install: after the
two commands above, a fresh session behaves exactly as if keel had never been
there — and your records are still on disk, because they were always yours.
