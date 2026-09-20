# Orca 1.4.205: upgraded, pinned, and what it proved (JUL-109)

Recorded 2026-09-20 by a laptop session with an admin session on the server, between cards (Linear
had nothing in Ready or in progress, and the Ready-queue timer was paused for the window and
restored afterwards). No controller code was written. Every result below has a saved file under
`graph/fixtures/orca-1.4.205/`; `README.md` there says which command and which run produced each one.

## 1. Version

| | Before | After |
|---|---|---|
| `orca --version` as `runner` | 1.4.200 | 1.4.205 |
| `orca --version` as `orchestrator-svc` | 1.4.200 | 1.4.205 |
| package `orca-ide` | 1.4.200 | 1.4.205 (sha256 `da70c92a...29ccb`, matches the checksum GitHub publishes for the release) |

- 1.4.205 (17 Sep) was the newest stable release on 20 Sep. Installed with `dpkg -i`; `orca-ide` is
  now `apt-mark hold` so nothing upgrades it by accident. Both packages are kept in `/opt/orca-pin/`
  with `SHA256SUMS` and a README that says how to roll back.
- The Ready-queue timer (`julia-ready-queue.timer`) was stopped at 20:16Z before the upgrade and
  started again at the end, so the queue could not start a card in the middle of it. Both Orca services
  were restarted; both daemons came back `ready`, and both saved environments (`ovh-local`,
  `orchestrator-local`) reconnected with no re-pairing.
- **What the upgrade changed in the command surface:** nothing added or removed (234 commands before
  and after). `worktree rm` gained `--allow-failed-archive-hook`; the `orchestration check` and
  `orchestration send` help text changed; and the bundled orchestration guide changed one paragraph,
  on group addressing (`@worktree:<id>` and Run groups). See the two `orca-1.4.200-to-1.4.205.*`
  files.
- **Side effect to know about:** Orca rewrites `runner`'s `~/.claude/settings.json` hooks every time
  its daemon starts. Our own settings in that file (section 6) survived two daemon restarts.

## 2. The five audit facts, re-verified on 1.4.205

| # | Fact | Result |
|---|---|---|
| 1 | Worker mailbox: status, heartbeat, escalation, one `worker_done` with an outcome | **Works.** One worker sent `status` (phase `step-1`), `heartbeat` (phase `waiting`), `escalation`, `status` (phase `step-2`) and `worker_done` (`outcome: succeeded`). All five reached the coordinator's inbox, in order, with `from_handle: dispatch:<id>`. `check --wait` blocks and returns a `deliveryId` to acknowledge; on an empty inbox it held for the full 20 s timeout and returned `timedOut: true`, exit 0, with a keepalive line on stderr at 15 s. **Not exercised:** `worker_done` with `--outcome failed`. |
| 2 | `worker-start` carries model and effort | **Works for Claude and Codex.** The answer has `launch.requested` and `launch.effective`; they matched (`claude-sonnet-5`/`low`, `gpt-6-astra`/`low`) and the real records agree: the Claude terminal ran `claude --model claude-sonnet-5 --effort low`, and the Codex session's turn context says `gpt-6-astra` / `low`. **Gaps:** `--effort` without `--model` is refused (`--effort requires --model.`); a Codex worker started with no `--model` reports `effective.model: null`, so Orca cannot say which model ran; a worker adopted with `--terminal` (the Pi route) carries no model or effort at all. |
| 3 | Worker verdict from `worker-list` / `worker-show` | **Shapes captured, with three traps.** (a) `projection.stage.activity` is `"unknown"` for the whole life of every worker, even one visibly busy. Orca's "working" is in `worktree ps`, under `agents[].state` (`working`, later `done`). (b) `worker-list` says `liveness: unverifiable / missing_status` and `attention.requiresAction: true` for every worker, including ones that finished cleanly, while `worker-show` for the same worker says `observation.status: live`. Neither is a stuck signal. (c) `worker_done` can arrive up to about 30 s before the agent is idle (probe 6: settled 20:31:47, agent `working` until about 20:32:19), so release a worker only after `agents[].state` is `done`. The real failure signature is `worker.state: failed`, `worker.stage: agent_readiness`, `worker.lastError: timeout`, `observation.status: identity_changed`, `agentTerminalHandle: null`. |
| 4 | Safe replay: `--retry-request`, `request-show` | **Works.** Replaying `terminal send` and `run-create` with the id Orca gave returned `mutation.replayed: true` and did nothing new (run count stayed 35). `request-show` answers `completed` with a plain-English `interpretation`, or `absent`. **Trap:** only ids Orca issued are honoured. A client-made UUID was ignored, not replayed. The id to replay with is `mutation.requestId` in a success or `data.orchestrationRequestId` in an error. |
| 5 | `terminal send --wait-submit` proves a turn started | **Works, and it is the discriminator.** Into a healthy idle builder: stages `["input_accepted","turn_started"]`. Into a real Claude at the folder-trust screen: stages `["input_accepted"]` and a warning that no turn start was observed. `worker-start`'s own `stage: input_accepted` is **not** proof: the first Pi adoption attempt (section 4) reported it while the task text had been lost. |

