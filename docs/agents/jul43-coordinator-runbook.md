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
- **Correction, checked live in the browser against `toddwyder/julia-next`'s own Settings ->
  Integrations page (2026-09-16), not the frozen `Julia` repo's `docs/credentials-map.md`:** the
  `julia-graph-publisher` GitHub App **is** installed on `toddwyder/julia-next` -- that doc is
  stale on this one point, and this runbook's earlier draft this session repeated its stale
  claim without checking the live page first. Minting a token still needs
  `JULIA_PUBLISHER_APP_ID`/`JULIA_PUBLISHER_APP_PRIVATE_KEY` readable by whichever process runs
  `publish-via-github-app.mjs`; that local credential file (`C:\Julia\.env.publisher.local`) is
  itself unreadable from this particular session -- blocked by the same environment's
  "Credential Materialization" classifier. That is a session-permission gap, not a missing
  installation.
- `julia-next` has **zero** repository secrets (`gh secret list --repo toddwyder/julia-next`
  returns nothing) -- expected: this route mints the publisher token fresh per use rather than
  storing a long-lived one, and the coordinator reads/writes Linear through its own MCP tools
  (`docs/agents/issue-tracker.md`), not a standalone `LINEAR_API_KEY` -- `check-readiness.mjs`
  no longer checks for one; that requirement was inherited from an earlier session's
  headless-script design this route doesn't use.
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
4. **journey-relay reachable** -- run from **inside a terminal on the OVH runner itself** (the
   relay binds to `127.0.0.1:8943` there only), via `orca-cli.mjs`'s `terminalCreate`/
   `terminalRead`; a real POST to `/events` should come back `sent:true`.

(No `LINEAR_API_KEY` check -- the coordinator is a live agent session using Linear's MCP tools
directly, not a headless script needing its own key.)

## What actually blocks a live run now -- two session permissions, not repo state

Repo/infra state is ready: the publisher App is installed on `julia-next`, the runner is
reachable, the project is registered there. What's missing is **permission for whichever session
drives the coordinator**, checked directly this session (2026-09-16):

1. **"Credential Materialization" blocks reading `C:\Julia\.env.publisher.local`** (the publisher
   App's local `JULIA_PUBLISHER_APP_ID`/`JULIA_PUBLISHER_APP_PRIVATE_KEY`) from this session. No
   publish and no PR merge can happen without reading that file -- both go through the same
   `publish-via-github-app.mjs` token mint.
2. **"Sensitive Remote Exec" blocks creating a terminal or dispatching a worker on "OVH runner"**
   from this session. No worker step and no Axiom event emission can happen without that.

Both denials name the same fix: "the user can add a Bash permission rule to their settings."
That is Todd's call to make, not a credential to place or a UI button to click -- it's a
decision about which session configuration is allowed to actually drive the coordinator's
write-side steps. The coordinator's read-only reconcile step (Orca status/project-setups
queries, Linear reads/writes via MCP) already works today, from this session, with no further
grant.

**PR #2** (the Axiom relay code, still open and unmerged) should be resolved through the
publisher's own merge capability (`pull_requests:write` is already in its token scope) once
blocker 1 above is lifted -- not by asking Todd to click GitHub's merge button personally, which
would recreate the personal-account bypass this whole boundary exists to avoid.

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
