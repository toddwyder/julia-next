# JUL-239 design qualification — 17 October 2026

Read JUL-239, both 17 October comments (“Pre-plan Confirm” and “Framework Map”), and `docs/design/2026-10-17-jul-239-interface-research.md`. These are recommendations supported by disposable local experiments, not implementation, independent Review, machine Proof, or permission to begin delivery. Criteria and Triage status are unchanged.

**1. Step history — choose a transactional Julia event journal in the existing database file.**

Two sketches from different model families, deliberately not implemented:

```ts
// A: mutable aggregate inside workflow state
type HistoryState = { original: Step[]; additions: Step[]; attempts: Attempt[]; seen: string[] };
async function replaceHistory(run: WorkflowRun, next: HistoryState) { /* not implemented */ }

// B: immutable facts plus a projection — chosen
type Observation = { eventId: string; runId: string; producerId: string;
  producerSeq: number; kind: EventKind; occurredAt: string; payload: EventPayload };
async function appendObservation(event: Observation, expectedHead?: number): Promise<Receipt> {
  /* not implemented */
}
function projectProgress(events: StoredObservation[]): RunProgress { /* not implemented */ }
```

A uses documented Mastra `stateSchema`/`setState` and snapshot persistence, but an array copied from a stale state can overwrite another writer’s addition. A seen-ID array in that same replacement does not fix the race. Restricting all writes to one live workflow execution also fails the external-observation/restart requirement and invites using resume as an ingestion operation. Reject A.

B appends to **Julia-owned namespaced tables in the exact configured `JULIA_INITIALIZATION_DB` file**, default `~/.julia/initialization.db`. This extends the existing run store; it is neither another database nor a file-based progress controller. Mastra retains ownership of all its tables and workflow execution. Read its snapshots through public readers; never issue application SQL against its tables.

The installed public documentation supplies workflow state, snapshots and readback, but no documented generic immutable observation append with duplicate receipts, conditional revision checks and cross-writer ordering. Do not claim such a stock operation exists. The journal is a custom Julia adapter using the installed public `@libsql/client` transaction interface. No private Mastra client access, package patch, or repurposed memory/trace table is needed.

Rules selected:

- The original plan is one immutable ordered list of stable step IDs. An addition records a new ID, insertion anchor, reason and original addition time; equal anchors use accepted journal sequence as the tie-break. Reopening keeps the same step ID and creates the next attempt, retaining every prior start, completion and evidence record. Reordering the displayed current plan never rewrites the original list.
- Define `StepObservationSchema` once: schema version, card/run identity, worker attempt, step/step attempt where relevant, producer identity/ordinal, stable event ID, kind, occurrence time and typed payload. `expectedHead` belongs to the request; the receipt contains accepted sequence and first receipt time. Define `RunProgressSchema` once for the existing reader/page. These remain proposed interfaces.
- In one write transaction: check identity and producer order; look up the event ID; return its original receipt for an identical replay; reject different content under that ID; read the current head; validate any expected revision and legal transition; append the next per-run sequence. Unique constraints cover run/event ID, run/sequence and producer/ordinal. A duplicate lookup precedes revision validation, so a lost acknowledgement can be retried after later commits.
- Additions to different IDs may both append. Competing changes to one attempt require its expected revision; one succeeds and the other receives an explicit conflict to reconcile. No last-writer replacement or silent automatic semantic rebase. Step completion must name the currently open attempt; a late completion cannot close a reopened attempt.
- A busy/stale-snapshot retry releases the transaction and connection, reopens, rereads and retries the unchanged event identity. A bounded retry failure is reported as unacknowledged, not dropped or acknowledged. Never acknowledge before commit.
- “No loss/duplicates” applies to accepted durable facts and identical retries. A process can die before an observation reaches any durable medium. That interval is explicitly unknown, rather than an impossible exactly-once claim about unrecorded events. Keep pending observations and retry identities until acknowledgement; after producer loss, do not invent the missing facts.

**Prototype result:** ran `node C:/Dev/jul239-qualification-prototype/qualification.mjs` with Node 24.14.1 and installed Mastra/libSQL packages, exclusively against `PROTOTYPE-wipe-me.db`. Two real Node writers each submitted 30 additions twice while first transactions were deliberately held for 250 ms. Including the original plan, **121 submissions produced 61 unique contiguous records**, with one actual contention retry in the final run. Two requests using the same head produced exactly one acceptance and one explicit stale-head conflict; explicitly reconciling the rejected addition retained both. Fresh-process readback preserved the original plan, the addition’s reason/time, and both attempts’ original timestamps. Replaying the reopen did not create another attempt. Stale-attempt and evidence-free completions were rejected.

