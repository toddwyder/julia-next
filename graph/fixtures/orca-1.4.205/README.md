# Orca 1.4.205 recorded responses (JUL-109)

Real output from Orca **1.4.205**, recorded on the OVH server on 2026-09-20 (UTC) so the controller's
stand-ins can be built from what Orca actually answers, not from what someone remembers it answering.
Nothing here is invented or hand-edited. Every file is the JSON (or text) exactly as the command printed
it. Two files (`worktree-ps.*`) are one worktree cut out of a longer `worktree ps` answer, and the
`cost.*` and `seat-probe.*` files are small extracts, each saying how it was made inside the file itself.

**Where it ran.** Coordinator calls: `sudo -u orchestrator-svc orca ... --environment orchestrator-local`.
Worker-side calls (terminals, worktrees): the same account with `--environment ovh-local`, which is the
runner's daemon. Workers ran as `runner`. Every worker was started the way the coordinator starts one:
`orca orchestration worker-start --on ovh-local --worktree new-top-level --repo path:/home/runner/julia-next`.

**Pinned version.** `orca-ide` 1.4.205, held with `apt-mark hold`. Do not re-record against another
version without an admin session recorded on JUL-109.

## Where each file came from

Times are UTC. "probe N" is a real worker in its own brand-new worktree, all removed afterwards.

