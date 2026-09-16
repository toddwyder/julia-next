# JUL-43 coordinator runbook

Status as of 2026-09-16: **code, tests, and this document are complete; no live run has
happened yet.** Every command below is proven only against mocked tests (see
`orchestrator/test/*.test.mjs` in AI-Stack and `scripts/coordinator-events.test.mjs` here) or is
the same Orca dispatch mechanism already proven live earlier in JUL-43 (isolated worktree, real
commit, push denied). The Linear- and GitHub-App-specific pieces below — the actual live API
calls — are new and have never run against the real services. Treat every command here as
**designed, not demonstrated**, until the live-verification pass in JUL-43's Linear thread says
otherwise.

## What this replaces

Earlier JUL-43 runs drove every step by hand: manual `orca orchestration` calls, a manually
written and manually pushed relay/journey-events PR, manual Linear comments. This runbook is the
same underlying mechanics (Orca dispatch, the read-only deploy key, the journey-relay), now
routed through the reusable prepare → dispatch → publish pipeline that already exists in
`toddwyder/AI-Stack` for `toddwyder/Julia`, extended with a Linear-tracker path
(`orchestrator/lib/linear-client.mjs`, `createLinearAwarePublisherEffects`, `tracker: 'linear'`
in `orchestrator/lib/project-config.mjs`) instead of a new coordinator or a new publisher.

## Prerequisites

Checked as of 2026-09-16, not assumed:

| Prerequisite | Status |
|---|---|
| `julia-graph-publisher` GitHub App authorized for `julia-next` | **Done.** Confirmed on both the App's own installation page and `julia-next`'s Settings → Integrations → GitHub Apps. |
| `PR #2` (journey-relay code) merged to `julia-next` `main` | **Not done.** `graph/julia-next.project.mjs` and `scripts/coordinator-events.mjs` only exist on `PR #2`'s branch until it merges — a run against `main` cannot load them before then. |
| `julia-graph-publisher`'s private key placed on the OVH runner | **Not done.** Only ever wired into a local dev file (`.env.publisher.local`) on a different machine, per AI-Stack's own `HANDOFF-2026-09-14.md`. Needs the same root-placed, dedicated-account treatment as the Axiom token (see `ops/journey-relay/README.md` for the pattern to follow). |
| `LINEAR_API_KEY` (a Linear personal API key or OAuth token, scoped to read + comment on team `Julia-next`) placed on the runner | **Not done.** No such credential exists anywhere yet — this is new, not a relocation of an existing one. |
| `AI-Stack` checked out on the runner alongside `julia-next` | Not confirmed in this pass — the orchestrator scripts (`prepare-julia-supervised-run.mjs`, `publish-julia-supervised-run.mjs`, `orchestrator/lib/*`) live in `toddwyder/AI-Stack`, not `julia-next`. A run needs both repos present. |

Do not attempt the initialization command below until the first four rows are all **Done**.

## Readiness check (one command)

Run from a runner terminal with both repos checked out:

```
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8943/events -X POST \
  -H 'content-type: application/json' \
  -d '{"event":"julia.journey0.coordinator_started","attempted":"readiness-check","reason":"manual","context":"runbook"}' \
&& node -e "import('$(pwd)/AI-Stack/orchestrator/lib/project-config.mjs').then(({defineProjectConfig}) => import('$(pwd)/julia-next/graph/julia-next.project.mjs')).then(m=>console.log('config OK'))" \
&& [ -n "$JULIA_NEXT_GRAPH_WRITE_TOKEN" ] && echo 'publisher credential present' || echo 'MISSING: JULIA_NEXT_GRAPH_WRITE_TOKEN' \
&& [ -n "$LINEAR_API_KEY" ] && echo 'linear credential present' || echo 'MISSING: LINEAR_API_KEY'
```

Expect: `200` from the relay POST, `config OK` from loading the project config, and both
credential lines confirming present. Any other output names exactly what isn't ready — treat that
as the report to give, not something to route around.

## Exact initialization command

Once every prerequisite above is **Done**, from the runner, with `AI-Stack` and `julia-next`
checked out as siblings:

```sh
# 1. Prepare -- resolves the Linear ticket, stages its description as the
#    approved work definition. Trusted step; does not touch GitHub.
RUN_ID="jul43-$(date -u +%Y%m%dT%H%M%SZ)"
node AI-Stack/orchestrator/prepare-julia-supervised-run.mjs \
  --project-config julia-next/graph/julia-next.project.mjs \
  --expected-issue JUL-43 \
  --output-dir /tmp/$RUN_ID

# 2. Announce the run to Linear (posts one comment on JUL-43).
node AI-Stack/orchestrator/publish-julia-supervised-run.mjs \
  --mode start \
  --project-config julia-next/graph/julia-next.project.mjs \
  --selection /tmp/$RUN_ID/selection.json \
  --run-id "$RUN_ID" \
  --run-url "<the Orca run's own URL, once dispatched>" \
  --base-commit "$(git -C julia-next rev-parse HEAD)"

# 3. Dispatch the worker through Orca (the already-proven path -- see
#    docs/agents/jul43-coordinator-runbook.md's "Orca mechanics" reference
#    in the JUL-43 Linear thread for the exact orca CLI invocations).
#    Hand the worker /tmp/$RUN_ID/approved-work-definition.md and
#    /tmp/$RUN_ID/bounded-context.md as its brief. The worker commits but
#    cannot push (read-only deploy key, unchanged).

# 4. Once the worker reports done, write its result to
#    /tmp/$RUN_ID/result.json in the shape julia-supervised-publisher.mjs
#    expects (runId, workItemId, branch, baseCommit, commit, worktree,
#    outcome, process, evidenceRefs), then publish the finish:
node AI-Stack/orchestrator/publish-julia-supervised-run.mjs \
  --mode finish \
  --project-config julia-next/graph/julia-next.project.mjs \
  --selection /tmp/$RUN_ID/selection.json \
  --result /tmp/$RUN_ID/result.json \
  --run-id "$RUN_ID" \
  --run-url "<the Orca run's own URL>"
```