## 3. The three known constraints

| Constraint | Still true? | Evidence |
|---|---|---|
| Orchestration calls need a live caller terminal (`--from`) | **Still true.** | `run-create` outside an Orca terminal: `no_active_sender_terminal`. A coordinator that must create a diagnostic terminal first gets a run whose `coordinator_handle` is that terminal (the wrong-binding trap in the runbook). |
| A run is bound to one consumer | **Still true.** | A second terminal took the run with `run-use` (generation 1 to 2); the first terminal's next `check` failed `consumer_fenced`; handing it back made generation 3. |
| `--retry-of` records retry lineage | **Still true, with a rule.** | `--retry-of` needs `--task <failed task>`; with `--spec` it is refused. The retry reuses the same task id. Lineage is in `worker-show` at `result.dispatch.retryOfDispatchId` and in `dispatch-show` as `dispatch.retry_of_dispatch_id`. It does not inherit placement: repeat `--on`, `--worktree` and `--agent`. |

## 4. Can a DeepSeek (Pi) worker report through Orca's mailbox?

**Yes, on one route. Not on the route the seats use today.**

- **What works:** start Pi *interactively* in an Orca terminal, wait until it has fully started, then
  `orca orchestration worker-start --terminal <handle> --worktree path:<worktree> --spec ...`. Orca
  types the contract and task into Pi; Pi followed it and sent `worker_done` (`outcome: succeeded`) to
  the coordinator's inbox; `worker-show` went `succeeded / settled`. The Pi in that test was
  `deepseek-v4-flash`, started by a throwaway launcher that read the secret in-process the way
  `read-secret.mjs` does.
- **What does not work:** `run-pi-seat.mjs` runs Pi with `-p --mode json`, a one-shot with no
  contract, so it cannot report to the mailbox. Its result has to be read from its own output and
  exit code.
- **The startup race (a real trap):** on the first attempt, `worker-start --terminal` fired while Pi was
  still starting (it was downloading `fd` and `ripgrep` on first run). The task text never appeared,
  and Orca still said `stage: input_accepted`. Only after Pi was fully up did the same call work.
  The controller must not adopt a Pi terminal until Pi has started, and must confirm a turn began.
- **Pi does talk to Orca about status.** Orca installs three managed Pi extensions
  (`orca-agent-status.ts`, `orca-prefill.ts`, `orca-titlebar-spinner.ts`). Through them, `worktree ps`
  shows a Pi agent with `state: done` and its `lastAssistantMessage`, even for a `-p` run in a plain
  terminal. So the earlier note "Pi has no status hooks" is out of date on this version.
- **What the controller must do:** for a Pi seat launched through `run-pi-seat.mjs`, treat the process
  exit plus the final `message_end` event in its JSON output as the report (verdict text and usage are
  in it), and use `worktree ps` for liveness. Adopting an interactive Pi with `--terminal` is possible
  but carries no model or effort, and needs the startup wait.