The forced-contention experiment first exhausted retries with `SQLITE_BUSY_SNAPSHOT` when reusing a connection. Releasing/reopening it made the same scenario pass. Injected pre-commit failure rolled back; killing a writer inside its transaction rolled back; replay committed once. Injected post-commit acknowledgement loss replayed once with its original receipt. Reusing an ID with changed content was rejected. The rejected aggregate sketch also demonstrated losing addition A when a stale replacement containing B won.

**2. Development launcher — choose an owned-child observation wrapper, inside JUL-239.**

```ts
// A: discover and poll an arbitrary external process
async function attachByPid(pid: number, logPath: string): Promise<RunProgress> {
  /* not implemented */
}

// B: authorized host owns execution; observer only receives facts — chosen
async function launchAuthorizedDevelopmentJob(grant: ExistingAuthorization,
  spec: ApprovedCommandSpec, sink: ObservationSink): Promise<ObservedExit> {
  /* not implemented */
}
function observeDevelopmentChild(child: OwnedChild, context: JobIdentity,
  sink: ObservationSink): Promise<ObservedExit> { /* not implemented */ }
```

Reject A: a PID can be reused, logs/prose do not mechanically identify current steps, disappearance supplies no exit code, and restarting an attach process cannot recreate a lost parent-child exit receipt. Stock `SandboxProcessManager.get/list/wait` supplies useful live handles, but its process-local tracking does not solve durable external rediscovery.

There is **no currently supported standard development-launcher/attach command in this checkout**. Name the proposed small entry point honestly: `launchAuthorizedDevelopmentJob`, an in-process wrapper used by the independently authorized development host. Its execution primitive is Node’s public `child_process.spawn(executable, argv, {shell:false})`, following the existing controllers’ owned-child precedent while removing their hardcoded paths, provider setup and separate report files. It is not a new scheduling CLI or daemon.

The host checks an existing authorization receipt and exact approved command/model/limits; the wrapper cannot create that authority. Register observational card/run/worker identity in this same store without starting an Init/Build workflow. The existing runs reader must include those attached identities alongside workflow-backed runs. Keep role/model selection, admission counts, budget enforcement, phase advancement and handoff policy with their existing/future owners.

The host supplies an actual concrete planned action, such as “verify the journal’s restart readback,” before running it. Its action wrappers produce start/checkpoint/wait-begin/wait-end and exit facts around actual operations; a wait names its blocker. The coder does not write routine progress prose. An opaque coder process with no such instrumented action cannot honestly expose its inner current step: show that field as unknown. Do not infer semantic steps from tool chatter.

Separate capabilities mechanically: the authorized host alone can spawn its single approved job; `observeDevelopmentChild` receives an already-owned child and an append-only sink. The ingestion adapter and GET reader receive no spawn, Build, workflow run, start, resume or restart capability. Observation never retries a job, admits a session or advances work. Capture OS PID/start fingerprint and install exit listeners immediately; persist launch intent before spawning and distinguish that intent from an observed process start. A readiness/checkpoint handshake precedes claiming concrete activity. A crash between spawn and durable identity is an uncertain launch, not permission to spawn again.

**Scope recommendation:** this minimal launch instrumentation, observation adapter, identity/checkpoint interface and same-store readback belong **inside JUL-239**, as AC4 and its Proof already require. Deferring them would leave that criterion unprovable. A general command router, admission/resume engine, recovery scheduler or S03 limits/handoff work is separate runner work and unnecessary here. Recommend no new card and no change to the existing criteria.

**Prototype result:** six real local stand-ins used an explicit ready handshake, IPC checkpoints and actual timer waits; they inherited a minimal environment without provider credentials. Each retained PID plus Windows `Get-Process.StartTime.ToFileTimeUtc()`; the probe matched while alive and confirmed absence after exit. They showed working → waiting → working, then the distinct terminal/uncertain outcomes below. An unauthorized launch was rejected. One hundred journal reads caused no mutations or launches; the co-resident real Mastra workflow remained suspended throughout. This demonstrates the adapter seam with stand-ins, not a working provider integration.