| File | Command | Source run |
|---|---|---|
| `worker-show.settled-succeeded.json` | `orchestration worker-show --dispatch ctx_866d6d92d021 --json` | probe 3, healthy Claude builder, 20:24 |
| `worker-show.failed-agent-readiness.json` | `worker-show --dispatch ctx_b93c24cc4e31 --json` | probe 2, account deliberately stripped to a clean state; worker stuck at the folder-trust screen |
| `worker-show.in-flight-input-accepted.json` | `worker-show --dispatch ctx_506b46e14bb4 --json` | first Pi adoption attempt, 20:37; a real in-flight payload, but its task text was typed while Pi was still starting and was lost (see the findings record) |
| `worker-show.retry-of.json` | `worker-show --dispatch ctx_2e1d6576265b --json` | probe 5, started with `--retry-of ctx_b93c24cc4e31`; `result.dispatch.retryOfDispatchId` |
| `worker-show.pi-adopted-succeeded.json` | `worker-show --dispatch ctx_c24c6c49df9a --json` | interactive DeepSeek Pi worker adopted with `--terminal`, reported `worker_done`, 20:39 |
| `worker-list.one-settled-worker.json` | `orchestration worker-list --run run_1bf570ce5660 --json` | after probe 1 only, 20:20 |
| `worker-list.mixed-states.json` | same | end of the session: 12 workers, succeeded, failed and abandoned |
| `worker-start.claude-model-effort.json` | `worker-start --agent claude --model claude-sonnet-5 --effort low ...` | probe 1 |
| `worker-start.codex-model-effort.json` | `worker-start --agent codex --model gpt-6-astra --effort low ...` | codex probe 2, 20:42 |
| `worker-start.failed-agent-readiness.json` | `worker-start --agent claude ...` | probe 2; the start itself fails with `failedStage: agent_readiness`, `lastError: timeout` |
| `worker-start.adopt-terminal-pi.json` | `worker-start --terminal <handle> --worktree path:... --spec ...` | Pi adoption, third attempt |
| `mailbox.check-all.status-heartbeat-escalation-done.json` | `orchestration check --terminal <coordinator> --run <run> --all --json` | probe 4 (status x2, heartbeat, escalation, `worker_done`) plus probes 1 and 3 |
| `mailbox.check-wait-batch.jsonl` | `orchestration check --wait --types status,heartbeat,escalation,worker_done --timeout-ms 90000 --json`, one line per batch | the waiter run during probe 4; note the `deliveryId` to acknowledge |
| `check-wait.empty-inbox-timeout.json` / `.stderr.txt` | `check --wait --types merge_ready --timeout-ms 20000 --json` with nothing to deliver | 20.5 s, exit 0, `timedOut: true`; one keepalive line at 15 s on stderr |
| `run-create.ok.json`, `run-create.replayed.json` | `orchestration run-create --objective ... --from <terminal>`, then the same with `--retry-request <id from the first answer>` | `replayed: true`, no second run |
| `run-create.no-sender-terminal.error.json` | `run-create` with no `--from`, outside an Orca terminal | error `no_active_sender_terminal` |
| `run-use.takeover.json`, `check.consumer-fenced.error.json` | a second terminal takes the run; the first terminal then calls `check` | error `consumer_fenced`; `consumer_generation` goes 1, 2, 3 |
| `request-show.completed.json`, `request-show.terminal-send.json`, `request-show.absent.json` | `orchestration request-show --request <id> --json` | `completed` with a plain-English `interpretation`; `absent` for an id Orca never issued |
| `terminal-send.wait-submit.turn-started.json` | `terminal send --text ... --enter --wait-submit 20 --json` into an idle, healthy Claude builder | stages `input_accepted`, `turn_started` |
| `terminal-send.wait-submit.no-turn-started.json` | same, into a real Claude sitting at the folder-trust screen | stages `input_accepted` only, plus a warning |
| `terminal-send.replayed.json` | the same send again with `--retry-request <id>` | `replayed: true`, nothing sent again |
| `terminal-send.terminal-handle-stale.error.json` | send into a terminal that an Orca restart had killed | error `terminal_handle_stale`, which itself names the request id to replay with |
| `terminal-wait.tui-idle-on-plain-terminal.json` | `terminal wait --for tui-idle --timeout-ms 8000` on a plain terminal running `sleep 90` | `satisfied: true` after 2.5 s while the command was still running |
| `terminal-wait.exit-timeout.json` | `terminal wait --for exit --timeout-ms 8000` on the same terminal | held 8.4 s, then `error.code: "timeout"` |
| `terminal-wait.tui-idle-on-agent.json` | `--for tui-idle` on an idle Claude terminal | `satisfied: true` after 0.4 s |
| `terminal-read.trust-screen.json` | `terminal read` on the probe 2 terminal | the "Is this a project you created or one you trust?" screen |
| `terminal-show.plain-diagnostic-live.json` | `terminal show --terminal <handle>` on a live plain terminal (recorded 2026-09-21, JUL-98 step 5) | `result.terminal` with `handle`, `connected: true`, `orphaned: false`, and **no `agentIdentity`** -- that key is present only on an agent terminal |
| `terminal-show.unknown-handle.error.json` | the same on a handle Orca has never had | error `terminal_handle_stale`, message identical to the code. This is the liveness check the controller uses |
| `terminal-create.plain-diagnostic.json` | `terminal create --worktree path:<checkout> --title julia-controller-probe --json`, no `--command` (recorded 2026-09-21, JUL-98 step 5; the terminal was closed again straight after) | `result.terminal.handle`, `surface: "background"`, and a `warning` saying Orca could not make the tab discoverable -- the handle still works. The tab title Orca reports back afterwards is the shell's own prompt title, not the `--title` given |
| `dispatch-show.retry-of.json` | `orchestration dispatch-show --task task_d43d404304fd --json` | `dispatch.retry_of_dispatch_id` |
| `worktree-ps.agent-working.json` | `worktree ps --json`, cut to one worktree | probe 6 at 20:31:41: `agents[0].state: "working"` on a brand-new worktree |
| `worktree-ps.pi-agent-done.json` | same | a Pi run in a plain terminal: `agentType: "pi"`, `state: "done"`, `lastAssistantMessage` |
| `coordinator-grants.live.txt` | headless `claude -p` as `orchestrator-svc` with the exact `--allowedTools` list from `scripts/julia-run.mjs`, asked to try five commands | `orca status` allowed; `node -e`, `printenv`, `ls`, `git` refused |
| `cost.codex-session.json`, `cost.pi-deepseek-stream.json` | read from one real session record each | the file says exactly which file and fields |
| `seat-probe.reviewer-backup.json`, `seat-probe.builder-backup.json` | `node ops/service-dropbox/run-pi-seat.mjs <seat>` in a plain Orca terminal on the runner's daemon | provider and model the run reported, its cost, and the terminal's own `id` |
| `failure.claude.*`, `failure.codex.worker-show.json`, `failure.pi-adopted.worker-show.json`, `failure.mailbox.check-all.claude-codex-pi.json`, `failure.worker-list.all-vendors.json` | a worker told its task cannot be done reports `worker_done --outcome failed`; the coordinator was already blocked in `check --wait --types worker_done` | 23:01-23:09Z. `failure.claude.coordinator-wait-woke-on-worker-done.txt`: waiter woke at 23:01:15.537 on a report created 23:01:15. `worker-show`: `failed / settled`, `projection.outcome: failed`, `lastError: null`; the report is in the task `result` |
| `failure.claude.retry-*`, `failure.claude.task-list-after-retry.json`, `failure.claude.worker-list-after-retry.json` | fix the cause, then `worker-start --task <same> --retry-of <failed dispatch>` | task goes `failed` to `completed`; new dispatch carries `retryOfDispatchId`; the failed one stays in history |
| `base-checkout.replaced-in-place.worker-show.json` | fresh builder after the base checkout was replaced by a fresh clone at the same path | `succeeded` |
| `base-checkout.new-path-untrusted.*` | fresh builder against a base checkout at a different path | `failed / agent_readiness / timeout`; the trust question |
| `base-checkout.new-path-exact-trust.worker-show.json` | same, after trusting the exact new base path | `succeeded` |
| `base-checkout.moved-not-reregistered.worker-start.error.json` | worker start after moving the base on disk without re-importing it in Orca | `repo_not_found` |
| `cost.claude-vs-claude-code.session-*.json` | Claude Code's own cost record (`~/.claude.json` `last*`) beside the same session's transcript | the record's `lastModelUsage` is what the rate table is proven against; the transcript block counts each message id once |
| `cost.claude-session.json` | probe 6's transcript, corrected | replaces the version in PR #64, which counted repeated lines twice |
| `cost.claude-transcript.real-builder-lines.jsonl` | nine lines lifted from a REAL builder transcript (`~/.claude/projects/-home-runner-orca-workspaces-julia-next-jul98-step-3/`, 21 Sep, the JUL-98 step-3 attempt-1 worker), verbatim except that `message.content` is elided on the assistant lines -- no cost extractor reads it | three distinct assistant messages, each repeated as the transcript really repeats them (one line per content block), plus one real `user` line that also carries `output_tokens` and must stay uncounted. Recorded because `claudeUsageFromTranscript` returned an empty object for the real file: it took parsed objects only, and a `.jsonl` read off disk is strings |
| `cost.pi.seat-json-stream.multi-turn.jsonl`, `cost.pi.rpc-get-session-stats.json` | the seat launcher's JSON output for a two-turn run that uses a tool; Pi's own `get_session_stats` in RPC mode | peak prompt 2,530 derived from per-call usage; Pi's own `contextUsage.tokens` 2,507 equals the last call's total |
| `pi.timing.*.txt` | a wrapper that stamps start and exit around the seat | 2.416 s from either clock |
| `pi-registry.deepseek.json` | Pi's built-in model list, the two seat models | Pi's rates (lower than DeepSeek's published price) and the 1,000,000 window |
| `pi-models-store.deepseek.json` | `~/.pi/agent/models-store.json` on the runner, as Pi wrote it | the price list Pi fetches from DeepSeek and prefers over its built-in one: `deepseek-v4-pro` at DeepSeek's peak price, `deepseek-flash` (not our `deepseek-v4-flash` id) |
| `review.pr65.deepseek-pro.run.json` / `.verdict.txt` | the independent review of PR #65 on the DeepSeek Pro reviewer seat | 17 calls with usage and Pi's printed cost per call; the run's timing; the DeepSeek balance before and after ($3.07 to $2.98); the reviewer's verdict text |
| `orca-1.4.200-to-1.4.205.commands.txt`, `orca-1.4.200-to-1.4.205.orchestration-guide.diff` | `orca agent-context --json` and `orca skills get orchestration --full`, before and after the upgrade | what the upgrade changed |

## Reading these safely

- `worker-show` and `worker-list` are **different shapes**. `worker-show` has `worker`, `observation`,
  `projection`, `dispatch`, `terminal`, `server`, `remoteRuntimeEpoch`. `worker-list` has `workers[]`
  (each with `workerState`, `dispatchStatus`, `terminalState`, `projection`), `counts`, `page`, `scope`.
- On 1.4.205 there is **no** `terminalResource` in `worker-show`; the terminal is at `terminal.handle`
  and `worker.agentTerminalHandle` (null when the worker failed before it had a terminal).
- `projection.stage.activity` is `"unknown"` for the whole life of a worker. Orca's "working" is in
  `worktree ps`, under `agents[].state`.
- `worker-list` reports `liveness: unverifiable / missing_status` and `attention.requiresAction: true`
  for every worker, including ones that finished successfully. That is not a stuck signal.
- Nothing in these files is a secret. They were scanned for keys, tokens and private-key headers before
  they were saved. Dispatch capabilities never appear in these payloads.
- A Claude transcript writes one line per content block, so one message can appear twice with identical
  usage. Any code reading these files must count each `message.id` once.
- DeepSeek's published price, Pi's built-in price, Pi's fetched model-store price and the account balance all
  differ (`graph/rate-table.mjs` and its tests record each). On the one measured run the balance was lowest.
