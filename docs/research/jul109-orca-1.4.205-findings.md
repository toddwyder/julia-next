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
| 1 | Worker mailbox: status, heartbeat, escalation, one `worker_done` with an outcome | **Works.** One worker sent `status` (phase `step-1`), `heartbeat` (phase `waiting`), `escalation`, `status` (phase `step-2`) and `worker_done` (`outcome: succeeded`). All five reached the coordinator's inbox, in order, with `from_handle: dispatch:<id>`. `check --wait` blocks and returns a `deliveryId` to acknowledge; on an empty inbox it held for the full 20 s timeout and returned `timedOut: true`, exit 0, with a keepalive line on stderr at 15 s. The `failed` outcome is proven in section 4a. |
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

## 4a. The failure path: a worker reports `worker_done` with `outcome: failed`

Proven end to end for Claude, Codex and DeepSeek Pi (fixtures `failure.*`). Each was given a task whose
required file did not exist and told to report `failed`; the coordinator was already blocked in
`check --wait --types worker_done` when the worker started.

- **The message arrives, and wakes the waiter in the same second.** Claude: the worker's report was
  created 23:01:15Z and the blocked `check --wait` returned at 23:01:15.537 with
  `payload.outcome: "failed"` and the worker's own explanation in `body`. Codex and Pi the same
  (`failure.mailbox.check-all.claude-codex-pi.json`).
- **What Orca then says:** `worker-show`: `worker.state: failed`, `worker.stage: settled`,
  `projection.outcome: failed`, `dispatch.status: failed`, `attention.categories: ["failure"]`,
  `worker.lastError: null`, and `observation.status: live` (the agent is still up). `task-list`: the
  task is `failed`. The worker's report is kept in the task's `result` and in `dispatch.lastFailure`, so
  the reason survives without reading a terminal.
- **It is distinguishable from the other failure.** A worker that never started (the trust screen) has
  `worker.lastError: "timeout"`, `failedStage: agent_readiness`, no terminal, and
  `observation.status: identity_changed`. A reported failure has `lastError: null` and a terminal.
- **The remediation step works.** After the cause was fixed, `worker-start --task <same task>
  --retry-of <failed dispatch>` started a new worker; it reported `succeeded`; the task went
  `failed` to `completed`; the failed dispatch stayed in history and the new one carries
  `retryOfDispatchId`.
- **Orca's own failure counter stayed 0** (`dispatch.failureCount: 0`) after a reported failure, so it
  is not counting reported failures. The two-rounds-then-park rule has to be counted by the controller.
- **Acknowledge the delivery** (`--ack <deliveryId>`). Until then the same message wakes the next
  `check --wait`, so a waiter that does not ack will keep waking on old news.
- **Pi's startup race showed again:** the first adoption of a fresh Pi lost the task text; a 45 s wait
  after starting Pi made it work.
- **Not tried:** a worker that dies or hangs without reporting anything. See section 10.

## 5. Where per-worker cost data comes from, per vendor

Completed in the UAT follow-up (evening of 20 Sep, UTC). The rates are in `graph/rate-table.mjs`, each
with its source and the day it was checked; `graph/rate-table.test.mjs` proves them against the recorded
sessions in `graph/fixtures/orca-1.4.205/`.

