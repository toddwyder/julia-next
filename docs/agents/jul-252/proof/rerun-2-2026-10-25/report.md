# JUL-252 no-stop run and mid-build merge proof

## Updater red first

The red live event is the #339 merge. At `2026-10-25T12:20:06Z` the old updater advanced the checkout to `5728da2` and restarted `julia-machine-runner` while worker `1035904` was building. The worker died; the card had settled $6.66304033 of the $10 cap, so it was not a money stop.

The unit red is in `docs/agents/jul-252/proof/updater-2026-10-25/red.txt`: the old updater returned `updated: true`, advanced and restarted with a worker in the runner cgroup. The cgroup-path fix adds a second red: the first live `buildRunning` check returned false because systemd reports `/user.slice/...` relative to `/sys/fs/cgroup` and the updater read it as a direct path.

## Updater green

The defer is in #341; the cgroup-path fix is #343. Both merged with CI green.

- `07b75c0` (#343) merged while the JUL-252 no-stop build was running.
- The updater polls at `13:58:38Z` and `14:00:39Z` returned `{"updated":false,"deferred":true,"reason":"build running"}`.
- The runner MainPID stayed `1065596`, worker `1067200` stayed alive, the job stayed `running`, and the deployed checkout stayed `392b868`.
- The build ended at `14:00:44Z`. The poll at `14:02:53Z` returned `{"previous":"392b868...","current":"07b75c0...","updated":true}`. The runner restarted as `1082547`, the deployed head became `07b75c0`, and the deployment receipt was written.

The merge was applied after the build, not during it.

## JUL-252 no-stop run

Started at `13:45:10Z` through `https://ovh.tail91f394.ts.net/julia-control` with Claude Opus 5.5 orchestrating and DeepSeek V4.1 Flash coding, effort medium. Base commit `392b868`. Machine settings carry `"cardCeilings": { "JUL-252": null }`, so the $10 money stop is removed for this card only.

The card passed $10 with no stop: the stop table is empty and the card total is $11.165119684.

| Scope | Requests | Settled actual spend |
| --- | ---: | ---: |
| This run (13:45:10Z to 14:00:44Z) | 107 | $4.502079354 |
| Card total, including prior failed attempts | 186 | $11.165119684 |

### This run by model

| Model | Requests | Settled actual spend |
| --- | ---: | ---: |
| `anthropic/claude-opus-5-5` | 36 | $4.3995486 |
| `anthropic/claude-haiku-5-5` | 18 | $0.05248704 |
| `commandcode/deepseek/deepseek-v4.1-flash` | 53 | $0.050043714 |
| **Total** | **107** | **$4.502079354** |

### By checklist step

The ledger has no per-step timestamps. The phases use the watcher snapshots at `13:46:50Z`, `13:55:29Z` and `14:00:44Z`. The agent marked steps 1-7 early at 13:46:50; the implementation and panel review continued after that mark, so the phase labels are snapshot boundaries, not exact step boundaries.

| Checklist phase | Status | Opus | Haiku | DeepSeek | Total |
| --- | --- | ---: | ---: | ---: | ---: |
| Steps 1-3: `how`, `architect`, throughput checkpoint, plus the initial delegation mark | finished | $1.2581246 | $0 | $0 | $1.2581246 |
| Steps 4-5: delegate code-writing and verify | finished mark; implementation ran here | $0.8979304 | $0.02888223 | $0.04202709 | $0.96883972 |
| Step 6: small ordered commits | host owns | $0 | $0 | $0 | $0 |
| Step 7: panel review and the final retry | in progress at the timeout | $2.243494 | $0.02360481 | $0.008016624 | $2.275115034 |
| Step 8: Opening a PR | out of scope | $0 | $0 | $0 | $0 |

The three phase totals sum to $4.502079354.

The raw final checklist has steps 1-7 checked, step 8 unchecked and marked out of scope, and two task items still unchecked: "Real reviewer dispatch after every finished build and Linear state moves" and "End-to-end proof on a real card". The dashboard parser's `done:` heuristic reads "not done:" as finished, so its summary (15 finished, 1 skipped) hides those two. The raw file is the source for this report.

## Why the run ended

The run did not complete. At `14:00:44Z` the build phase hit the worker's 900,000 ms (15 minute) session timeout during the panel review. The build receipt is `status: timeout`; the job record is `failed` with `session not completed`. This was a time stop, not a money stop: the card had already spent past $10 with no stop.

The final timeout text says unit tests pass; the full runner suite could not load without `@mastra/code-sdk` and there was no `npm` in the sandbox; the agent was about to run the panel again on the fixed files.

The remaining blocker for a completed-build cost is the 900-second build-session bound. Raising it and running again (or resuming the thread) is the next step; this report does not claim a completed build.

## Evidence

- `dashboard.json`, `dashboard-jul-252-running.png`, `jul-252-build-card.png`: the start capture.
- `checklist-spend.jsonl`: spend by model at each checklist/snapshot boundary.
- `checklist-final.md`, `job-final.json`: the raw final checklist and job record.
- `start-and-capture.mjs`, `watch-build.mjs`: the browser and watcher drivers.
- `../updater-2026-10-25/red.txt`, `green.txt`: the updater and no-stop red/green.
- The deferred and applied poll lines are in `journalctl --user -u julia-machine-main`.
