# JUL-239 interface research — 2026-10-17

Read-only source investigation for pre-plan Confirm. This note qualifies facts, not the proposed design. No coder/provider launch, server start, settings change or implementation was performed. Existing dirty files were preserved.

## Verdict

The existing initialization module provides durable workflow snapshots and validated current-run readback. Build provides real launch identity, process waiting and current-result recovery. Neither provides a durable concrete-step journal, observation-event deduplication, added-step/reopened-step history, or an attach-only interface for ordinary development coder jobs. Those remain design unknowns. Source inspection cannot qualify their restart/concurrency rules.

The historical development controllers at `C:/Dev/jul233-supervision/worker-controller.mjs` and `resume-worker-controller.mjs` really spawn Codex and await its exit. They are useful source precedents, but neither currently offers the required shared persisted observation interface or a mechanical current-step checkpoint. Their presence does not establish current launch authorization.

## Installed versions and documentation opened

All package paths below are beneath `ops/mastra-agents/reviewer/`. Exact installed versions, rather than semver ranges, come from each installed `package.json:2-3`:

| Package | Installed version |
| --- | --- |
| `@mastra/core` | `1.75.0` |
| `@mastra/libsql` | `1.25.1` |
| `@libsql/client` | `0.18.0` |
| `zod` | `4.6.5` |

Version-matched bundled pages opened before inspecting implementations:

- `@mastra/core@1.75.0 node_modules/@mastra/core/dist/docs/references/docs-workflows-snapshots.md`
- `@mastra/core@1.75.0 node_modules/@mastra/core/dist/docs/references/reference-workflows-workflow-state-reader.md`
- `@mastra/core@1.75.0 node_modules/@mastra/core/dist/docs/references/reference-workflows-run-methods-restart.md`
- `@mastra/core@1.75.0 node_modules/@mastra/core/dist/docs/references/reference-workflows-run.md`
- `@mastra/core@1.75.0 node_modules/@mastra/core/dist/docs/references/reference-workflows-workflow-methods-create-run.md`
- `@mastra/core@1.75.0 node_modules/@mastra/core/dist/docs/references/reference-workspace-process-manager.md`
- `@mastra/core@1.75.0 node_modules/@mastra/core/dist/docs/references/reference-project-structure.md`
- `@mastra/libsql@1.25.1 node_modules/@mastra/libsql/dist/docs/references/integrations-databases-libsql.md`

No external documentation was needed for these findings. No Zod or libSQL client configuration is proposed here.

## Framework job map

| Job | Stock feature and exact citation | Existing use / limitation |
| --- | --- | --- |
| Persist suspended execution | Mastra serializable snapshots, automatically persisted on suspend: `@mastra/core@1.75.0 .../docs-workflows-snapshots.md:7-27,95-113` | `src/mastra/initialization.ts:70-101,123-125` creates two steps and file-backed `LibSQLStore`. |
| File-backed run storage | `LibSQLStore` with `file:` URL, automatic initialization through Mastra: `@mastra/libsql@1.25.1 .../integrations-databases-libsql.md:39-50,106-108,122-150` | Current runtime at `initialization.ts:123-125,143-144`; production default `control-server.ts:54-58` is `~/.julia/initialization.db`. |
| Read suspended steps/payload/output | Public `getWorkflowRunById` and `createWorkflowStateReader`: `@mastra/core@1.75.0 .../reference-workflows-workflow-state-reader.md:7-25,39-65,87-107` | Current `initialization.ts:148-165` validates saved snapshots/results and rejects mismatched run identity or unexpected state. |
| Stable workflow run identity | Optional custom `runId`: `@mastra/core@1.75.0 .../reference-workflows-workflow-methods-create-run.md:7-25` | SHA-256-derived Julia run identity is custom, `initialization.ts:104-106,245-263`; it is not step/event identity. |
| Resume or restart workflow execution | Run `resume` / `restart`: `@mastra/core@1.75.0 .../reference-workflows-run.md:25-39`; restart continues the last active step: `.../reference-workflows-run-methods-restart.md:7,41-43` | `initialization.ts:168-234` resumes/restarts Build and can dispatch work. It must not be substituted for observation-only readback. |
| Monitor an already-owned process | Stock sandbox process manager provides `list/get`, handle exit state and `wait`: `@mastra/core@1.75.0 .../reference-workspace-process-manager.md:75-100,126-146,156-214` | Stock primitive exists but is not wired into this external-development path. Installed implementation keeps `_tracked` in a Map (`dist/workspace-Dt067lop.js:2952-2963,3231-3245`); no durable external attachment or post-restart rediscovery follows from these methods. |
| Read-only page projection | Custom Node HTTP adapter with shared Julia schemas: `src/mastra/control-page.ts:91-130`; runtime wiring `control-server.ts:59-75` | No stock Mastra page claimed. `/api/build` is a separate mutating handoff (`control-page.ts:135-136`). |
| Concrete step identity/order, elapsed projection, transitions, additions/reopening, duplicate receipts, uncertainty | Custom/new; no current implementation cited | Must be qualified as the existing card requires. Stock snapshots and process handles alone do not supply these rules. |

