# JUL-43 coordinator runbook

Status as of 2026-09-16 (session 3): this route was corrected **twice**. Session 2 held the
Orca-dispatch coordinator in favor of a GitHub-Actions/BERTHA route
(`julia-next-supervised-worker-manual.yml`); that route is itself now held, because the
Linear-tracker AI-Stack code it depended on was only ever built in a throwaway local clone and
never actually pushed to `toddwyder/AI-Stack` -- checked directly against AI-Stack's real `main`
branch, not assumed. This session restores the Orca-dispatch pieces session 2 deleted (adapted,
not reverted verbatim) and wires them to `.claude/skills/julia-coordinator/SKILL.md`, julia-next's
own copy of the verified coordinator decision procedure already running in the frozen
`toddwyder/Julia` repo.

**The coordinator is the skill, not a script.** `scripts/orca-cli.mjs`,
`scripts/collect-worker-result.mjs`, and `scripts/publish-via-github-app.mjs` are library
functions the skill's steps call while a live agent session follows its decision procedure --
there is no standalone `run-jul43-coordinator.mjs` entry point anymore, on purpose. Treating a
JUL-43-specific wrapper script as "the coordinator" was exactly what session 2's hold-commit
correctly avoided repeating.

## What's verified live, as of this session

Checked directly, not assumed:
- Orca CLI is real and reachable from this machine at
  `C:\Users\toddw\AppData\Local\Programs\orca\resources\bin\orca.exe`. `orca status
  --environment "OVH runner" --json` returns `runtime.reachable: true`,
  `connectionState: connected`.
- `orca project setups --environment "OVH runner" --json` shows `julia-next` registered and
  `ready` at `/home/runner/julia-next`.
- `orca worktree list --environment "OVH runner" --json` shows the worktrees named in JUL-43's
  Linear comment history really exist (`jul43-axiom-boundary`, `jul43-clean-run`,
  `jul43-codex-proof`, etc.) -- that history is real, not fabricated.
- **Creating a terminal or dispatching a worker on the OVH runner is blocked from this
  particular session** by this environment's own safety classifier ("Sensitive Remote Exec") --
  the same guardrail class earlier JUL-43 sessions hit and correctly did not route around. Only
  read-only Orca queries (`status`, `project setups`, `worktree list`) succeeded here. A live
  coordinator run needs either a session with that permission, or Todd running the dispatch step
  himself using the commands this runbook documents.
- The `julia-graph-publisher` GitHub App (App ID 4948330) is installed on `toddwyder/Julia` and
  `toddwyder/AI-Stack` only -- **not on `toddwyder/julia-next`**, per
  `toddwyder/Julia`'s `docs/credentials-map.md`. `scripts/check-readiness.mjs` will report this
  as a named, failing check until the App is added to `julia-next`.
- `julia-next` has **zero** repository secrets today (`gh secret list --repo toddwyder/julia-next`
  returns nothing). `LINEAR_API_KEY` has never been placed anywhere for this project.
- PR #2 (`jul43-journey-relay` -> `main`, the Axiom relay client + trusted-boundary code) is
  still **open, unmerged**. `julia-next`'s `main` branch has none of `ops/journey-relay` or
  `scripts/journey-events.mjs` -- only what's on this local branch.

## The coordinator's actual startup

There is no scheduled trigger -- explicit launch only, per instruction. Starting a fresh Claude
Code (or equivalent) session in this repo and invoking the `julia-coordinator` skill (it has
`disable-model-invocation: true`, so it must be invoked by name, not inferred) begins a wake:
it reconciles Orca + Linear state, advances the current in-flight item (JUL-43 itself, until its
five criteria pass together), and admits the next eligible Linear issue once a slot is free.

```sh
node scripts/check-readiness.mjs
```

first -- see below for what it actually checks now.

## Readiness check (rewired to the real boundary)

`scripts/check-readiness.mjs` no longer checks BERTHA/GitHub-Actions secrets (that route is
held). It checks, each as its own pass/fail line:

1. **OVH runner reachable** -- `orca status --environment "OVH runner" --json`,
   `runtime.reachable` and `connectionState === 'connected'`.
2. **julia-next project registered** -- `orca project setups`, a `ready` entry for
   `github:toddwyder/julia-next`.