## 5. Where per-worker cost data comes from, per vendor

Each was proven by reading one real session and computing the figures; the extracts are
`cost.*.json`.

| | Model | Tokens in / out | Peak context | Duration | Dollar cost |
|---|---|---|---|---|---|
| **Claude** | `message.model` on each assistant line of `~/.claude/projects/<worktree path, / as ->/<session>.jsonl` (one file per session, one worktree per worker) | sum `message.usage` over assistant lines: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` | max over turns of input + cache read + cache creation. Probe 6: 62,524 | last minus first line timestamp. Probe 6: 42.6 s | not in the record; needs a price table |
| **Codex** | `turn_context.payload.model` in `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (find the file whose `session_meta.payload.cwd` is the worker worktree) | last `event_msg/token_count` `info.total_token_usage` (cumulative). Probe: 50,976 in (45,312 cached), 223 out | `info.model_context_window` is the ceiling (258,400); peak use is the max `info.last_token_usage.input_tokens` (17,270) | last minus first line timestamp. Probe: 17.2 s | not in the record; tokens only |
| **Pi / DeepSeek** | `provider` and `model` on the last `message_end` event of the seat's `--mode json` output | `usage.input`, `usage.output`, `cacheRead`, `cacheWrite`, `reasoning` on that event | **gap:** only per-message totals; the controller must track the largest itself | **gap:** no duration on events; the controller must time the process | **yes:** `usage.cost.total`, in dollars. Reviewer probe: $0.00084535; builder probe: $0.00051656 |

`~/.claude.json` also holds `lastCost` and token counts per project, but only under the base
checkout's key (worktree sessions do not get their own) and each session overwrites it. Do not use it.
Orca itself exposes no token or cost figure (the audit's suspicion holds; nothing found in
`worktree ps`, `worker-show` or `terminal list`).

## 6. The runner account's first-run screens

**What stops a fresh builder.** To find out, `runner`'s config was backed up, stripped to a clean state
(trust entry for `/home/runner/julia-next` and `skipDangerousModePermissionPrompt` removed) and a
real builder was started with `worker-start` in a brand-new worktree. It never reached ready: Orca
reported `failed / agent_readiness / timeout` after 60 s, and the terminal showed Claude's
"Is this a project you created or one you trust?" question (fixture `terminal-read.trust-screen.json`).
That is the night of 19-20 September, reproduced.