Every one of these four steps should also emit a `julia.journey0.coordinator_*` event via
`scripts/coordinator-events.mjs`'s `recordCoordinatorEvent(stage, { runId: RUN_ID })` (`started`
before step 1, `progress` after step 2, `completed` after step 4 succeeds, `failed` from a
`catch` around any step) — all four sharing the same `RUN_ID`, which is also what steps 2 and 4
pass as `--run-id`. This is not yet wired into the orchestrator scripts themselves (that would be
a further, still-undemonstrated change); until it is, emit these calls by hand around the
commands above, or from whatever wrapper script actually drives a live run.

## Verification, after a run

1. Confirm the PR was opened by `julia-graph-publisher[bot]`, not a personal account — the
   `publisher-only-pr.yml` check on the PR shows this automatically.
2. Confirm in Linear that JUL-43 received the start comment and the finish comment (or the
   failure comment, if the worker didn't complete).
3. Confirm in Axiom's own Stream view (dataset `julia-next-journey0`) that all four
   `julia.journey0.coordinator_*` events landed, correlated by the same `runId`.
4. Confirm `git log` on the pushed branch shows a real commit, and that `julia-next`'s own
   `main` was never pushed to directly (only the PR branch).

## Distinguishing idle, failed, and stalled

All three are read from the `julia.journey0.coordinator_*` event stream in Axiom, correlated by
`runId` — no new dashboard, no new storage:

- **Idle**: no `coordinator_started` event for any `runId` in the window you're checking. Nothing
  is running; this is the expected state between runs.
- **Failed**: a `coordinator_started` event has a matching `coordinator_failed` for the same
  `runId`. The failure reason is in that event's `context` field.
- **Stalled**: a `coordinator_started` event for a `runId` has neither a `coordinator_completed`
  nor a `coordinator_failed` within a reasonable ceiling for a single-ticket run (start at 30
  minutes; adjust once a real run's actual duration is known). This is the one case that needs an
  explicit query rather than just reading the latest event, since "still running" and "died
  without reporting" look identical from a single event.

**Stalled-run query** (Axiom APL, dataset `julia-next-journey0`):

```
['julia-next-journey0']
| where event in ('julia.journey0.coordinator_started', 'julia.journey0.coordinator_completed', 'julia.journey0.coordinator_failed')
| extend runId = tostring(parse_json(context).runId)
| summarize started=countif(event == 'julia.journey0.coordinator_started'),
            ended=countif(event in ('julia.journey0.coordinator_completed', 'julia.journey0.coordinator_failed')),
            startedAt=minif(_time, event == 'julia.journey0.coordinator_started')
  by runId
| where started > 0 and ended == 0 and startedAt < ago(30m)
```

Any row back means that `runId` started and never reported an end within 30 minutes — a stall,
not an idle system.

## Stop / recovery

- **Stopping a run in progress**: `orca orchestration worker-abandon --environment "OVH runner"
  --dispatch <id> --json` (the already-documented, proven-safe path — it does not delete the
  worktree/terminal, so note any residue rather than assuming it's gone). Then manually emit a
  `coordinator_failed` event for that `runId` with `reason: "abandoned"`, since an abandoned
  worker never gets to report its own outcome.
- **Recovering from a stalled run**: confirm via `orca orchestration worker-show` whether the
  dispatch is actually still alive before treating it as dead. If it's genuinely gone (crashed
  terminal, unreachable runner), abandon it as above, emit `coordinator_failed`, and start a new
  run with a fresh `RUN_ID` — never reuse a `runId` that already has a `coordinator_started`
  event, since that would make two runs look like one in the event stream.
- **Recovering from a publish failure** (worker succeeded, but `--mode finish` failed to push or
  open the PR, or failed to comment on Linear): the worker's commit still exists in its worktree
  on the runner — nothing is lost. Fix the underlying cause (credential, network, Linear/GitHub
  API error visible in the command's own output) and re-run `--mode finish` with the same
  `selection.json` and `result.json`; it is not destructive to re-attempt.
- **If a step's output doesn't match what the next step expects** (e.g. `result.json` missing a
  required field), the publisher fails closed with a `JULIA_SUPERVISED_PUBLISHER_REFUSED` error
  naming the exact missing field — treat that message as the diagnosis, not a signal to bypass
  validation.

## Known open questions for the live-verification pass

- Linear's `commentCreate` mutation is called with the ticket's internal UUID
  (`selection.issueId`), on the assumption that Linear's API requires the UUID there even though
  its `issue(id:)` query accepts either the UUID or the human identifier. This assumption is
  untested against the real API — confirm on the first live comment, not before.
- `gate.checkName: 'checks'` in `graph/julia-next.project.mjs` names the CI job in
  `.github/workflows/ci.yml`; nothing yet reads `gate` for `tracker: 'linear'` configs (the
  GitHub-Project gate-checking code path is native-board-specific). This field is present for
  parity with the existing config shape but currently unused by the Linear path — note this
  rather than implying it's enforced.
