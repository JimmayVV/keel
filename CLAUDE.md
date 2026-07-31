# keel — working rules for this repo

Vocabulary lives in `CONTEXT.md`; decisions in `docs/adr/`. Use their terms.

## The claims rule (this repo's most-repeated failure)

Every sentence about what keel does — README, site, skill descriptions, code
comments — must be falsifiable against a file in this repo. Before writing
**every / anything / all / only / never / no trace / automatically**, check:
is the guarantee *structural* (enforced by code you can cite), or is it
instruction text a model might follow? Structural earns the word. Anything
else gets scoped: name the mechanism's actual reach ("shell commands", "the
three stamped sources", "a seatbelt, not a sandbox").

Plain language may **simplify** a claim, never **widen** it. The plain pages
(`site/src/pages/` except `technical.astro`) trade jargon for warmth — the
scope must survive the translation. A cold audit graded exactly this failure
at 4/10 once; `docs.test.mjs` now pins the phrases it caught.

Registers: plain everywhere, jargon consolidated on `/technical` (anchored
sections the plain pages link into), full depth in `docs/`. Don't leak
jargon upward or absolutes downward.

## Change discipline

- Admission is ADR-0001: prose free; a test must have caught a real failure
  here; runtime needs a felt need, once, on a real machine. "Another project
  does it" is not a felt need.
- One carrier per datum (ADR-0002). Derivable facts are looked up, never
  stored — no counts, version strings, or feature lists duplicated into prose
  that `docs.test.mjs` doesn't check.
- Every teardown ships the check that would notice its corpses. Every guard
  ships its off switch. Every write ships its backup and its undo.
- Undocumented Claude Code surfaces: don't. The three exceptions live in
  `docs/DOCUMENTED-SURFACES.md` with blast radius and exit conditions; a new
  one needs a row there or it doesn't ship.

## Verifying

- `node --test plugins/keel/test/*.test.mjs` — must be green before any push.
- `claude plugin validate .` and `./plugins/keel` after manifest/skill edits.
- Site visuals: never trust bare `chrome --headless --screenshot` (it lays
  out at desktop width). Use `playwright-core` with the cached chromium and a
  real viewport; assert `scrollWidth === innerWidth` for overflow claims.
- Site deploys from `site/` via Actions on push; `npm run build` in `site/`
  locally first.

## Voice

Commit messages and docs carry reasons, not just changes — the style is
"what broke, why this shape, what it costs." Trailer rules apply (the
commit-trailer guard enforces them). Say less than the code holds, never
more.
