# JUL-252 rerun through the Start page, 25 October 2026

Started at `https://ovh.tail91f394.ts.net/julia-control` with Claude Opus 5.5 (Anthropic, Claude subscription) orchestrating and DeepSeek V4.1 Flash (CommandCode) coding, effort medium both. Run id `jul-252-04db241d9dbeda4fc7d58701cd7b66d2`.

The card cap now counts settled actual usage at published API prices and stops the card once spend exceeds $10. A request's recorded worst-case maximum no longer refuses dispatch. `diagnosing-bugs` is retired; this work followed poteto-mode's Bug fix playbook.

## Screenshot

`dashboard-jul-252-latest.png` and `jul-252-build-card-latest.png` are the dashboard and build-card crops captured at `2026-10-25T12:16:27Z` with the heading `JUL-252 · running` and the checklist at **7 finished, 1 skipped, 6 pending**. The earlier capture at 12:11:21Z (`dashboard-jul-252-running.png`) shows the first tick at 1 finished, 1 skipped, 11 pending. Both have an empty browser console error list.

The finished items include `how` over the affected subsystem, the architect design panel, and the four throughput-checkpoint items. The skipped item is Opening a PR, which the host owns.

## Spend

Snapshot at `2026-10-25T12:19:28Z`, while the run was still in flight.

| Run | Requests | Settled actual spend |
| --- | ---: | ---: |
| First failed run (plan only, reservation refusal) | 1 | $0.140036 |
| Second failed run (plan plus six build turns, reservation stop) | 7 | $1.083816 |
| Current run (actual-spend policy) | 73 | $5.436761228 |
| **Card total** | **81** | **$6.660613228** |

Remaining under the $10 cap: **$3.339386772**. The card is not stopped.

### Current run by model

| Model | Requests | Settled actual spend |
| --- | ---: | ---: |
| `anthropic/claude-opus-5-5` | 40 | $5.405676 |
| `anthropic/claude-haiku-5-5` | 3 | $0.01113416 |
| `commandcode/deepseek/deepseek-v4.1-flash` | 30 | $0.019951068 |

### By kind of task

The adapter opens one ledger role, `orchestrator`, for the whole session; the model and the pstack events identify the task kind.

| Kind of task | Model | Spend in the current run |
| --- | --- | ---: |
| Main session, `how`, architecture synthesis, throughput checkpoint and orchestration | Claude Opus 5.5 | $5.405676 |
| Architect design panel candidate | Claude Haiku 5.5 and DeepSeek V4.1 Flash | Haiku $0.01113416; DeepSeek's architecture requests sit inside its $0.019951068 total |
| Delegated coding and swarm work | DeepSeek V4.1 Flash | $0.019951068 total, including its small architecture candidate; the final events separate the two |

The ledger records the model and the adapter role, not the subagent task. The DeepSeek total is therefore one figure for its architecture candidate and its delegated coding; the coder is the dominant part by request count (30 requests at capture).

`spend.json` holds the machine-readable snapshot. The live ledger is the shared `cards.sqlite` under `~/.local/state/julia-machine/`.

## Evidence files

- `dashboard-jul-252-latest.png`, `jul-252-build-card-latest.png`: the 7-finished running state.
- `dashboard-jul-252-running.png`, `jul-252-build-card.png`: the first-tick state.
- `dashboard.json`, `dashboard-latest.json`: card, model labels, run id, checklist items and console errors.
- `spend.json`: the spend split.
- `start-and-capture.mjs`, `capture-dashboard.mjs`: the browser drivers.

The run continues after this snapshot; the dashboard and ledger are the live source.
