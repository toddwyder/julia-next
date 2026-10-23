# JUL-231 Design B — Detached per-run child with result files

## Caller usage

Start is pressed on the control page as today. The server runs Init to produce a
`ready-for-build` snapshot (card + orchestrator/coder role selections), then
immediately launches one detached child process for that run and returns. The
browser polls `GET /julia-control/api/runs/:runId` (and a new
`GET /julia-control/api/runs/:runId/result`) to render status and, once
available, the saved `ready-for-review` result. No runner daemon is started and
no job queue is managed by the server.

CLI form (for ops/rehearsal):

```sh
node ops/build-runner/child.mjs --run-dir /var/lib/julia/runs/<runId>
```

The child is spawned by the server with `detached: true`, `stdio` redirected to
`<runDir>/child.log`, and `unref()`'d, so it survives control-server restarts.
`POST /julia-control/api/start` keeps its current shape; the new behavior is that
after `runtime.start()` returns `ready-for-build`, the server calls
`launchBuild(runId)` which writes the immutable inputs and forks the child.

On server restart, `reconcileRuns()` scans `<runsRoot>/*/job.json`, checks
`kill(pid, 0)`, and rebuilds the in-memory run index without touching children.

## Types / data shape

All artifacts live under `<runsRoot>/<runId>/`:

- `inputs.json` — written exactly once, never modified. Contains the verbatim
  `RunSnapshot` (card, roles, initializedAt) plus a `contentHash`. Schema:
  `ImmutableBuildInputsSchema = { runId, snapshot: RunSnapshotSchema, contentHash, savedAt }`.
  The child reads this and refuses to start if the hash mismatches a re-read.
- `job.json` — mutable lifecycle record, written by launcher and updated by child:
  `BuildJobSchema = { runId, pid, status: 'queued'|'running'|'succeeded'|'failed'|'stopped', startedAt, finishedAt?, exitCode?, error? }`.
- `result.json` — written only on success, atomically (temp file + rename):
  `BuildResultSchema = { runId, state: 'ready-for-review', card, roles, candidate: { files, diff? }, proof: { ... }, completedAt }`.
  This is the saved successful result displayed by the page.
- `child.log` — stdout/stderr capture.

Contracts additions in `contracts.ts`:

```ts
export const BuildStatusSchema = z.enum(['queued','running','succeeded','failed','stopped']);
export const BuildJobSchema = z.object({ runId, pid: z.number(), status: BuildStatusSchema, startedAt, finishedAt: z.string().optional(), exitCode: z.number().optional(), error: z.string().optional() });
export const BuildResultSchema = z.object({ runId, state: z.literal('ready-for-review'), card: ReadyCardSchema, roles: z.object({ orchestrator: RoleSelectionSchema, coder: RoleSelectionSchema }), candidate: z.object({ files: z.array(z.string()), note: z.string().optional() }), proof: z.object({ checks: z.array(z.string()) }), completedAt: z.string() });
export const ImmutableBuildInputsSchema = z.object({ runId, snapshot: RunSnapshotSchema, contentHash: z.string(), savedAt: z.string() });
```

`RunSnapshotSchema` stays as-is (card + two roles). `InitializationResultSchema` gains optional
`result?: BuildResultSchema` for the page's display path; or the page reads `result.json`
directly. Status is derived: `result.json` present → `ready-for-review`; else job status.

## Module files

Add:

- `ops/build-runner/child.mjs` — detached entrypoint. Reads `inputs.json`, verifies
  hash, opens one pstack session through the connection core (`ops/build-runner`
  core), runs build/review/proof in that single session, writes `result.json`
  atomically on success, updates `job.json` to `succeeded`/`failed`, exits. Uses only
  the saved orchestrator/coder models; no role fan-out, no daemon.
- `ops/mastra-agents/reviewer/src/mastra/build-launcher.ts` — `launchBuild(runId)`:
  load snapshot via `runtime.read`, write `inputs.json` + `job.json` (status queued),
  hash inputs, spawn detached child, record pid, set status running. Plus
  `reconcileRuns()` and `readResult(runId)`.

Change:

- `contracts.ts` — add schemas above; add `'ready-for-review'` to run state union where needed.
- `initialization.ts` — `createInitializationRuntime()` already registers delivery
  workflow; keep. Add `launchBuild` call site is in control server, not here, to keep
  init pure. Optionally expose `readSnapshot`.
- `control-server.ts` — after `runtime.start()` returns ready-for-build, call
  `launchBuild(runId)`; on boot call `reconcileRuns()`; pass result to page.
- `control-page.ts` — render saved result when present; remove Framework Map
  admission gate per card (learning tests replace it).

No changes to `adapter.mjs`'s single-role shape are required for the child; the child
uses the core directly. Codex's pstack settings untouched.

## Rationale

Detaching one child per run keeps the change small: no daemon process, no job
table, no worker pool, no IPC. Durability comes from the filesystem (`job.json`,
`result.json`) plus the OS process, which survives control-server restarts
(rubric 3). Inputs are written once and hashed, so they are never mutated and the
child proves it used exactly the saved card/models/worktree (rubric 1). A single
child hosts a single pstack session, and all model calls route through the
connection core under `ops/build-runner`, satisfying the one-session-through-core
requirement (rubric 2). Success persists `result.json` atomically and the page
reads that saved file, so the displayed result is the completed run's result, not
live state (rubric 4). Surface area is one new entrypoint plus one launcher module
and a few schemas, reusing existing init/runtime and run directories (rubric 5).

This is structurally distinct from alternative A: A keeps a long-lived runner
daemon with durable jobs and child workers; B has no daemon and no workers — each
run is its own OS child, and "jobs" are just files on disk. Coordination is by
filesystem + pid liveness, not by a daemon's in-memory state.