Paths abbreviated with `.../` in package citations mean `node_modules/@mastra/{core,libsql}/dist/docs/references/` in the named package. Julia source paths are beneath `ops/mastra-agents/reviewer/`.

Starter layout: stock recommends `src/mastra`, workflow files under `workflows/`, and central `src/mastra/index.ts`, while explicitly allowing adapted organization (`@mastra/core@1.75.0 .../reference-project-structure.md:7-9,15-29,36-45,56-61`). Julia's initialization workflow currently resides in `initialization.ts` and the standalone page uses `control-server.ts`; this is an existing layout adaptation, not evidence of a stock progress-view feature.

## Storage, duplicate safety and restart facts

1. Stock snapshots are current state, not an append-only journal. Installed `@mastra/libsql@1.25.1 node_modules/@mastra/libsql/dist/index.js:13547-13568` executes one `INSERT ... ON CONFLICT(workflow_name,run_id) DO UPDATE`, replacing `snapshot` and `updatedAt`. Readback loads that record (`:13570-13602`). It has no observation ID, expected-version compare-and-swap, or event sequence argument. A single SQL statement is not an atomic read-modify-write journal guarantee.
2. Julia start duplicate checks are custom deterministic identity plus process-local promise Maps (`initialization.ts:104-106,145-146,237-263`). The Maps do not survive restart. Persisted readback lets an identical already-saved initialization be returned after restart. This is not a demonstrated multi-writer step-history transaction.
3. Build's current evidence is one `pstack-evidence.json` (`build-phase.ts:44-45,52-57`). `persist` validates it, writes an exclusive temporary file, syncs it, and renames it into place (`:87-104`). It atomically replaces a current projection; it does not append history or deduplicate event receipts. `readCurrentBuildState` prefers terminal evidence (`:79-84`) and recovery avoids replacing existing terminal evidence (`:107-112`); `persist` itself does not enforce an all-writer monotonic transition rule.
4. Build has custom cross-process duplicate launch protection using a Git ref compare-and-swap plus exact owner process identity (`build-phase.ts:405-454`). It is a launch lock, not a history/event transaction.
5. Windows process identity uses PID plus `Get-Process.StartTime.ToFileTimeUtc()` (`build-phase.ts:205-213`). Waiting verifies the fingerprint, observes current evidence and directory changes, and uses `Wait-Process` (`:230-269`). Probe failures throw rather than proving exit. A vanished launch is recorded as `build-interrupted` (`:484-485`), which is existing Build behavior and does not automatically settle the new card's unknown-state model.
6. Workflow listing is current-run listing (`initialization.ts:266-276`), not transition history. Installed list storage implementation returns selected snapshot records (`@mastra/libsql@1.25.1 dist/index.js:13631-13682`). Without pagination its `total` falls back to `runs.length`; do not infer an independent SQL COUNT merely from the `total` field.
7. Activity recorder events are process-local (`initialization-observability.ts:12-33`). They count dispatch/inference/Linear calls, not durable concrete-step transitions.

Preserved Review precedent, not current checkout implementation: `C:/Dev/jul233-integration/ops/mastra-agents/reviewer/src/mastra/review-store.ts:14-18,24-35,53-81` uses custom tables in the same libSQL file, primary keys and `ON CONFLICT DO NOTHING` to claim one Review/result per run. This demonstrates a previous custom same-file extension, not a step journal, event ordering protocol, or qualified general transaction design. It is outside this checkout and cannot be named as an existing available Julia module here.

## Development launcher search

Search concepts included lifecycle, observed exit, process identity, launch/current/wait, history, transitions and append across `scripts/`, reviewer source and `docs/agents/`; the named historical controllers were then inspected without running them.