| | Model | Tokens | Peak context | Time | Dollars |
|---|---|---|---|---|---|
| **Claude** | `message.model` in `~/.claude/projects/<worktree path>/<session>.jsonl` | sum `message.usage`, **counting each message id once** | max over messages of input + cache read + cache creation | last minus first line timestamp | rate table, or Claude Code's own record (below) |
| **Codex** | `turn_context.payload.model` in `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | last `token_count` `info.total_token_usage` | max `info.last_token_usage.input_tokens`; the ceiling is `info.model_context_window` | last minus first line timestamp | rate table |
| **Pi / DeepSeek** | `provider` and `model` on the last assistant `message_end` in the seat's own JSON output | that event's `usage` | max over assistant messages of `input + cacheRead + cacheWrite` in the same output | **the controller times the process**: it starts it and sees it exit | rate table (the published price), not Pi's own figure |

**Claude dollars.** The table reproduces Claude Code's own recorded cost exactly, on Claude Code's own
token counts, for two real sessions and both models in each: for example Sonnet 5 at 510 in / 405 out /
230,252 cache read / 13,649 cache write is $0.1057164 in Claude Code's record and $0.1057164 from the
table (Sonnet 5 is $2 in, $10 out, $0.20 cache read, $4 for 1-hour cache writes; Haiku 4.5 is $1 / $5).
**Two traps, both found while proving it:**

1. A Claude transcript writes one line per content block, so a message with a text block and a tool call
   appears twice with identical usage. Summing lines double-counts. **My first cost extract in PR #64 did
   exactly that** (probe 6: it said 1,142 output tokens; the true figure is 805). It is corrected in
   `cost.claude-session.json`. Peak context was unaffected.
2. Even counted correctly, the transcript is a **lower bound**. On the proof session the transcript gives
   $0.0920 for Sonnet against Claude Code's own $0.1083 for the session: 15% under. Claude Code makes
   calls the transcript does not hold (a Haiku call and about one extra Sonnet-sized call).
   Claude Code's own record (`~/.claude.json`, `projects[<base checkout>].last*`) is exact, but it is
   written **only when the session exits cleanly** (asking Claude to `/exit` wrote it; `worker-release`,
   which closes the terminal, did not), and it is one slot per base checkout that the next session
   overwrites. With one builder at a time it can be read straight after each session ends.

**Codex dollars.** From the token record and the rate table: the recorded session is $0.113102
(5,664 uncached x $10 + 45,312 cached x $1 + 223 output x $50, per million). Codex's `input_tokens`
includes the cached tokens (`total_tokens = input + output`), so the table prices the uncached part
separately. Codex records tokens but no dollars, so **this is arithmetic proven, not a figure checked
against anything the vendor reported.**

**DeepSeek.** *Dollars:* Pi prints `usage.cost.total`, but its built-in prices are **lower than
DeepSeek's own published price**: on the reviewer probe Pi printed $0.000845 and the published off-peak
price gives $0.001322 (1.56 times); the builder probe is 1.08 times. DeepSeek also charges double at
peak hours (01-04 and 06-10 UTC, Monday to Friday), which Pi does not model. The table uses the
published price and records Pi's as `piRegistry`. *Which one is the real charge is not settled:*
DeepSeek's balance is readable through its API but only to the cent ($3.07 at the time), and settling it
needs a deliberate spend of about ten cents. *Duration:* the controller starts the process and sees it
exit; proven on a real seat run, where the wrapper's clock said 2.416 s and the start and exit stamps
differ by 2.416 s. *Peak context:* Pi does expose context usage, but only in its RPC mode
(`get_session_stats.contextUsage`) and its extension API, and the seats run `--mode json`, whose output
has no context field (every key in a real multi-turn run was searched; the run is the fixture). What the
output does carry is per-call usage, so the peak is derivable: 2,530 tokens on that run (1,975 + 384 on
turn one, 226 + 2,304 on turn two). Pi's own RPC answer for the same kind of run is
`contextUsage.tokens: 2507`, exactly the last call's total, with a window of 1,000,000 (also in Pi's
model registry). What is lost without the native field: only Pi's live gauge; the peak is not lost.

`~/.claude.json`'s `last*` values are not usable for Codex or Pi. Orca itself exposes no token or cost
figure (`worktree ps`, `worker-show` and `terminal list` were searched).

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

**Does the fix hold when the base checkout moves? (tested)** Claude keys its trust entry by the exact
path of the base checkout, and a worktree inherits it from there. Tested on the live server with a fresh
builder each time and nothing pressed:

| Change | Result |
|---|---|
| The base checkout **replaced in place** (renamed, fresh clone at the same path, new inode) | **Holds.** The builder reached `succeeded`, agent state `done`. |
| The base checkout at a **different path** (a scratch clone, registered as its own repo) | **Breaks, identically to the overnight failure:** `failed / agent_readiness / timeout` after 60 s, and the screen shows the trust question. |
| Trust the folder the worktrees live in (`/home/runner/orca/workspaces`) | Does not help. |
| Trust the folder that contains the moved base | Does not help. Ancestors are not inherited at either level. |
| Trust the **exact** new base path | **Cures it.** Reached `succeeded`, agent state `done`. |

Orca adds two things: `orca project setup-update --path` is refused for a repo-backed project ("must be
changed by re-importing the project"), and a base moved on disk without re-importing fails every worker
start with `repo_not_found` (`base-checkout.moved-not-reregistered.worker-start.error.json`).

**What makes it durable.** The entry is a fact about one path, so it holds only while that path stays
put. (1) Keep the base at `/home/runner/julia-next`; replacing it in place is safe. (2) Any move or
re-import of the base checkout must add the new path's trust entry in the same admin step (the runbook
says how). (3) The failure looks identical every time it returns, so the detector is the signature
`agent_readiness` / `timeout` with no terminal, and the terminal screen (the trust question); the
readiness review's real-launch probe, run from a fresh worktree of the *current* base after any checkout
change, catches it before a card does. (4) Not built here: a small idempotent "ensure the runner's
first-run settings" step that writes all three keys for every registered base path, so the admin step
cannot be forgotten.

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

## 10. Not proven, and what breaks if each one stays

| Gap | What breaks if it stays |
|---|---|
| **Claude dollars from the transcript alone are a lower bound** (about 15% under on the proof session). Exact only if the session exits cleanly and Claude Code's own record is read straight afterwards. | The cost line for the seat doing most of the work would read low. Every card would look about a seventh cheaper than it was, and any judgement of model tiering built on it would be skewed toward the more expensive model. Fix: end each Claude session with `/exit` and read Claude Code's record, keeping the transcript figure as the fallback. |
| **Codex dollars are arithmetic, not checked against a vendor figure** (the record has tokens only, and the login is a subscription). | The Codex cost line is an estimate at list price, not a bill. If OpenAI changes a price, the line is wrong until the table is edited; the test will not notice because there is no vendor dollar to compare with. |
| **DeepSeek: Pi's printed dollars disagree with DeepSeek's published price** (1.08 to 1.56 times, plus a doubled peak rate Pi ignores). Not settled which is the real charge. | DeepSeek is the one seat billed per token from a real balance. If the published price is right, anything reading Pi's figure understates spend by up to a third, which is the direction that hides a runaway bill. Settling it takes DeepSeek's usage page or a deliberate spend of about ten cents (a money decision, so it was not done). |
| **A worker that dies or hangs without reporting** was not tried. | The controller's stuck-detection would be designed against a guess. What is known: the signature of a worker that never starts, and that Orca's own liveness is noisy (section 2, fact 3). |
| **A worker whose task text was lost** (Pi startup race, twice). Orca says `input_accepted` and nothing happens. | A Pi worker looks in progress for ever. The controller must confirm a turn started (`--wait-submit`) or wait for Pi to be up, not trust `worker-start`. |
| **GLM was not probed** (barred on cost, deliberately). | Nothing, while the rule stands that a card naming GLM parks Blocked. If the rule changes, GLM has no proven route. |
| **Claude as a reviewer on the backup route** was not probed separately. | Low: it is the same `worker-start` route as the builder. A reviewer-specific launch problem would show as the same `agent_readiness` signature. |
| **The trust entry is per base path** (section 6). Fixed for a move, not prevented. | A base checkout moved without the admin step brings the overnight failure back, looking identical, on the next card. |
| **Orca cannot delete a run.** | Runs accumulate in `run-list` for ever; the queue's finished-run guess (age plus task state) is what keeps them from blocking. |
| **The Codex `effort` field is recorded only when one was requested.** | A Codex cost line cannot say what effort ran unless the card set one. |

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

**Second round (UAT follow-up):** one run of 9 workers, 4 worktrees, a scratch base checkout registered as
its own repo (removed with `project setup-delete`), the terminals, the scratch files and the config
backup were all removed, and the runner's config was put back to exactly the three intended settings. The
original base checkout was swapped out for a fresh clone for one test and put back untouched (same
inode, same 82 branches, same 61 worktrees). The second probe run stays, like the first, with no open task.