**3. Uncertain states — choose an evidence projection, not timeout-driven success.**

```ts
// A: one mutable state machine driven by timeouts
function tick(state: Status, lastOutputAt: number, now: number): Status {
  /* not implemented */
}
// B: facts are retained; current confidence is recomputed — chosen
type Evidence = { lifecycle: LifecycleFacts; checkpoint: CheckpointFacts;
  persistence: PersistenceFacts; completion: CompletionFacts };
function statusAt(facts: Evidence, probe: ProcessProbe, now: number): Status {
  /* not implemented */
}
```

Reject A: no output can mean useful work, a real wait, a disconnected observer or a dead process. Timeouts cannot distinguish those cases or justify completion. A historical running value is not fresh liveness.

| Display | Facts required |
| --- | --- |
| working | Latest accepted concrete-step checkpoint says working; current exact worker identity/liveness and checkpoint freshness are established; no newer exit or unresolved persistence/order gap. An alive PID alone is insufficient. |
| waiting | Accepted explicit wait-begin names the step and blocker, with no matching wait-end/exit; current worker/wait evidence is revalidated. For an external durable wait, independently revalidate its blocker receipt after restart; an old wait message alone is insufficient. |
| stopped | Actual termination receipt corroborates cancellation/stop, or observed zero exit lacks complete success evidence. Show “outcome unverified” for the latter. A stop request alone does not prove termination. |
| failed | Exact-attempt nonzero exit without a corroborated intentional stop, a recorded launch error, or a mechanically verified required action failure. Missing heartbeat or database trouble alone never proves worker failure. |
| unknown | No exit receipt after process disappearance; PID fingerprint mismatch; unavailable probe; stale/missing checkpoint; missing producer ordinals; failed read/write; or an observer restart before revalidation. Show the last durable facts and their “as of” time, plus the uncertainty reason. |
| done | For a step, independently checkable completion evidence belongs to its exact current attempt and candidate/artifact identity. For a worker/run, also require the actual successful exit receipt, the complete checkpoint prefix through the final watermark, and valid completion evidence for every required current step. Neither prose, zero exit alone nor silence suffices. |

A dead worker can coexist with previously completed steps; keep step outcome and worker liveness separate. An exit does not complete every step, and a failed worker does not erase earlier completion evidence. Persisted terminal evidence remains historical fact; a failed refresh exposes uncertainty about the current view rather than rewriting that fact.

Retain plan capture/order, addition time/reason, every attempt’s original start/completion, wait-begin/end, worker OS start identity, observed launch/exit, producer occurrence time, first store receipt time and completion evidence. A restart adds a revalidation observation; it never substitutes “now” for the original start or guesses an exit time. A reopen gets a new attempt start and keeps the old times. Use sequence for ordering, not wall-clock sorting. Calculate wall elapsed from the current attempt’s persisted start; separately retain waits for active-time accounting. On uncertainty, label/freeze the last evidenced elapsed value rather than displaying confident ongoing work; a negative wall-clock delta is clamped and reported as a clock anomaly. Wall elapsed is not the subscription’s active-time budget.

Before commit failure: no acknowledgement and no asserted transition; retain the last durable projection with uncertainty and retry the same event. After commit/before acknowledgement: an identical replay returns the first receipt. If the supervisor survives a failed exit write, it retries the retained exit receipt. If it dies before persisting that receipt, a later absent-process probe cannot recover the missing exit code: remain unknown until authoritative exact-attempt evidence arrives. The observer must never restart work to repair an observation gap.

**Prototype result:** successful local exit 0 plus retained per-step evidence/final watermark → done; actual exit 7 → failed; actual exit 0 without proof → stopped; requested kill with observed termination → stopped. Deliberately withholding the actual exit-0 receipt left fresh-process readback unknown despite confirmed process absence. An exit-write failure showed unknown, then stopped after replaying the retained receipt, without inventing completion. Late post-exit checkpoints and wrong-fingerprint exits were rejected. Stale checkpoint, fingerprint mismatch, unavailable probe and failed-read inputs each projected unknown; those latter uncertainty inputs were injected, not claims of having induced real PID reuse or permission denial.

**Framework map supplement and implementation checks.** Paths below are under `ops/mastra-agents/reviewer/node_modules/`:

