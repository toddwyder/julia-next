# Start reviewer and builder access, 25 October 2026

Todd's decisions, implemented with the Feature playbook.

## Todo

- [x] Add failing tests for the Start Reviewer box, same-company refusal and remembered choice.
- [x] Add failing tests for builder package-registry network, filtered vault keys and missing-key continuation.
- [x] Implement the Reviewer role in contracts, Start validation, the control page and the runner snapshot.
- [x] Remove the seccomp network block, keep the filesystem fence and allow the registry.
- [x] Pass only `builderEnvKeys` to builder commands and refuse machine-only keys.
- [x] Run the runner suite, reviewer suite, typecheck, framework lint, local owners and the app build.

## Throughput checkpoint

- **Blocking first steps.** Fix the role contracts and the command environment policy before touching the page or the adapter.
- **Independent workstreams.** The Start surface and the command boundary are separate files and can be reviewed separately; both feed the same snapshot.
- **Shared mutable state.** The job snapshot is written only by the Start workflow and read by the runner; no second writer is added.
- **Smallest safe decomposition.** Two code-coupled slices (Start selection, builder access) in one PR because the reviewer selection is only useful once the runner receives it.

## Decision log

| Time (UTC) | Decision | Why | Evidence |
| --- | --- | --- | --- |
| 2026-10-25T18:00Z | The Reviewer is an optional field in the stored role schema but required by a new Start, and its company must differ from the orchestrator and coder. | Old saved jobs stay readable; every new Start carries a real reviewer. The server validates; the page disables Start and explains why. | `contracts.ts`, `initialization.ts`, `control-page.ts`; `test/jul-242.test.ts` |
| 2026-10-25T18:00Z | The builder sandbox keeps the Landlock filesystem fence and drops the seccomp network block. | npm needs outbound network; the file fence is the boundary that matters. The test proves outside reads still fail and a TCP connection succeeds. | `command-boundary.py`, `test/command-boundary.test.mjs` |
| 2026-10-25T18:00Z | Builder commands receive only `builderEnvKeys` (CommandCode by default); machine-only keys are filtered in both the adapter and the launcher. | CommandCode and read-only service keys are useful to a builder; Linear, Sentry write tokens and Axiom write tokens move cards or change production and stay with the machine. | `builder-env.mjs`, `adapter.mjs`, `command-boundary.py`; tests |
| 2026-10-25T18:00Z | A missing builder key is absent, not fatal. | Missing access fails that one command; the session and later commands continue. | `test/command-boundary.test.mjs`, `test/adapter-driver.mjs` |
| 2026-10-25T18:00Z | The Start choice is carried in the snapshot and resolved by the runner session as `reviewerModel`. | JUL-252's evidence review must use the reviewer picked on Start, not a separate settings list. | `pstack-session.mjs`, `worker.mjs`; `test/pstack-session.test.mjs` |