- Existing production Build route: `control-page.ts:135-136` → `control-server.ts:70-73` → `initialization.ts:212-243` → `build-phase.ts:328-402,405-461`. This creates worktrees and dispatches Builder, so readback cannot use it merely to attach an ordinary development session.
- Historical actual Codex launcher: both `C:/Dev/jul233-supervision/worker-controller.mjs:42-51` and `resume-worker-controller.mjs:42-51` spawn Codex, save PID/start/card/attempt, collect stdout/stderr, await the child's actual `exit`, and save a report. The resumed-named script also launches a fresh `exec`; its name alone is not a resume contract.
- Those historical controllers save files beneath a hardcoded `C:/Dev/jul233-supervision` folder (`:5-10`), not the current shared run store; create provider proxy/config and apply historical inline limits (`:11-40`); and have no current-step/waiting checkpoint or shared Zod observation schema. PID plus launcher wall-clock start (`:44-45`) is not the current Build OS-start fingerprint. The final report is saved after a subsequent provider usage request (`:48-51`), so exit followed by account-read failure can leave no final report. No portable reconstruction of current concrete work step follows from these logs.
- `ops/service-dropbox/run-agy-seat.mjs:12-24` constructs arguments and `:27-62` parses output/model logs. It does not spawn a process or provide a current/wait/exit ownership interface.
- `scripts/verify-julia.mjs:156-214,315-319` launches/diagnoses/cleans the Julia Next.js proof server. It is not a development coder launcher.

Fact verdict: no current, approved, general development launcher plus observation-only shared-store interface was established by these sources. The card's named-launcher blank cannot honestly be filled with the command-spec helper or Build delivery route. A launcher can supply actual start/exit facts; mechanically reported step/wait state needs a real checkpoint producer, with stale/missing observations handled explicitly. Model prose/tool activity is insufficient to infer the semantic current step or completed acceptance evidence.

## Existing schema users and checks to rerun

No schema was changed in this investigation. If the proposed extension changes the current shared contracts, trace these users:

| Contract | Offering / using modules | Existing checks |
| --- | --- | --- |
| `RunSnapshotSchema`, `ReadyForBuildSchema`, `StartBuildSchema` | `initialization.ts:70-101,148-165,177-201,225-226`; `build-phase.ts:10-18,315-319`; `control-page.ts:135-136` | `test/jul-230.test.ts:204` durable initialization/restart; `test/jul-231.test.ts:63,210,265,314,570,641,679,732,785,849` snapshot/launch/recovery/limit checks. |
| `BuildResultSchema`, `RunStateSchema`, `InitializationResultSchema` | Definition `contracts.ts:223-280`; Build persistence/recovery `build-phase.ts:52-112`; runtime `initialization.ts:148-165,212-243`; HTTP adapter `control-page.ts:133-136`; browser rendering `control-page.ts:78-86` | `test/jul-231.test.ts:99,210,570,679,732,785,849,913`; `test/jul-230.test.ts:204,304`. |
| `InitializationRunsStateSchema`, `InitializationBoundaryStateSchema` | Definition `contracts.ts:281-291`; runtime list `initialization.ts:266-273`; HTTP projection `control-page.ts:126-130`; `.agents/skills/verify-machine/initialization-driver-support.mjs:5,53`; page read/render `control-page.ts:76-87` | `test/jul-230.test.ts:204,240,282,304`; `test/jul-231.test.ts:913`; real `.agents/skills/verify-machine/drive-initialization.mjs` and `drive-build.mjs`. |

Provider-side rules currently check saved identity, known workflow state, parsed output, Build launch ownership and exact Builder limits. User-side HTTP validation checks the returned shared schema; browser view reads that projection. New history/order/elapsed/dedupe/restart/uncertainty rules have no current producer/user checks because their interface is new. The qualification must name both sides and their real checks, including the development-launcher adapter and existing page/readback users, rather than implying the current tests prove new behavior.

`.agents/skills/verify-machine/SKILL.md:57-76` maps current features; its evidence section requires real commands/readback and exact candidate identity. Current drives cover initialization and Build, not JUL-239 step history or attached development coding. Extending the feature map through `maintain-verification-skill` remains required when implementing that existing Proof obligation. No tests or live drives were run here: inspection is fact evidence, not red/green behavior proof or independent review.

## Coordinator self-check observations

The coordinating agent reports these observations from this same pre-plan invocation; they are self-checks, not independent review or JUL-239 behavior proof:

- `verify-machine doctor` exited 0 for candidate `e75bbaaedafeb1e6ac36a993650ca353a1bee9d0`, dirty-tree digest `sha256:1040692fe0f9822847210ee481ee722d557b94d4c72fbc9017e2fa73b93f01c0`, with all five permanent parts healthy.
- A hypothetical `ReadyCardSchema` parse of the live description initially failed with the five legacy-section errors. Normalizing the existing heading to `## Agent Brief` and the existing field label to `**Acceptance criteria:**` made that parse succeed. `state: 'Ready'` was supplied only in memory for this check; the Linear card remains Triage. This verifies admission formatting only.
- No source changes, test-suite execution, coder/provider launch or live page drive occurred. These checks do not qualify the new persistent-history or observation-adapter design.
