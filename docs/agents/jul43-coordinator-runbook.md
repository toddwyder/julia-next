# JUL-43 coordinator runbook

Status as of 2026-09-16: **code, tests, and this document are complete; no live run has
happened yet.** Every command below is proven only against mocked tests (see
`orchestrator/test/*.test.mjs` in AI-Stack and `scripts/*.test.mjs` here — 26 tests covering
`run-jul43-coordinator.mjs`'s orchestration logic, `orca-cli.mjs`'s CLI invocations,
`collect-worker-result.mjs`'s git-state collection, and `check-readiness.mjs`'s failure
reporting) or is the same Orca dispatch mechanism already proven live earlier in JUL-43 (isolated
worktree, real commit, push denied). The Linear- and GitHub-App-specific pieces below — the
actual live API calls — are new and have never run against the real services. Treat every command
here as **designed, not demonstrated**, until the live-verification pass in JUL-43's Linear
thread says otherwise.

Initialization is one command (`scripts/run-jul43-coordinator.mjs`, below) — not a sequence of
manual steps. It calls the existing coordinator pipeline itself: prepare, dispatch through Orca,
collect the worker's real result from git, and publish, emitting lifecycle events automatically
at each stage. Nothing about a run requires hand-constructing JSON or filling in a placeholder
URL.

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

```sh
node scripts/check-readiness.mjs --ai-stack-dir /path/to/AI-Stack
```

Checks, each reported separately, pass or fail: the project config loads as a `tracker: 'linear'`
config; `JULIA_NEXT_GRAPH_WRITE_TOKEN` is set; `LINEAR_API_KEY` is set; the journey-relay is
reachable **and** reports `sent:true` for a real probe event — an HTTP 200 from the relay is not
enough by itself, since the relay can accept the request and still report `sent:false` when Axiom
delivery itself fails (bad/missing `AXIOM_TOKEN` on the runner). The probe uses its own event,
`julia.journey0.coordinator_readiness_check`, never `coordinator_started` — see "Distinguishing
idle, failed, and stalled" below for why that separation matters. Exits non-zero, with each failed
line marked `[ ]`, if anything isn't ready; prints `READY: true` and exits 0 only when every check
passes.

## Exact initialization command

Once every prerequisite above is **Done** and the readiness check passes, from a machine with
`orca` on `PATH` (this ticket has run it from Todd's local machine throughout, targeting
`--environment "OVH runner"`; see the JUL-43 Linear thread for that machine's `orca` path) and
both `AI-Stack` and `julia-next` checked out as siblings:

```sh
node julia-next/scripts/run-jul43-coordinator.mjs \
  --ai-stack-dir /path/to/AI-Stack \
  --expected-issue JUL-43 \
  --from-terminal <an existing plain-bash terminal handle on the runner> \
  --environment "OVH runner"
```

This one command does the whole route: resolves the Linear ticket (`prepareLinearSupervisedRun`),
posts the start comment, dispatches a real Orca worker (`orca orchestration run-create` /
`worker-start`, the same mechanism already proven live earlier in JUL-43), waits for it, reads the
worker's **actual** git state from its worktree to build the result (`collect-worker-result.mjs`
— never a hand-typed `result.json`), publishes the finish (push, open the PR through the App,
comment the outcome to Linear), and emits a `julia.journey0.coordinator_*` event at every stage —
`started` immediately, `progress` after each major step, then `completed` or `failed` — all
sharing one run ID, automatically, from inside the run itself (`run-jul43-coordinator.mjs`'s own
`runCoordinator()`, not a separate manual step). Its orchestration logic (event sequencing, what
happens when a step throws, how an Orca outcome maps to a worker result) is covered by
`scripts/run-jul43-coordinator.test.mjs`, `scripts/orca-cli.test.mjs`, and
`scripts/collect-worker-result.test.mjs` against mocked Orca/git/publish calls. The live API calls
inside it (Orca, Linear, the GitHub App) have not run for real — see "Known open questions" below.

`--from-terminal` needs an existing plain-bash terminal handle on the runner (any one works, per
this ticket's earlier Orca sessions) — the command does not create one for you.

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
  worktree/terminal, so note any residue rather than assuming it's gone). `run-jul43-coordinator.mjs`
  is still waiting on that dispatch when you do this, so it will itself receive the resulting
  error from `terminalWait`/`workerShow` and emit `coordinator_failed` with that real error —
  abandoning the worker does not require a separate manual event.
- **Recovering from a stalled run**: confirm via `orca orchestration worker-show` whether the
  dispatch is actually still alive before treating it as dead. If it's genuinely gone (crashed
  terminal, unreachable runner), abandon it as above and start a new run with a fresh run ID (the
  command generates one automatically each invocation, from the current timestamp) — never
  re-invoke against a `runId` that already has a `coordinator_started` event, since that would
  make two runs look like one in the event stream.
- **Recovering from a publish failure** (worker succeeded, but the finish publish failed to push,
  open the PR, or comment on Linear): the worker's commit still exists in its worktree on the
  runner — nothing is lost. `run-jul43-coordinator.mjs` does not currently retry the finish step
  on its own; fix the underlying cause (credential, network, Linear/GitHub API error visible in
  the command's own output, which also landed in the `coordinator_failed` event's `context`) and
  re-run the same command. This starts a fresh run (new worktree, new commit) rather than resuming
  the old one — re-running `--mode finish` against the original worker's worktree directly, the
  way earlier manual runs did, remains possible with AI-Stack's `publish-julia-supervised-run.mjs`
  if reusing that exact worktree is preferable to a fresh dispatch.
- **If a step's output doesn't match what the next step expects** (e.g. a missing required
  field), the publisher fails closed with a `JULIA_SUPERVISED_PUBLISHER_REFUSED` error naming the
  exact missing field — treat that message as the diagnosis, not a signal to bypass validation.

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
- `scripts/orca-cli.mjs`'s exact flag names (`--environment`, `--from`, `--objective`, `--run`,
  `--spec`, `--worktree`, `--name`, `--agent`, `--setup`, `--for`, `--timeout-ms`, `--dispatch`)
  match command lines already run live earlier in this ticket, not a fresh read of `orca --help`
  (reading that CLI's full help output was previously flagged by this environment's own safety
  layer as out of scope for an agent to probe). If the real CLI's flags have since changed, the
  first live run will surface that as a clear `orca ... failed: <stderr>` or `did not return
  valid JSON` error, not a silently wrong dispatch.
- `worker.worktree` and `worker.terminal` are read directly off `worker-start`'s JSON response in
  `run-jul43-coordinator.mjs`, on the assumption that those field names match what the CLI
  actually returns. Confirm this on the first live dispatch; if the field names differ, the
  failure will surface as `collectWorkerResult`'s git commands failing against an undefined path,
  not silent wrong data.
