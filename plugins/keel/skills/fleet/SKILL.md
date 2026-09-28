---
description: Put a repo on the user's fleet baseline — shared CI, risk-tiered auto-merge, bot review, and Dependabot from their own reusable-workflows repo — or answer questions about that policy. Use when asked to "start a new project", "scaffold a repo", "new project called X", "set up X like my other projects", "add CI / auto-merge / review to this repo", "what's my merge policy", or "what's the fleet baseline".
---

# Fleet

One skill, three jobs: **recall** the policy, **scaffold** a new repo, or
**adopt** an existing one. keel carries only the steps. The policy, workflows,
and template live in the user's own repos, and every value below is looked up
or read from their notes — nothing about one user is written into this file.

## Resolve the inputs first

Derive what machinery knows; read the rest from the notes store; ask only for
what's missing, then offer to record the answer so the next run doesn't ask.

| Input | Where it comes from |
|---|---|
| GitHub owner | `gh api user -q .login`, unless the user names an org |
| Workflows repo | `Fleet` section of the `House conventions` note |
| Template repo | same section |
| Checkout root | `House conventions` (e.g. where personal projects are cloned) |
| Policy text | a file in the workflows repo, named in the same section |

The workflows repo is expected to hold reusable workflows, a default-branch
ruleset JSON, and the policy file; the template repo holds the caller
workflows and a Dependabot config. If the note has no `Fleet` section, ask for
the two repo names, list their files with `gh api repos/X/git/trees/HEAD?recursive=1`
to find the ruleset and policy paths, and propose the section as an addition
to the note. Never guess a repo name.

Read files from GitHub with `gh api repos/X/contents/<path> -q .content | base64 -d`;
don't require a local clone.

## Recall

Read the policy file and answer from it — not from memory, and not from
anything summarised in a note. The policy file is the one carrier, and it moves.

## Before any write: can this repo auto-merge at all?

For both scaffold and adopt, check and say the answer before doing anything:

```sh
gh api repos/OWNER/REPO -q .private
gh api user -q .plan.name
```

A **private repo on a personal Free plan** cannot have rulesets or branch
protection (the API returns 403). Without required status checks, GitHub's
auto-merge fires the moment a PR opens, so a merge guard should refuse to arm.
Say this and offer the choices: make the repo public, upgrade the plan, or
proceed with merges staying manual. Don't retry the ruleset call.

## Scaffold a new repo

Ask for the name and visibility if not given; recommend public, for the reason
above.

1. `gh repo create OWNER/<name> --template <template repo> --<public|private> --clone`,
   then move the clone under the checkout root.
2. **Settings and ruleset**, below.
3. **The review token**, below.
4. Project edits go in a first PR, not on the default branch: the template's
   placeholder names (README, CLAUDE.md, package manifest) and the high-risk
   path list in the risk workflow. If the stack differs from the template's,
   replace the CI caller and say so.
5. Run the template's own verify step to confirm it starts green.

## Adopt an existing repo

1. Copy the caller workflows and Dependabot config from the template. Never
   overwrite an existing file silently — show the diff and ask. Adjust caller
   inputs and the Dependabot ecosystem to what the repo actually uses.
2. Ask which paths must always get a human; suggest candidates from the tree
   (schema, auth, billing, deploy config) and mark them as guesses.
3. Land them in a PR. If the risk classifier treats workflow changes as high
   risk, this PR labels itself high — that's the classifier working. A review
   bot generally can't review the PR that adds it, because GitHub requires the
   workflow to exist on the default branch first.
4. After it merges: **Settings and ruleset**, then **The review token**.

## Settings and ruleset

```sh
gh api -X PATCH repos/OWNER/REPO -F allow_auto_merge=true -F delete_branch_on_merge=true
```

Fetch the ruleset JSON. Its required status-check contexts must match what
this repo's CI reports: `<caller job id> / <job name in the reusable workflow>`.
Derive them by reading both files, never by copying the names from the JSON or
from memory. Check `gh api repos/OWNER/REPO/rulesets` for one with the same
name and `PUT` to it instead of creating a duplicate. Name each write before
making it — these change how the repo accepts code.

## The review token

If the review workflow needs a secret, never read it from disk, another repo,
or the environment. Tell the user the exact `gh secret set NAME -R OWNER/REPO`
command to run themselves.

## Report

The repo URL, each write applied, what was skipped and why, and the manual
steps left. Commit hygiene applies as everywhere in keel.
