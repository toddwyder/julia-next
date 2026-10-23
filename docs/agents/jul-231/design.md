# JUL-231 Design — Detached per-run child (base B) with durability grafts from A

## Base design

**Design B — detached per-run child with result files.** Build runs as one OS
child process per `Start`, detached and `unref()`'d so it survives a
control-server restart. State lives on disk under `<runsRoot>/<runId>/`
(`inputs.json`, `job.json`, `result.json`, `child.log`). There is no runner
daemon, no job queue, and no worker pool. This is the smaller surface and it
matches the card's scope, which mentions only the control page on the server and
does not introduce a separate long-lived service.

## Grafts (taken from Design A)

1. **Cost proof field.** `BuildResult` gains `spentUsd?` (expected `$0` for the
   Beam proof run), so the saved result carries the run's cost alongside
   `proof.checks`, rather than only a checklist.
2. **Read-only immutable input store.** Keep B's "written exactly once" rule, but
   adopt A's explicit contract: inputs are stored as canonical JSON plus
   `inputHash`/`contentHash`, exposed through a read-only `getInputs(runId)`
   with no update path; the child re-reads inputs and refuses to start if the
   re-read hash mismatches. Rename the schema to `SavedBuildInputs` with
   `inputHash` to match A's vocabulary, while retaining B's file layout.
3. **Agent-record disconnect preserved.** On control-server restart, keep the
   existing behavior of disconnecting *active agent records* only; build children
   are untouched (B already leaves them running; this makes the boundary
   explicit, per A).
4. **Dead-worker reconciliation semantics.** On boot, `reconcileRuns()` checks
   each recorded pid with `kill(pid, 0)`; a dead worker's job becomes `failed`
   with its recorded error, while a live one is re-attached. Adopt A's
   "failed (or re-queued)" wording and richer `error: { message, code? }`
   shape instead of a bare string.
5. **Status vocabulary.** Align `BuildStatus` with A's enum
   (`queued | running | succeeded | failed | cancelled`) rather than B's
   `stopped`, so a future cancel maps cleanly; `cancelled` is set only when an
   explicit cancel is implemented (out of scope for this card, but the enum is
   forward-compatible).

## Rejected alternative

**Design A — independent runner daemon with durable jobs and child workers.**
Rejected. A introduces a second long-lived process (pid file, socket/port,
reconciliation on daemon boot) plus IPC reporting from workers, which the card
does not call for and which a test harness that starts only the control page
would have to provision. For the card's required scenario (control-page restart
leaves the runner running), B's detached child plus file-based reconciliation
already satisfies restart independence, so the daemon's extra durability and
monitoring do not justify its operational and maintenance cost, and it conflicts
with the "small maintainable change" criterion. A's stronger pieces (cost
field, read-only store, reconciliation semantics, status enum, agent-record
boundary) are grafted above instead of adopting the daemon itself.

## Caller usage

Start is pressed on the control page as today. The server runs Init to produce a
`ready-for-build` snapshot (card + orchestrator/coder role selections, per card
AC2), then calls `launchBuild(runId)`, which writes the immutable inputs and
forks one detached child. The browser polls
`GET /julia-control/api/runs/:runId` (and a new
`GET /julia-control/api/runs/:runId/result`) to render status and, once
available, the saved `ready-for-review` result. No daemon is started.

CLI form (ops/rehearsal):

```sh
node ops/build-runner/child.mjs --run-dir /var/lib/julia/runs/<runId>
```

The child is spawned with `detached: true`, stdio redirected to
`<runDir>/child.log`, and `unref()`'d. On server restart, `reconcileRuns()`
scans `<runsRoot>/*/job.json`, checks `kill(pid, 0)`, and rebuilds the
in-memory run index without touching children.

## Types / data shape

All artifacts live under `<runsRoot>/<runId>/`:

- `inputs.json` — written exactly once, never modified. `SavedBuildInputsSchema =
  { runId, snapshot: RunSnapshotSchema, inputHash, savedAt }`, where `snapshot`
  carries the verbatim `RunSnapshot` (card, orchestrator + coder roles,
  initializedAt). The child reads this and refuses to start if a re-read hash
  mismatches.
- `job.json` — mutable lifecycle record, written by launcher and updated by
  child: `BuildJobSchema = { runId, pid, status: BuildStatusSchema, startedAt,
  finishedAt?, exitCode?, error?: { message, code? } }`.
