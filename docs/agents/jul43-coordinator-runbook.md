# JUL-43 coordinator runbook

Status as of 2026-09-16: **code, tests, and this document are complete; no live run has
happened yet.** This route was corrected once already this session: an earlier version of this
runbook drove JUL-43 through Orca CLI dispatch plus a bespoke `run-jul43-coordinator.mjs`, with a
proposal to add a new privileged Orca terminal on the runner to hold credentials. Both were held
and superseded — see "What changed and why" below. Everything below uses the **coordinator that
already existed**, not a new one.

## What changed and why

`toddwyder/AI-Stack` already has a working, tested coordinator for `toddwyder/Julia`:
`.github/workflows/julia-supervised-worker-manual.yml`, a `workflow_dispatch` job that runs on
**BERTHA**, a self-hosted GitHub Actions runner (confirmed to be this machine — `hostname` returns
`BERTHA`). Its trusted-publishing boundary is GitHub Actions' own repository secrets: a
`julia-graph-publisher` GitHub App installation token is minted fresh inside specific job steps
(`actions/create-github-app-token@v2`) and is never exposed to the worker step, which runs with no
GitHub credential at all. This is a real, already-proven boundary — not something this session
built.

`julia-next-supervised-worker-manual.yml` (new, in `toddwyder/AI-Stack`) is the same mechanism
adapted for `julia-next`: a Linear ticket identifier instead of a GitHub issue number, no
packet/review-comment protocol (the Linear ticket's own description is the approved work
definition), no Firestore preflight (not applicable), a new `julia-next`-scoped read-only deploy
key, and the publisher token minted for `repositories: julia-next` — reusing the **same**
`JULIA_PUBLISHER_APP_ID`/`JULIA_PUBLISHER_APP_PRIVATE_KEY` secrets already configured on
`toddwyder/AI-Stack` (confirmed present via `gh secret list`; the App is already authorized for
`julia-next`). `prepare-julia-supervised-run.mjs` and `publish-julia-supervised-run.mjs` are used
**unchanged** — both already branch on the project config's `tracker` field, so pointing them at
`graph/julia-next.project.mjs` (`tracker: 'linear'`) was the only change needed. No new coordinator,
no new publisher, no new terminal pathway.

