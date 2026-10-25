# JUL-252 rerun through the Start page, 25 October 2026

Started at `https://ovh.tail91f394.ts.net/julia-control` with Claude Opus 5.5 (Anthropic, Claude subscription) orchestrating and DeepSeek V4.1 Flash (CommandCode) coding, effort medium both. Run id `jul-252-04db241d9dbeda4fc7d58701cd7b66d2`.

The card cap now counts settled actual usage at published API prices and stops the card once spend exceeds $10. A request's recorded worst-case maximum no longer refuses dispatch. `diagnosing-bugs` is retired; this work followed poteto-mode's Bug fix playbook.

## Interruption

The build did not finish. At `2026-10-25T12:20:06Z` the machine updater advanced `/home/ubuntu/julia-machine-main` to `5728da2`, the merge of PR #339 (`docs/julia-cards-first`), and restarted `julia-machine-runner.service`. That killed worker PID `1035904` while it was running. This was not a money stop: the card had settled **$6.66304033** against the $10 cap and was not stopped.

The $10 stop was not removed for the running worker. The cap is a module constant in the worker process; removing it in place would have needed a live process patch, and the external deploy killed the worker before that. The build was left as it was and was not restarted. It cannot resume: the build thread `de4db431-4a5c-4e6d-a331-71be0069f6ac` persisted zero messages and the worktree has zero changes, so a new Start would be a new build.

The job record was stale at `running` because the killed worker never ran its final write. It is corrected to `failed` with the interruption reason so the dashboard does not show a dead worker as live. The checklist, design and decision files are preserved under this folder.

## Screenshot

`dashboard-jul-252-latest.png` and `jul-252-build-card-latest.png` are the dashboard and build-card crops captured at `2026-10-25T12:16:27Z` with the heading `JUL-252 · running` and the checklist at **7 finished, 1 skipped, 6 pending**. The earlier capture at 12:11:21Z (`dashboard-jul-252-running.png`) shows the first tick at 1 finished, 1 skipped, 11 pending. Both have an empty browser console error list.

The finished items include `how` over the affected subsystem, the architect design panel, and the four throughput-checkpoint items. The skipped item is Opening a PR, which the host owns.

## Spend at interruption

Snapshot at `2026-10-25T12:20:06Z`. Settled actual spend excludes one reserved request whose maximum was $0.0780612.

| Run | Requests | Settled actual spend |
| --- | ---: | ---: |
| First failed run (plan only, reservation refusal) | 1 | $0.140036 |
| Second failed run (plan plus six build turns, reservation stop) | 7 | $1.083816 |
| Current run (actual-spend policy, interrupted) | 79 | $5.43918833 |
| **Card total** | **87** | **$6.66304033** |

Remaining under the $10 cap from settled spend: **$3.33695967**. The card is not stopped. The interrupted request holds $0.0780612 at its recorded maximum; that is not settled spend.

### Current run by model

| Model | Requests | Settled actual spend |
| --- | ---: | ---: |
| `anthropic/claude-opus-5-5` | 40 | $5.405676 |
| `anthropic/claude-haiku-5-5` | 3 | $0.01113416 |
| `commandcode/deepseek/deepseek-v4.1-flash` | 36 | $0.02237817 |

The adapter opens one ledger role, `orchestrator`, for the whole session; the model and the pstack records identify the task kind. Opus carries the main session, `how`, architecture synthesis, the throughput checkpoint and orchestration. Haiku and DeepSeek carry the architect design candidates. DeepSeek carries the delegated coding and swarm work; the reserved $0.0780612 is its interrupted request.

### By checklist step

The ledger has no per-step timestamps. The step figures use the checklist status snapshots at 12:11:21Z (1 finished), 12:17:27Z (7 finished), and the interruption at 12:20:06Z. They are phase estimates, not an exact per-request attribution.

| Checklist step | Status at interruption | Model(s) | Settled spend for the step |
| --- | --- | --- | ---: |
| 1. `how` over the affected subsystem | finished | Opus | Up to $2.4842552 (the 12:11 snapshot also contains the start of the architect step) |
| 2. `architect` design exploration | finished | Opus synthesis; Haiku and DeepSeek candidates | $2.37614328 across the 12:11 to 12:17 snapshots, covering the rest of steps 2 and 3 |
| 3. Throughput checkpoint, four items | finished | Opus | Included in the step 2 figure |
| 4. Delegate code-writing to the coder | in progress | DeepSeek coder; Opus orchestration | $0.57878985 settled from 12:17 to 12:20, plus the $0.0780612 held request |
| 5. Verify on the matching surface | pending | none | $0 |
| 6. Rebase into small ordered commits | pending | none | $0 |
| 7. `interrogate` if contested | pending | none | $0 |
| 8. Opening a PR | skipped, host owns it | none | $0 |
| Panel review of changed files | pending | Haiku and DeepSeek | $0 |
| GLOSSARY, path-forward, ADR 0024 | pending | none | $0 |

The three phase rows sum to the current run's $5.43918833: $2.4842552 plus $2.37614328 plus $0.57878985.

## Evidence files

- `dashboard-jul-252-latest.png`, `jul-252-build-card-latest.png`: the 7-finished running state at 12:16.
- `dashboard-jul-252-running.png`, `jul-252-build-card.png`: the first-tick state at 12:11.
- `dashboard.json`, `dashboard-latest.json`: card, model labels, run id, checklist items and console errors.
- `spend.json`, `spend.mjs`: the interrupted spend split.
- `job-interrupted.json`: the corrected job record with the interruption reason.
- `checklist-interrupted.md`, `design.md`, `decisions.tsv`: the preserved pstack artifacts.
- `start-and-capture.mjs`, `capture-dashboard.mjs`: the browser drivers.