- `result.json` — written only on success, atomically (temp file + rename):
  `BuildResultSchema = { runId, state: 'ready-for-review', card, roles:
  { orchestrator, coder }, candidate: { files, note? }, proof: { checks },
  spentUsd?, completedAt }`.
- `child.log` — stdout/stderr capture.

Contracts additions in `contracts.ts`:

```ts
export const BuildStatusSchema = z.enum(['queued','running','succeeded','failed','cancelled']);
export const BuildJobSchema = z.object({ runId, pid: z.number(), status: BuildStatusSchema, startedAt, finishedAt: z.string().optional(), exitCode: z.number().optional(), error: z.object({ message: z.string(), code: z.string().optional() }).optional() });
export const BuildResultSchema = z.object({ runId, state: z.literal('ready-for-review'), card: ReadyCardSchema, roles: z.object({ orchestrator: RoleSelectionSchema, coder: RoleSelectionSchema }), candidate: z.object({ files: z.array(z.string()), note: z.string().optional() }), proof: z.object({ checks: z.array(z.string()) }), spentUsd: z.number().optional(), completedAt: z.string() });
export const SavedBuildInputsSchema = z.object({ runId, snapshot: RunSnapshotSchema, inputHash: z.string(), savedAt: z.string() });
```

`RunSnapshotSchema` stays as-is (card + orchestrator/coder roles). Init stops at
`ready-for-build`; `InitializationResultSchema` gains optional
`result?: BuildResultSchema` for the page's display path, or the page reads
`result.json` directly. Status is derived: `result.json` present →
`ready-for-review`; else job status.

## Module files

Add:

- `ops/build-runner/child.mjs` — detached entrypoint. Reads `inputs.json`,
  verifies hash, opens one pstack session through the connection core
  (`ops/build-runner`), runs build/review/proof in that single session, writes
  `result.json` atomically on success, updates `job.json` to
  `succeeded`/`failed`, exits. Uses only the saved orchestrator/coder models; no
  role fan-out, no daemon. Refuses to start if the hash mismatches a re-read.
- `ops/mastra-agents/reviewer/src/mastra/build-launcher.ts` — `launchBuild(runId)`:
  load snapshot via `runtime.read`, write `inputs.json` + `job.json` (status
  queued), hash inputs, spawn detached child, record pid, set status running.
  Plus `reconcileRuns()` and `readResult(runId)`.

Change:

- `contracts.ts` — add schemas above; add `'ready-for-review'` to run state union
  where needed.
- `initialization.ts` — keep `createInitializationRuntime()` registering the
  delivery workflow. Keep init pure (no `launchBuild` here); optionally expose
  `readSnapshot`. Add a small helper to convert a `RunSnapshot` into
  `SavedBuildInputs` (orchestrator + coder only), per card AC2.
- `control-server.ts` — after `runtime.start()` returns `ready-for-build`, call
  `launchBuild(runId)`; on boot call `reconcileRuns()`; pass result to page;
  keep "disconnect active agent records on restart" for agents only.
- `control-page.ts` — render saved result when present; remove the Framework
  Map admission gate per card AC7 (learning tests replace it).

No changes to `adapter.mjs`'s single-role shape are required; the child uses the
core directly. Codex's pstack settings remain untouched.

## Rationale

- **Exact immutable saved inputs (1):** `inputs.json` written once with
  `inputHash`; the child re-reads and refuses on mismatch; no update path
  (grafted read-only store semantics).
- **One hosted pstack session through core (2):** a single detached child hosts
  one pstack session and routes all calls through the connection core under
  `ops/build-runner`.
- **Restart independence (3):** detached child survives control-server restart;
  `reconcileRuns()` rebuilds state from files and pid liveness; no daemon
  required for the card's control-page-restart scenario.
- **Saved successful result display (4):** `result.json` written atomically on
  success and read back by the page as `ready-for-review`.
- **Small maintainable change (5):** one new entrypoint plus one launcher module
  and a few schemas, reusing existing init/runtime and run directories; init
  flow unchanged up to `ready-for-build`.

## Lead decision after service documentation readback

The Beam judge preferred B. That preference assumes detaching a child escapes its service lifetime. Installed systemd.kill(5) states that the default control-group mode kills all remaining processes when the unit stops. This deployment restarts the service, so the premise does not hold. Use A's separate runner lifetime with B's atomic input/job/result files. Omit a queue, cancellation, crash recovery, input registry and new database. One runner owns job admission and starts a worker per saved run. This preserves the smallest design that meets the actual restart requirement.
