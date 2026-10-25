# Build-limits decisions, 25 October 2026

Implementation of Todd's decisions made against the limits table in PR #345.

## Todo

- [x] Write failing tests for money recording, no cap and no priced block.
- [x] Write failing tests for the build and command inactivity windows, helper steps and model output maximum.
- [x] Write failing tests for removing the machine planning step and the pstack process rules.
- [x] Write failing tests for provider retry, pause and continuation, and failed-run restart.
- [x] Write failing tests for Start model memory and the removed provider, price and identity checks.
- [x] Implement the runner, control-page and legacy deletions.
- [x] Run the runner suite, the reviewer suite, typecheck, framework lint, the local and browser owners and the app build.
- [ ] Deploy and start JUL-252 with Claude Opus 5.5 and DeepSeek V4.1 Flash; report its result, raw checklist and spend by model.

## Decision log

| Time (UTC) | Decision | Why | Evidence |
| --- | --- | --- | --- |
| 2026-10-25T16:00Z | The ledger records settled spend and spend by model, with no cap, stop row, remaining balance or priced-accounting block. | Todd: money never stops a card and spend is recorded and reported per card. Removing the stop at the ledger is higher in the inverse pyramid than guarding each caller. | `ops/build-runner/ledger.mjs`; `test/ledger.test.mjs` |
| 2026-10-25T16:00Z | A failed job directory is archived under `<runId>.failed-<time>` and Start creates a new run. | Todd: pressing Start after a failed run starts fresh and keeps the old records. Renaming keeps the old job readable without a second run id. | `ops/build-runner/jobs.mjs`; `test/recovery.test.mjs` |
| 2026-10-25T16:00Z | The build watchdog aborts after 15 minutes with no session event; a command is killed after 15 minutes with no output. | Todd: replace the 15-minute total and the 30-second command timeout with the same no-activity rule. The SDK already accepts an abort signal, so the watchdog wraps it rather than adding a second runner. | `ops/build-runner/adapter.mjs`; `test/runner-tools.test.mjs` |
| 2026-10-25T16:00Z | A provider error is retried after a pause; a transient error settles zero and a connection failure records an unknown outcome. After the last attempt the job pauses and keeps its work. | Todd: retry provider errors; stop only if the provider stays down. Each attempt is its own ledger row so the spend remains auditable. | `ops/build-runner/transport.mjs`; `test/transport.test.mjs`; `ops/build-runner/worker-policy.mjs` |
| 2026-10-25T16:00Z | A runaway at the turn limit or provider-down sets `paused`, keeps the worktree and thread, writes a Linear note and exposes `POST /jobs/:runId/continue`. | Todd: pauses, not fails, so the work can continue. The control server also posts a pending note because the runner service has no Linear key. | `ops/build-runner/worker.mjs`, `linear-note.mjs`, `jobs.mjs`, `ops/mastra-agents/reviewer/src/mastra/paused-note.ts`; tests |
| 2026-10-25T16:00Z | The pstack host no longer requires a coder task, coder activity, a two-model panel, a machinery self-check or four evidence retries. It reports a missing checklist or an empty candidate as unproven with `next: 'Remediation'`. | Todd: remove the rules forcing pstack's process; the evidence review judges completeness. Removing the host gates deletes the retry loop rather than masking it. | `ops/build-runner/pstack-session.mjs`; `test/pstack-session.test.mjs` |
| 2026-10-25T16:00Z | The plan-only runner, plan workspace, plan retries and plan checks are deleted; pstack plans. | Todd: the machine's separate planning step is removed. The deleted files had no remaining caller. | `git diff`; `ops/build-runner/adapter.mjs`, `worker.mjs` |
| 2026-10-25T16:00Z | The request carries the model's published output maximum; there is no 8,192-token cap. Helpers run to 100 steps. | Todd: no output-length limit and helpers match the main build. | `ops/build-runner/catalogue.mjs`, `pstack-session.mjs`; tests |
| 2026-10-25T16:00Z | The local input estimate, token-count endpoint, media/service-tier/speed refusals and `networkAllow` are removed; an unpriced hosted tool call alone is refused. | Todd: remove the old money leftovers and the separate provider allowlist. Model routes still come only from the hydrated catalogue. | `ops/build-runner/transport.mjs`; `test/transport.test.mjs` |
| 2026-10-25T16:00Z | The legacy delivery budgets, output truncation, reviewer runtime bounds and adapter run defaults are deleted. | Todd: delete dead legacy code rather than leave it behind a disabled path. | `contracts.ts`, `cli.ts`, `delivery.ts`, `reviewer.mjs`, `contract.mjs`, deleted `review-budget.mjs` and `resource-budget.mjs`; tests |
| 2026-10-25T16:00Z | The Start form stores route, model and effort per role in `localStorage` and restores them on render. | Todd: the Start form remembers the last model choices. | `control-page.ts`; `test/jul-242.test.ts` |
