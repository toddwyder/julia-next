# JUL-231 Design A — Independent runner daemon with durable jobs and child workers

## Overview

Move build execution out of the control page process into a separate, long-lived
**runner daemon**. The control page stays a thin client: on Start it snapshots the
saved `ready-for-build` inputs, hands an immutable copy to the daemon, and the
daemon queues and runs the job in a **child worker** process. Job state, inputs,
and successful results live in a durable store owned by the daemon, so the control
page can restart without affecting a running build, and a daemon restart can
reconcile/recover jobs.

This is structurally different from "detached per-run child with result files":
here there is one daemon that owns durability and lifecycle, and child workers
report back to it over IPC rather than writing result files on their own.

## Caller usage

### Control page / server

- `POST /julia-control/api/start` keeps its current validation and `runId`
  handling, but after producing `ready-for-build` it calls the runner client:
  `runner.enqueue({ runId, snapshot })`.
- The client returns `{ jobId, status: 'queued' }`; the server responds to the
  browser with the saved inputs plus `jobId`.
- `GET /julia-control/api/runs` (and a new `GET /julia-control/api/jobs/:jobId`)
  reads job status and, when present, the saved `ready-for-review` result from
  the daemon store. The page renders that saved result instead of raw init JSON.
- Restarting the control page does not touch the daemon; running jobs keep their
  PIDs and the page re-attaches by `jobId`.

### Daemon process

- Started independently: `node ops/build-runner/daemon.mjs` (or `npm run runner`).
- Owns a pid file and a local socket/HTTP port (e.g. `127.0.0.1:8731`).
- Exposes:
  - `POST /jobs` `{ runId, inputs }` → `{ jobId, status }`
  - `GET /jobs/:jobId` → job record + result (if any)
  - `POST /jobs/:jobId/cancel` → marks cancelled, signals worker
- On boot, reconciles store: jobs left `running` are checked against their
  recorded worker PID; dead workers become `failed` (or re-queued if desired),
  live ones are re-attached.

### Child worker

- The daemon spawns one child process per job:
  `node ops/build-runner/worker.mjs --jobId <id>`.
- The worker loads the immutable saved inputs from the store, starts **one**
  pstack session hosted in Mastra Code, with orchestrator + coder models from the
  saved inputs, all model calls routed through the connection core (JUL-251).
- It reports progress and the final result back to the daemon over IPC (stdio
  JSON-RPC) or the local socket; the daemon persists them. The worker never
  writes result files itself.

## Types / data shape

All new schemas live alongside existing ones in
`ops/mastra-agents/reviewer/src/mastra/contracts.ts`.

```
BuildRoleModelSchema = { provider, model }   // saved model selection

SavedBuildInputsSchema = {
  runId,                          // from init
  card: ReadyCardSchema,          // immutable card snapshot
  roles: {                        // only orchestrator + coder (card AC2)
    orchestrator: BuildRoleModelSchema,
    coder: BuildRoleModelSchema,
  },
  initializedAt,                  // from ready-for-build snapshot
  inputHash,                      // sha256 of canonical JSON; proves verbatim
}

BuildStatusSchema = enum:
  'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

BuildJobSchema = {
  jobId, runId, inputId,          // inputId references immutable saved inputs
  status: BuildStatusSchema,
  createdAt, startedAt?, finishedAt?,
  workerPid?,
  resultId?,
  error? : { message, code? },
}

BuildResultSchema = {             // state: 'ready-for-review'
  resultId, jobId, runId,
  state: 'ready-for-review',
  candidate: { files: string[], marker: { path, content } },
  completedAt,
  spentUsd?,                      // expected $0 for Beam proof
}

// init state gains 'ready-for-review' as a terminal build outcome
```

Immutability rules:

- `SavedBuildInputs` is written once at enqueue as a canonical JSON blob plus
  `inputHash`; jobs store only `inputId` + `inputHash`, never a mutable copy.
- The store exposes inputs read-only (`getInputs(inputId)`); no update path.
- Workers receive `jobId` only and re-read inputs from the store, so the
  executed card/models/worktree always match what was saved.

## Module files

### Add

- `ops/build-runner/daemon.mjs` — daemon entry: pid file, socket/HTTP API, job
  queue, worker spawn/monitor, reconciliation on boot.
- `ops/build-runner/worker.mjs` — child worker entry: load inputs by jobId, run
  one pstack session through core, report via IPC.
- `ops/build-runner/job-store.mjs` — durable store (LibSQL/SQLite): tables
  `build_inputs`, `build_jobs`, `build_results`; append-only inputs/results.
- `ops/build-runner/runner-client.ts` — typed client used by control server to
  talk to daemon.
- `ops/mastra-agents/reviewer/src/mastra/runner-types.ts` (or extend
  `contracts.ts`) — Zod schemas above.

### Change

- `ops/mastra-agents/reviewer/src/mastra/contracts.ts` — add
  `SavedBuildInputs`, `BuildJob`, `BuildResult`, `BuildStatus`; add
  `ready-for-review` state.
- `ops/mastra-agents/reviewer/src/mastra/control-server.ts` — Start handler
  enqueues a job via runner client; runs endpoint includes job status/result;
  keep "disconnect active agent records on restart" behavior for agents only.
- `ops/mastra-agents/reviewer/src/mastra/control-page.ts` — render saved
  `ready-for-review` result; poll/show job status.
- `ops/mastra-agents/reviewer/src/mastra/initialization.ts` — keep init
  stopping at `ready-for-build`; add a small helper to convert a `RunSnapshot`
  into `SavedBuildInputs` (orchestrator + coder only).

## Rationale

- **Restart independence**: the daemon is a separate process with its own
  durable store; control page restarts never kill a build, and daemon restarts
  reconcile jobs by PID. (Rubric 3)
- **Exact immutable saved inputs**: inputs are hashed and stored append-only;
  workers re-read by `inputId`, so executed values match saved values. (Rubric 1)
- **One hosted pstack session through core**: a single worker process runs one
  pstack session and routes all calls through the connection core, satisfying
  the card's one-session requirement. (Rubric 2)
- **Saved successful result display**: `BuildResult` with `ready-for-review` is
  persisted by the daemon and surfaced by the page after completion. (Rubric 4)
- **Small maintainable change**: init flow is unchanged up to `ready-for-build`;
  build is a separate daemon concern with three new files plus thin client
  wiring, keeping surface area minimal. (Rubric 5)