3. **julia-graph-publisher installed on julia-next** -- attempts the same installation lookup
   `publish-via-github-app.mjs` uses for a real publish (requires
   `JULIA_PUBLISHER_APP_ID`/`JULIA_PUBLISHER_APP_PRIVATE_KEY` in the coordinator's own process
   environment).
4. **LINEAR_API_KEY configured** -- present in the coordinator's own process environment.
5. **journey-relay reachable** -- run from **inside a terminal on the OVH runner itself** (the
   relay binds to `127.0.0.1:8943` there only), via `orca-cli.mjs`'s `terminalCreate`/
   `terminalRead`; a real POST to `/events` should come back `sent:true`.

## Remaining bootstrap approvals needed -- credential/access boundaries, not code

1. **Install the `julia-graph-publisher` GitHub App on `toddwyder/julia-next`.** One click, by
   whoever administers the App's GitHub installation (Settings -> Installations ->
   julia-graph-publisher -> Configure -> add repository). No new App, no new key -- the same
   App already used for `Julia` and `AI-Stack`.
2. **Create and place `LINEAR_API_KEY`.** Scoped to Read + Create-comments only, team Julia-next
   only (Linear's key-creation page supports this scoping, confirmed session 2). Placement
   target for the coordinator's own process environment is the same pattern already used for the
   Axiom token and the publisher App's local `.env.publisher.local` on `toddwyder/Julia` -- not
   chat, not a GitHub Actions secret (this route doesn't run in Actions).
3. **Decide PR #2's fate.** It carries real, tested relay code `main` is missing. Merging it (a
   normal review-and-click, the same "one action" pattern JUL-43's own comment history already
   asked for) is what makes `ops/journey-relay` and `scripts/journey-events.mjs` available to a
   worker dispatched from a clean `main` checkout, rather than only existing on runner-local
   worktrees that were deliberately never pushed.
4. **The remote-exec permission gap this session hit.** Whatever session actually drives the
   coordinator through a live wake needs permission to create Orca terminals / dispatch workers
   on "OVH runner" -- this session's own classifier refused that. Confirm which session
   configuration allows it before expecting a live run to complete unattended.

## Verification, after a run

1. Read the Linear issue's own comment thread -- the coordinator posts admission, blocked, and
   acceptance updates there, not in chat.
2. Confirm the PR (if any) was opened by `julia-graph-publisher[bot]`, not a personal account --
   `julia-next`'s own `publisher-only-pr.yml` check on the PR shows this automatically.
3. Confirm in Axiom (dataset `julia-next-journey0`) that `coordinator_started` /
   `coordinator_progress` / `coordinator_completed` (or `_failed`) events exist for the run's
   `runId`, and that no run is stalled (see the query in the skill's Journey accounting
   section).
4. Confirm `git log` on the pushed branch shows a real commit, and that `julia-next`'s own
   `main` was never pushed to directly (only the PR branch).

## Stop / recovery

- **Stopping a run in progress**: use Orca's own recovery verbs (`worker-stop` for a proven
  failed/stopped attempt, `worker-abandon` to fence orchestration while accepting resources may
  remain live) -- never `terminal close` as a substitute. See Orca's own `orchestration` skill,
  "Recovery and cleanup".
- **Recovering from a publish failure** (worker succeeded, publish step failed): the worker's
  commit still exists in its worktree on the runner even if the publish step errored --
  re-run just the publish step against that same worktree rather than re-dispatching the whole
  step.
- **If `publish-via-github-app.mjs` reports "not installed on toddwyder/julia-next"**, that is
  bootstrap approval #1 above, not a bug -- park the item and ask, don't retry blindly.

## Known open questions for the live-verification pass

- Linear's `commentCreate` mutation may need the ticket's internal UUID rather than its human
  identifier -- untested against the real API from this route yet; confirm on the first live
  comment, not before.
- The exact APL join syntax in the skill's stalled-run query is written from APL's documented
  shape, not verified against a real query on the live `julia-next-journey0` dataset -- verify
  before trusting it as a monitoring step.
- `gate.checkName: 'checks'` in `graph/julia-next.project.mjs` names the CI job in
  `.github/workflows/ci.yml`; nothing in this route currently reads `gate` for `tracker: 'linear'`
  configs. Present for parity with the config shape, currently unused.