**What this means "server-side" actually refers to here**: not a different physical machine (BERTHA
is Todd's own machine) — the boundary that matters is that the publish step never uses Todd's
personal `gh auth` session. It uses a GitHub App installation token, scoped only to `julia-next`,
minted fresh and held only inside GitHub Actions' own encrypted secrets and the job's ephemeral
environment. That's what makes this not a personal-account merge bypass.

**Known gap, disclosed not hidden**: the journey-relay (`http://127.0.0.1:8943/events`, JUL-43's
criterion-4 Axiom event path) is bound to loopback on the separate Linux OVH runner used earlier in
JUL-43 for the Orca-dispatched proof of criteria 2/3. BERTHA cannot reach that loopback address —
they are different machines. This workflow does **not** emit `julia.journey0.coordinator_*` events
(`scripts/coordinator-events.mjs` exists, is tested, and remains available, but nothing in this
workflow calls it, since it has no way to reach the relay from BERTHA). Criterion 4 (journey-
accounting events, real Axiom delivery) was proven earlier in JUL-43 via the separate Orca/Linux
run — this workflow proves criteria 1, 2, 3, and 5 in one place. Whether JUL-43 counts as fully
closed on a single run through this coordinator, or on criterion 4's evidence plus this run's
evidence taken together, is Todd's call to make when reviewing the final evidence package, not
something to resolve by assumption here.

## The existing coordinator's actual startup command

```sh
gh workflow run julia-next-supervised-worker-manual.yml \
  -R toddwyder/AI-Stack \
  -f expected_issue=JUL-43 \
  -f julia_next_ref=main
```

(Or the GitHub UI: Actions → "Julia-next Supervised Worker (Manual)" → Run workflow.) This is a
`workflow_dispatch`-only trigger (`docs/agents/jul43-coordinator-runbook.md`'s workflow test
confirms no `schedule:`, no `repository_dispatch`/`workflow_run`/`pull_request_target` — nothing
runs unattended). `concurrency: { group: julia-next-supervised-worker, cancel-in-progress: false }`
means only one run at a time; a second dispatch queues rather than racing the first.

## The trusted publishing boundary, and where credentials go

GitHub Actions repository secrets on `toddwyder/AI-Stack` — the exact same boundary the existing
`toddwyder/Julia` coordinator already uses, not a new mechanism:

| Secret | Status |
|---|---|
| `JULIA_PUBLISHER_APP_ID` | **Already present** (since 2026-09-15, per `gh secret list`). Reused unchanged. |
| `JULIA_PUBLISHER_APP_PRIVATE_KEY` | **Already present.** Reused unchanged — the App's private key never needs placing again; it's already where this boundary expects it. |
| `JULIA_NEXT_DEPLOY_KEY` | **Not present.** A new SSH keypair scoped to `julia-next` only, distinct from the existing `JULIA_DEPLOY_KEY` (which is scoped to `toddwyder/Julia`). Generating this needs no credential I don't already have: I create the keypair, register the public half as a read-only deploy key on `julia-next` via `gh`, and set the private half as this secret via `gh secret set` — piped directly from the freshly generated file, never displayed. No browser session needed for this one. |
| `LINEAR_API_KEY` | **Not present.** Needs Todd's authenticated Linear session to create — see below. |

`JULIA_PUBLISHER_APP_ID`/`PRIVATE_KEY` already being in place is why the credential plan shrank
from this session's earlier proposal: there is no new GitHub App key to generate or place at all.

**Linear key — corrected from an earlier, wrong claim this session made.** Linear's key-creation
page (`https://linear.app/julia-next/settings/account/security/api-keys/new`, checked directly, not
assumed) has explicit "Only select permissions…" (Read, Write, Create issues, Create comments,
Admin — independently toggleable) and "Only select teams…" controls. The key will be created with
only **Read** and **Create comments**, restricted to team **Julia-next** — genuinely scoped, not
full-account access.

## Remaining bootstrap approval needed

Three things, one approval, no terminal or typing for Todd:

1. **Start BERTHA's runner service.** `gh api repos/toddwyder/AI-Stack/actions/runners` currently
   reports it `offline`. I have not yet located how its service is installed/started on this
   machine — this is the one piece I can't yet act on without looking further, and I won't
   guess-and-restart a service blind. If it's a Windows service, I can start it directly; if it
   needs re-registration, that's a bigger step to flag separately.
2. **Generate and place `JULIA_NEXT_DEPLOY_KEY`** — I do this myself (keypair generation, `gh repo
   deploy-key add`, `gh secret set`), no browser or terminal action from Todd.
3. **Create and place `LINEAR_API_KEY`** — via Todd's already-authenticated Linear browser session
   (Read + Create-comments only, team Julia-next only, per the corrected scoping above), copied via
   manual select+Ctrl+C the same way the Axiom token was handled, piped directly into `gh secret
   set` without ever being displayed.

## Readiness check (one command)

```sh
node scripts/check-readiness.mjs
```

Reports each precondition separately: BERTHA registered and online; each of the four secrets
present on `toddwyder/AI-Stack` (existence only — `gh secret list` cannot confirm a secret's
*value* is correct, only that something is set). A `gh` CLI failure (e.g. not authenticated) is
reported as its own failed check rather than an uncaught crash. Exits non-zero with a per-line
`[ ]`/`[x]` report if anything isn't ready.

## Verification, after a run

1. `gh run list -R toddwyder/AI-Stack --workflow julia-next-supervised-worker-manual.yml` and
   inspect the run — the "Enforce successful worker publication" step fails the whole run unless
   both the worker and the finish-publish step succeeded.
2. Confirm the PR was opened by `julia-graph-publisher[bot]`, not a personal account — julia-next's
   own `publisher-only-pr.yml` check on the PR shows this automatically.
3. Confirm in Linear that JUL-43 received the start comment and the finish comment (or the failure
   comment, if the worker didn't complete).
4. Confirm `git log` on the pushed branch shows a real commit, and that `julia-next`'s own `main`
   was never pushed to directly (only the PR branch).
5. Download the run's artifact (`julia-next-supervised-worker-<run-id>`) for the packet, the
   worker's raw stdout/stderr, and `changes.patch` — the audit trail, not the worktree itself.

## Stop / recovery

- **Stopping a run in progress**: cancel the Actions run from the GitHub UI or `gh run cancel`.
  `concurrency: cancel-in-progress: false` means a second dispatch won't do this for you — it
  queues instead.
- **Recovering from a publish failure** (worker succeeded, but the finish step failed to push, open
  the PR, or comment on Linear): the worker's commit exists in the run's artifact
  (`changes.patch`) even though the ephemeral worktree itself is gone once the job ends. Fix the
  underlying cause and re-dispatch; this starts a fresh run rather than resuming the old one.
- **If a step's output doesn't match what the next step expects**, the publisher fails closed with
  a `JULIA_SUPERVISED_PUBLISHER_REFUSED` error naming the exact missing field — treat that as the
  diagnosis, not a signal to bypass validation.

## Known open questions for the live-verification pass

- Linear's `commentCreate` mutation is called with the ticket's internal UUID
  (`selection.issueId`), on the assumption that Linear's API requires the UUID there even though
  its `issue(id:)` query accepts either the UUID or the human identifier. Untested against the real
  API — confirm on the first live comment, not before.
- `gate.checkName: 'checks'` in `graph/julia-next.project.mjs` names the CI job in
  `.github/workflows/ci.yml`; nothing yet reads `gate` for `tracker: 'linear'` configs (the
  GitHub-Project gate-checking code path is native-board-specific). Present for parity with the
  existing config shape, currently unused by the Linear path.
- The criterion-4/Axiom gap above: if a single clean run needs to demonstrate all five criteria
  together, this workflow alone does not close criterion 4. Flag this explicitly when assembling
  the final evidence package rather than letting it pass unnoticed.