- `@mastra/core@1.75.0/dist/docs/references/docs-workflows-workflow-state.md`, “State vs step input/output” and “State persistence across suspend/resume”; `docs-workflows-snapshots.md:7-27,95-125`; `reference-workflows-workflow-state-reader.md:7-25`; `reference-storage-overview.md`, “Storage domains”: supported stock state/readback and its limits.
- `@mastra/libsql@1.25.1/dist/docs/references/integrations-databases-libsql.md:39-50,122-150`: file-backed storage and initialization. `dist/index.js:13547-13568` confirms current-snapshot replacement; `:13570-13583` returns the snapshot directly from the public domain reader.
- `@libsql/client@0.18.0/README.md`, “Quickstart”; bundled `@libsql/core@0.18.0/lib-esm/api.d.ts:97-130,161-195,249-334,343-366`: public client, atomic transactions, cleanup and write-mode locking. These authorize SQL against Julia-owned tables only.
- `@mastra/core@1.75.0/dist/docs/references/reference-workspace-process-manager.md:75-100,126-214`: stock handle observation; no durable external attachment guarantee.
- Node 24.14.1 official versioned [child-process documentation](https://nodejs.org/download/release/v24.14.1/docs/api/child_process.html) (fetched as its JSON documentation) for owned child spawn/exit, and the existing `build-phase.ts:205-269` OS-fingerprint precedent. Linear access follows its [official GraphQL documentation](https://linear.app/developers/graphql), reached through its llms index.

When implemented, real checks are needed on both sides: the launcher’s genuine action/exit receipts; adapter identity/order/conflict/retry handling; actual same-file transaction/crash/reopen readback; projection clocks/evidence/uncertainty; and the existing page’s refresh/restart rendering. Rerun changed-contract users named in the prior Confirm: Init/Build persistence/recovery, HTTP/page, initialization-driver-support, initialization/Build drivers, `jul-230`/`jul-231`, the complete Windows runner suite, all active reviewer TS tests and typecheck. Maintain `verify-machine` before independent Proof. The small prototype did not run those delivery gates, the actual page or a coder/provider; synthetic completion digests qualify rules, not Julia acceptance evidence.

**Experiment record, memory and cleanup.** Final successful script SHA-256: `e7b4f433e4bdfdaa690997df9ea1773a8796d74e42f95d1eee05c666ed08e393`; final JSON output SHA-256: `913ecbfc84c6b182d842c29549b0d652cfe834bc3800dbace5e30ddf04edb51b`. Final readback reported the co-resident Mastra snapshot still suspended and all eight history facts present from a new process. Early harness runs also corrected an erroneous snapshot return-shape assumption and an intermittent startup readiness race; final run included the explicit handshake.

Peak sampled aggregate process working set across the experiments: **302.5 MiB** (317,177,856 bytes). Final successful run: **300.6 MiB** (315,154,432 bytes; 284 samples), including its Node processes and registered PowerShell identity probes, sampled at nominal 50 ms plus collection overhead; excludes the sampler, Codex application and unrelated processes. Main-process final peak RSS was 188,324 KiB (183.9 MiB). Sampling can miss shorter peaks and aggregate working sets can count shared pages more than once.

Preflight found all five permanent prerequisite paths present; no credentials were read or resolved, and no model allowance was spent. Installed CLI accepts connections/models/init, and the vault wrapper accepts init/readIssue; neither has an observation-only development command. No provider job or paid model call ran.

The requested fast-forward pull fetched main but refused: local main is 35 commits ahead and two behind, with pre-existing dirty work. I incorrectly performed a local merge in a disposable detached worktree, resolving its two documentation conflicts there with the local versions. That exceeded “no merge”; it never changed main or GitHub. The disposable integration, script, scratch database, logs, process registry and temporary diagnostics are removed after recording these findings. Original main stays at `e75bbaaedafeb1e6ac36a993650ca353a1bee9d0`; fetched origin/main is `5f76c1fcf88f5e44011a514b06dd81390c3bc2ef`. Existing dirty work is preserved; only this new findings note remains. No push, tracker criteria/status edit, new card, or delivery occurred.

For Todd: The three design questions now have recommended answers backed by local experiments; JUL-239 stays in Triage.
For Todd: Keep the small development-job observation wrapper in JUL-239; no product decision or new card is needed for these answers.