**What was set** (all in `runner`'s own home, nothing else changed):

1. `~/.claude.json`: `projects["/home/runner/julia-next"].hasTrustDialogAccepted = true`. Claude
   inherits trust for an Orca worktree from the base checkout it belongs to, so this one entry covers
   every new worktree (proven below); no per-worktree entry is needed.
2. `~/.claude/settings.json`: `skipDangerousModePermissionPrompt: true` (the bypass-permissions
   acceptance; Todd accepted bypass mode for `runner` on 20 Sep, so it is not asked again).
3. `~/.claude/settings.json`: `env.DISABLE_AUTOUPDATER = "1"`. Claude Code's own auto-update fails on
   this box ("no write permission to npm prefix"), so the check is off on purpose. `claude doctor` now
   says `Auto-updates: disabled (set by env: DISABLE_AUTOUPDATER)`, and the updater's result file was
   not touched by the later runs.

**Proof, not assertion.** After an Orca daemon restart (to show the settings survive it), a fresh
builder in a brand-new top-level worktree was started with `worker-start` and nobody touched a key:

- Probe 3, 20:24Z: `state: ready`, then `succeeded / settled`; the screen shows the task done and no
  update notice (`worker-show.settled-succeeded.json`).
- Probe 6, 20:31:41Z: `worktree ps` showed that worktree's agent with `state: "working"`
  (`worktree-ps.agent-working.json`). This is the literal "reaches working".

## 7. Every seat probed the way the controller starts it

No seat was proven by a login shell or by `claude -p`.

| Seat | How it was started | Result |
|---|---|---|
| Claude builder | `worker-start --agent claude --model claude-sonnet-5 --effort low`, new top-level worktree | works after the section 6 settings; failed before them |
| Codex | `worker-start --agent codex [--model gpt-6-astra --effort low]` | works, reported `worker_done` |
| **DeepSeek reviewer (`reviewer-backup`)** | a plain terminal created through Orca on the runner's daemon (`ovh-local`) in a fresh top-level worktree, prompt piped into `node ops/service-dropbox/run-pi-seat.mjs reviewer-backup` | terminal's own `id`: `uid=1001(runner) gid=1001(runner) groups=1001(runner),1003(zai-readers),1004(deepseek-readers)`; provider `deepseek`, model `deepseek-v4-pro`; verdict came back (`VERDICT: FAIL` on a deliberately wrong change, which is the right answer); cost $0.00084535; exit 0 |
| DeepSeek builder (`builder-backup`) | same route | `deepseek` / `deepseek-v4-flash`, correct reply, $0.00051656 |
| GLM (`orchestrator-backup`) | **not probed.** GLM is barred as a default or fallback on cost. | gap |

The `deepseek-readers` group appearing in the spawned terminal's own `id` also settles the
carried-over item: the JUL-44 stale-supplementary-groups trap is not biting this seat on 1.4.205.

## 8. What a queue-launched coordinator may run, proven live

The list in `scripts/julia-run.mjs` (`Bash(orca *)` plus a fixed set of `node scripts/<name>.mjs`) was
run for real: a headless `claude -p` as `orchestrator-svc` with exactly that `--allowedTools`, asked to
try five commands. `orca status --json` was **allowed**; `node -e "console.log(1)"`, `printenv HOME`,
`ls /etc` and `git -C /srv/orchestrator-svc/julia-next log -1 --oneline` were **refused**
(`coordinator-grants.live.txt`). `scripts/orca-cli.mjs` exposes only `run-list`, `task-list` and
`worker-show`. Every dispatch action goes through the `orca` binary on PATH.

## 9. Other things found that the controller should know

- `worker-show` has **no** `terminalResource` on 1.4.205. The terminal is at `terminal.handle` and
  `worker.agentTerminalHandle`. (The JUL-106 note listed `terminalResource.terminalHandle` from 1.4.200.)
- A worker's dispatch capability is revoked when it settles (`capabilityRevokedAt`), and a settled
  dispatch refuses more messages (`dispatch_inactive`).
- `worker-abandon` did not free a terminal that had an active dispatch on it; adopting the same
  terminal again failed with "already has active remote Dispatch". Closing the terminal did.
- An Orca restart kills open terminals: a later `terminal send` got `terminal_handle_stale`.
- Orca still has no way to close or delete a run. This session's run stays in `run-list` with all 11
  tasks terminal (8 completed, 3 failed), the same way the older leftover runs do.

## 10. Not proven (named gaps)

- `worker_done` with `--outcome failed` was not sent.
- GLM seat, Cursor, and Claude as a *reviewer* on the backup route were not probed separately (the
  Claude path is the same `worker-start` route as the builder).
- Pi peak context and Pi duration have no source in the stream (section 5); Claude and Codex records
  carry tokens but no dollar cost.
- Whether the section 6 trust entry still covers a worktree if the base checkout moves from
  `/home/runner/julia-next`. It is keyed by that path.
- The Codex `effort` field is recorded only when one was requested.

## Cleanup

Everything this ticket created was removed: the 9 workers Orca still held terminals for were released
(the other 3 of the 12 had failed before getting a terminal), all nine probe worktrees and their
branches removed, every terminal Orca listed as ours closed (checked afterwards: none of ours
was left on either daemon), every task in the probe run settled, the scratch files under
`/home/runner`, the config
backup, and the one-off scripts. The
probe run `run_1bf570ce5660` remains (Orca cannot delete runs) with no non-terminal task. Pi installed
`fd` and `ripgrep` into `~/.pi/agent/bin` for `runner` on its first run; that stays. The Claude and
Codex session logs of the probes are still in `runner`'s home.
