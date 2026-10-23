# JUL-231 current Init -> saved state -> Start path

## Init (control page)

1. `control-server.ts` discovers the page state in `discoverControlPageState()` (`ops/mastra-agents/reviewer/src/mastra/control-server.ts:26-42`): Ready Linear cards plus model offers.
2. The browser form in `control-page.ts` submits `card` + `roles` to `POST /julia-control/api/start` (`ops/mastra-agents/reviewer/src/mastra/control-page.ts:86-87,156-158`).
3. `control-server.ts` re-discovers state and calls `runtime.start(input, latestState)` (`ops/mastra-agents/reviewer/src/mastra/control-server.ts:84-88`).
4. `initialization.ts` `start()` validates the request (`validateInitializationRequest`, `ops/mastra-agents/reviewer/src/mastra/initialization.ts:53-63`), computes a deterministic `runId` (`runIdFor`, `ops/mastra-agents/reviewer/src/mastra/initialization.ts:87-90`), and returns an existing suspended run if present (`read`, `ops/mastra-agents/reviewer/src/mastra/initialization.ts:110-119`).
5. Otherwise it creates a Mastra run and streams `InitializationInputSchema` into `initializationWorkflow` (`ops/mastra-agents/reviewer/src/mastra/initialization.ts:129-139`).
6. The workflow's only step, `suspendReadyForBuild` (`ops/mastra-agents/reviewer/src/mastra/initialization.ts:66-85`), builds `RunSnapshotSchema` with `state: 'ready-for-build'` and suspends with `ReadyForBuildSchema`.

## Saved state

- Persisted in the LibSQL store created by `createInitializationRuntime()` (`ops/mastra-agents/reviewer/src/mastra/initialization.ts:92-105`).
- `read()` recovers the suspended step payload and returns `InitializationResultSchema`: `{ runId, state: 'ready-for-build', snapshot, resumed }` (`ops/mastra-agents/reviewer/src/mastra/initialization.ts:110-119`).
- `RunSnapshotSchema` is `{ runId, card: ReadyCardSchema, roles: InitializationRolesSchema, state: 'ready-for-build', initializedAt }` (`ops/mastra-agents/reviewer/src/mastra/contracts.ts:126-132`).
- `list()` enumerates all runs and validates `InitializationRunsStateSchema` (`ops/mastra-agents/reviewer/src/mastra/initialization.ts:144-152`); the UI reads it through `GET /julia-control/api/runs` (`ops/mastra-agents/reviewer/src/mastra/control-page.ts:147-152`).

## Start

- In the current control page, "Start" only reaches `ready-for-build`: the form replaces itself with `Ready for build` plus the returned JSON (`ops/mastra-agents/reviewer/src/mastra/control-page.ts:87`). It does not launch any build, delivery, or runner process.
- `control-server.ts` logs `initialization-ready-for-build` and returns the run; no dispatch follows (`ops/mastra-agents/reviewer/src/mastra/control-server.ts:84-89`).

## Missing build integration

- The saved `ready-for-build` snapshot is never converted into a build execution: `runtime` registers `deliveryWorkflow` (`ops/mastra-agents/reviewer/src/mastra/initialization.ts:97,103`), but `initializationWorkflow` stops at `suspendReadyForBuild` and Start never calls it.
- There is no bridge from `RunSnapshot` (card + four role selections) to `ops/build-runner/adapter.mjs`: `openRunner({ card, settingsPath, cwd, stateDir, role })` expects a settings file and one role, and nothing in the control server constructs or invokes it (`ops/build-runner/adapter.mjs:10-47`, `ops/build-runner/README.md:9-20`).
- The contracts only model `ready-for-build`; there is no `ready-for-review` state or saved build result schema in `contracts.ts` (`ops/mastra-agents/reviewer/src/mastra/contracts.ts:126-139`).
- The page displays the initialization JSON, not a saved build result, and has no runner lifecycle management; `runControlPageServer()` disconnects active agent records on restart (`ops/mastra-agents/reviewer/src/mastra/control-server.ts:71`).
