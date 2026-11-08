# Mechanical layer plan (JUL-342)

Builds started in Studio run only on Todd's model picks. Helpers always return a written report. Todd hears about a restart, a refused model, or a usage limit within a minute.
The rule is that our code sets the mechanics on stock Mastra 1.82.0 settings, so the Lead neither picks them nor routes around them. pstack's files stay untouched.
Each slice starts red on the 7 Nov JUL-341 failure that it fixes.
The slices, in order, are P1 (bounded trace), P2 (build worktree), P3 (the picker's models file, read per run), P4 (trouble notices), P5 (helpers report back), P6 (no coding programs), P7 (resume from the last step), P8 (pstack anchors in CI), and P9 (practice card proof).

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `.agents/skills/poteto-mode/playbooks/autopilot-full.md`. The builder works by hand in CommandCode, outside Studio, on `commandcode/deepseek/deepseek-v4.1-flash`, as Todd asked on 7 Nov. P5 and P7 move to a stronger model only if DeepSeek gets stuck on them, and the switch is recorded in the owner's trail. Todd's full-autonomy grant lets each owner merge its PR once required checks pass and the root's verdict is clean. P3 changes the model picker, which Todd uses, so P3 stops at merge-ready for his review. P9 ends with Todd's UAT, and the card completes only after his yes.

Live lanes run on `commandcode/deepseek/deepseek-v4.1-flash`, one at a time. Audit lanes and Shipping run on `gpt-6-luna`, moving to `gpt-6.1-terra` if Luna misses a real failure. Their model company stays different from the builder's.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

Each slice is a Linear sub-issue of JUL-342, in the order above, and carries its **You see.** block as its done-means. JUL-342 completes only when the P9 sub-issue completes.

The verification shape is the repo's own, recorded in `docs/pstack-deviations.md`. Run `node scripts/check-plan.mjs docs/agents/mechanical-layer/plan.md`; do not run the pstack checker on this plan.

One shared trunk run serves the Build, Models, and Helpers regressions. The planted-codex and killed-build regressions get their own trunk runs. The Tell Todd piece is held out of this batch, and its two failed checks are diagnosed from saved output.

## Architecture

The mechanics are one path through stock Mastra 1.82.0. A run starts from the run form. The build step creates the card worktree and points the Lead and helper workspaces at it. The Lead and every helper are built with `model` and `agents` resolved per call, delegation hooks that set and protect the helper budget, a last-step processor that forces text, a workspace command gate, and error and output processors that send notices. The trace config caps every stored string. The build step adopts or starts one durable run, so a restart resumes it. Every notice leaves through one `notice` function.

| Piece | What our code sets | Mastra 1.82.0 doc | Code |
| --- | --- | --- | --- |
| Per-run model lookup | `model` and `agents` are functions that read the picker file and the Lead setting at each call | `reference-agents-agent.md:560`, `:562`; `docs-server-request-context.md:127-153` | `machine/flow/agents.mjs`, `machine/flow/role-models.mjs`, `machine/flow/models.mjs` |
| Build worktree | a filesystem resolver and a sandbox resolver point the Lead and helpers at the card worktree | `reference-workspace-workspace-class.md:36-38`; `reference-workspace-local-sandbox.md:47` | `machine/flow/agents.mjs`, `start-build` in `machine/flow/steps.mjs` |
| Helper delegation hooks | `onDelegationStart` returns `modifiedMaxSteps`; `onDelegationComplete` replaces empty text and stamps `machineFault` | `docs-subagents.md:68-78`, `:136-144` | `machine/flow/agents.mjs` |
| Last-step check | a `processInputStep` processor returns `toolChoice: 'none'` on the helper's last step | `docs-agents-processors.md:235`, `:260-269` | `machine/flow/agents.mjs` |
| Command gate | a workspace `tools.hooks.beforeToolCall` refuses coding programs, and refusing scripts sit first on `PATH` | `reference-workspace-workspace-class.md:184-196`; `docs-sandbox-overview.md:58-76` | `machine/flow/agents.mjs`, `machine/flow/refused-programs/` |
| Trace limits | `serializationOptions.maxStringLength` 2000 and `excludeSpanTypes: [SpanType.PROCESSOR_RUN]` | `reference-observability-tracing-configuration.md:56`, `:62-70` | `machine/flow/mastra.mjs` |
| Resume | `createDurableAgent` persists `running` snapshots, an adopt-or-start build step calls `recover()`, and `MastraStorageExporter` writes each finished step | `docs-harness-durable-agents.md:283`, `:293-306`; `docs-workflows-overview.md:487-503` | `machine/flow/steps.mjs`, `machine/flow/mastra.mjs` |
| Notices | `processAPIError` and `processOutputStep` processors call one `notice` function, and boot reports a run still `running` | `docs-agents-processors.md:115-131`, `:336`, `:385-407`, `:1067-1087` | `machine/flow/notice.mjs`, `src/mastra/index.ts` |

The order inside a run is worktree, then models, then Lead steps. A helper call is one delegation. The Lead's hook raises the budget. The helper's last-step processor forces text. The complete hook turns empty text into a fault and a notice. The command gate runs inside both shells, so it covers the Lead and every helper. The trace limit applies to every span. Resume sits above all of them. It rebuilds the same Lead, hooks, gate, and processors from the persisted snapshot, then re-drives the build run. Notices are the only piece that leaves Mastra, and they stay behind one function.

The exporter batch setting, `maxBatchSize`, has no line in the packaged 1.82.0 references. Appendix A's `q2b-batch1.out` measured it.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these from trunk at program start. Re-read them at every tick.
  - [ ] `git show origin/main:.agents/skills/poteto-mode/playbooks/autopilot-full.md`
  - [ ] `git show origin/main:.agents/skills/swarm/SKILL.md`
  - [ ] `git show origin/main:.agents/skills/playwright-cli/SKILL.md`
  - [ ] `git show origin/main:.agents/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `git show origin/main:.agents/skills/poteto-mode/playbooks/shipping.md`
  - [ ] `git show origin/main:.agents/skills/interrogate/SKILL.md`
  - [ ] `git show origin/main:docs/agents/server-runbook.md`
- [ ] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.
- [ ] Record the server's memory budget before the first lane. It has 7.6 GB and no swap. One Studio test copy runs at a time, capped at 2.2 GB. The cap rests on measured peaks of 1,482 MB and 1,878 MB, and 3.8 GiB free with the builders running.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane. If a helper hit the 100-turn limit, do not dispatch a replacement. Report in three lines what is left and the tokens it used, and wait for Todd. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.
- [ ] Put the Studio folder back on main before any slice runs. `git -C ~/julia-builder status` prints `On branch main` and a clean tree, and `jul-341-apothecary` stays on origin with its five commits. Todd's grant covers this server change.
- [ ] Create the nine sub-issues of JUL-342 in Linear, P1 to P9 in order, each with its **You see.** boxes as done-means. Evidence is the nine sub-issue ids posted on JUL-342.

### Spawn owners

- [ ] Spawn one owner per PR on `commandcode/deepseek/deepseek-v4.1-flash` with the full lifecycle the execution playbook names. P5 and P7 move to a stronger model only if DeepSeek gets stuck on them, and the owner records the switch and its reason in the trail. Each owner works in its own worktree under `~/.local/state/julia-scratch/jul-342-<pr>/`, never in `~/julia-builder`.
- [ ] If a helper hits the 100-turn limit, do not spawn a replacement. Report in three lines what is left and how many tokens it used, and wait for Todd.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges.
  - [ ] P1, P2, P3, P4, and P8 are independent and first. All branch from `main`.
  - [ ] P5 after P3 and P4.
  - [ ] P6 after P5.
  - [ ] P7 after P1, P4, and P6.
  - [ ] P9 after every other PR.
- [ ] Hold the file boundaries. P3, P5, P6, and P7 each edit `machine/flow/agents.mjs`, so they merge in that order and each rebases on the last. P3 alone touches `dashboard/**`. P8 touches only `scripts/check-pstack-anchors*.mjs`, `docs/agents/mechanical-layer/pstack-anchors.json`, and `.github/workflows/ci.yml`.
- [ ] Hold the review gate. P3 changes an interaction. It waits for the operator's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, per **Opening a PR**. Use the run's built-in PR tool when it has one, else `origin pr create --status open --base <base-branch>` or `gh pr create --base <base-branch>` according to the resolved forge. A stack child targets its parent branch.
- [ ] Run the repo's lint and typecheck once before the PR-facing push. Push with hooks on.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`.
- [ ] Rebase onto current trunk before the code-ready report and babysit. Keep that merge base in fix rounds. Rebase again only at merge prep, on a `git merge-tree` conflict with trunk, on a CI failure that comes from a change on trunk, or when a known concurrent change to the same files lands.
- [ ] Carry the card's scorecard in every PR body, built with `node scripts/scorecard.mjs JUL-342 --write`.
- [ ] Run `npm run guard:flow` and `node scripts/machine-programs.mjs --check` on every PR that touches `machine/flow`. A new program file joins `PROGRAMS` and the list is rewritten with `--write`.

### Verdict and merge, for every PR

- [ ] One independent live checker runs once, at the code-ready head. It did not write the PR and it runs in a fresh session. Another checker runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head, and a wording-only change gets none. The checker runs the PR's scenarios from its **Verify, live** block through the shared lane runner, one Studio copy at a time. The perf check from its **Verify, perf** block. One audit lane on `gpt-6-luna`, moving to `gpt-6.1-terra` if Luna misses a real failure, and a second only for a named risk. Their model company stays different from the builder's. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Judge every finding by the execution playbook's blocking rule. The verdict is clean when none blocks. A failure on trunk behavior in a lane marked `Regression lane against trunk.` is recorded against trunk and does not block the PR. A new head gets a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] The owner squash-merges its own PR after the root's clean verdict at the exact head SHA and green required checks. If the head changes after the verdict, the patch-id rule in `playbooks/shipping.md` decides whether the verdict still covers it. P3 waits for the operator's click.

### Boot recipe, for every live lane

Each live lane runs on the server at the PR head, in its own worktree. Run one live lane at a time. The server has 7.6 GB and no swap, so each candidate Studio is capped at 2.2 GB RSS. The cap rests on measured peaks of 1,482 MB and 1,878 MB, and 3.8 GiB free with the builders running. A helper without the lock waits and never starts its own copy. Drive the browser through `playwright-cli` and the shell through tmux. Live Studio on its own port stays on main and is never restarted by a lane.

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] Start a candidate Studio from the worktree on its own port with `FLOW_DIR`, `JULIA_LEAD_MODEL_FILE`, and the models-file variable pointed at files in the lane folder, under a 2.2 GB memory cap. Pick the free model in every role. Wait for the `card-path` run form, as `node scripts/check-studio-start.mjs` checks it.
- [ ] Deliver input only through Studio's run form, the dashboard Start screen, or a tmux shell. Read-only diagnostics are the run's `trace.duckdb` copied into the lane folder, `state.db` copied the same way, `journalctl --user`, and `git -C <folder> status`.
- [ ] Save every screenshot to `~/.local/state/julia-scratch/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.

## Bound the trace so Studio survives a long build (P1)

**Depends on.** None.

**Files.**

- [ ] Edit `machine/flow/mastra.mjs`.
- [ ] Edit `machine/flow/workflow.test.mjs`.
- [ ] Create `scripts/prove-trace-memory.mjs`.

**Build.**

- [ ] Start red. `scripts/prove-trace-memory.mjs` drives `openMastra` with a scripted model and 1 MB tool results for 60 steps and reaches the heap limit on trunk, the same growth that ended in the 7 Nov `oom-kill` at 16:01:14.
- [ ] Set `serializationOptions.maxStringLength` to 2000 in the `default` observability config inside `openMastra` (`reference-observability-tracing-configuration.md:62-70`).
- [ ] Set `excludeSpanTypes: [SpanType.PROCESSOR_RUN]` in the same config (`reference-observability-tracing-configuration.md:56`). The stock error processors `provider-history-compat` and `unsupported-file-handler` log the whole prompt at every step, so their spans grow with the square of the step count.

**You see.**

- [ ] `scripts/prove-trace-memory.mjs` prints a final heap under 150 MB at 60 steps.
- [ ] A practice run of at least 100 Lead steps ends with `systemctl --user show julia-studio -p NRestarts` unchanged.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `machine/flow/workflow.test.mjs` gains a case that a stored span input is at most 2000 characters per string. Run `node --test machine/flow/workflow.test.mjs`.

**Verify, live.** One independent live checker at the PR head, in a fresh session, never the author. It runs the shared lane runner for each scenario and judges only the saved evidence against the pass condition. One practice run per piece of work feeds every scenario that reads it.

- [ ] Scenario 1. Regression against trunk. The 60-step memory probe hits the heap limit on trunk, and at head it ends under 150 MB heap. Save `memory-trunk-head.png`. Pass when trunk dies at the limit and head stays under 150 MB. No Studio. Script in the shared runner.
- [ ] Scenario 2. A stored span keeps no string over 2,000 characters. Save `span-cap.png`. Pass when every string field in the trace is at most 2,000 characters. Reads head run 1.
- [ ] Scenario 3. A 100-step practice run finishes without a Studio restart, under 2.2 GB RSS. Save `long-run.png`. Pass when the run ends and the candidate PID is unchanged. Reads head run 1.
- [ ] Scenario 4. The trace after 100 steps stays under 50 MB. Save `trace-size.png`. Pass when `trace.duckdb` is under 50 MB. Reads head run 1.
- [ ] Scenario 5. A helper's span text is cut at 2,000 characters. Save `helper-span.png`. Pass when the helper's text field exists and is at most 2,000 characters. Reads head run 1.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Peak heap of the 60-step probe, and peak RSS of the candidate Studio over a 100-step run.
- [ ] Probe. `node --expose-gc scripts/prove-trace-memory.mjs` at trunk and head, interleaved three times each.
- [ ] Baseline. Record the trunk peak heap first. Trunk is expected to hit the 1.2 GB cap.
- [ ] Rule. Head fails if any head run exceeds 150 MB heap or the 100-step run exceeds 2.2 GB RSS.

**Review gate.** None. P1 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The owner squash-merges its own PR.

## Build in a worktree so the Studio folder stays on main (P2)

**Depends on.** None.

**Files.**

- [ ] Edit `machine/flow/agents.mjs`.
- [ ] Edit `machine/flow/steps.mjs`.
- [ ] Edit `machine/flow/agents.test.mjs`.

**Build.**

- [ ] Start red. `agents.test.mjs` asserts that the Lead's workspace base path is not the Studio folder. On trunk it is, which is how the Lead ran `git switch -c jul-341-apothecary` in `~/julia-builder` at 15:31:27 on 7 Nov.
- [ ] Give `start-build` a per-card worktree at `~/.local/state/julia-scratch/<card>-build`, created from `origin/main` only when it does not exist, and point the Lead and helper workspaces at it through the workspace `filesystem` and `sandbox` resolved per run.

**You see.**

- [ ] `git -C ~/julia-builder status` prints `On branch main` and a clean tree before, during, and after a practice build.
- [ ] The practice build's commits sit on its card branch in the build worktree.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `machine/flow/agents.test.mjs` gains cases for the worktree path and for a second start that reuses the same worktree. Run `node --test machine/flow/agents.test.mjs`.

**Verify, live.** One independent live checker at the PR head, in a fresh session, never the author. It runs the shared lane runner for each scenario and judges only the saved evidence against the pass condition. One practice run per piece of work feeds every scenario that reads it.

- [ ] Scenario 1. Regression against trunk. A practice build leaves the Studio folder off main at trunk; at head the folder stays on main and clean. Save `folder-branch.png`. Pass when trunk moves the folder and head does not. Reads the shared trunk run and head run 1.
- [ ] Scenario 2. Every Lead command runs in the build worktree. Save `cwd.png`. Pass when every `execute_command` span's cwd is the worktree. Reads head run 1.
- [ ] Scenario 3. A helper's file writes stay in the build worktree. Save `helper-writes.png`. Pass when every written path is inside it. Reads head run 1.
- [ ] Scenario 4. A second start reuses the worktree. Save `reuse.png`. Pass when the second start creates no second worktree. Reads head run 2.
- [ ] Scenario 5. A push from the worktree reaches origin. Save `push.png`. Pass when the card branch is on origin. Reads head run 1.
- [ ] Scenario 6. The Studio folder's reflog gains no checkout. Save `reflog.png`. Pass when no new checkout entry appears. Reads head run 1.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from the run form's start to the Lead's first model call. Trunk has no worktree step, so also measure the worktree step alone.
- [ ] Probe. Start the practice card five times at trunk and five at head, interleaved, and read the span start times.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Head fails if its median is more than 10 seconds over trunk, or if the worktree step alone exceeds 10 seconds.

**Review gate.** None. P2 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The owner squash-merges its own PR.

## Keep one models file and read it per run (P3)

**Depends on.** None.

**Files.**

- [ ] Edit `dashboard/lib/model-settings.js`.
- [ ] Edit `dashboard/lib/roles.js`.
- [ ] Edit `dashboard/app/start/[card]/start-screen.jsx`.
- [ ] Edit `dashboard/app/start/[card]/page.jsx`.
- [ ] Edit `machine/flow/role-models.mjs`.
- [ ] Edit `machine/flow/models.mjs`.
- [ ] Edit `machine/flow/agents.mjs`.
- [ ] Edit `scripts/check-model-picker.mjs`.
- [ ] Leave `~/.agents/pstack-models.md` untouched.

**Build.**

- [ ] Start red. `model-settings.test.mjs` asserts that an unchanged Save rewrites and reads back the files. On trunk `saveSettingsPatch` returns `wrote:false` at `dashboard/lib/model-settings.js:128`, and the screen still shows "Saved". `scripts/check-model-picker.mjs` asserts the next run uses a new pick with Studio left running. On trunk the 7 Nov save at 15:18:07 was followed by a Studio restart at 15:18:10.
- [ ] Keep `~/.config/julia/lead-role-models.md`, the picker's own file, as the machine's one role models file. The picker writes it and `readRoleModels` reads it. Leave `~/.agents/pstack-models.md` untouched for the sessions Todd runs by hand. The Lead's own model stays in `~/.config/julia/lead-model`. `dashboard/config/roles.json` stays the one source of defaults, and Save writes every role line, so neither reader falls back.
- [ ] Make Save send the full choice every time, write it, read it back, and show "Saved" only when the read-back equals the choice. The first page load shows no "Saved".
- [ ] Pass `model` and `agents` to the Lead and helpers as functions that read the files at each call (`reference-agents-agent.md:560`, `:562`). Delete the "Restart Studio" line from the screen.
- [ ] Make the picker show the id the machine resolves for each role, by sharing one resolver between `dashboard/lib/roles.js` and `machine/flow/role-models.mjs`.

**You see.**

- [ ] Todd changes the Lead's model, presses Save, and sees "Saved". He presses Save again with nothing changed and sees "Saved", and the file's modified time moves.
- [ ] The next practice run, with Studio left running, shows the new Lead model in its trace.
- [ ] Every role's model on the picker equals the model Studio shows for that agent.
- [ ] Save leaves `~/.agents/pstack-models.md` byte for byte unchanged.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `dashboard/lib/model-settings.test.mjs` gains cases for an unchanged Save that writes and reads back, for a failed read-back that returns no "Saved", and for a Save that writes only `~/.config/julia/lead-role-models.md` and `~/.config/julia/lead-model` and leaves `~/.agents/pstack-models.md` unchanged. `machine/flow/agents.test.mjs` gains a case that a changed file changes the next call's model without a new `createAgents`, and a case that `readRoleModels` ignores `~/.agents/pstack-models.md`. Run `npm --prefix dashboard test` and `node --test machine/flow/agents.test.mjs`.

**Verify, live.** One independent live checker at the PR head, in a fresh session, never the author. It runs the shared lane runner for each scenario and judges only the saved evidence against the pass condition. One practice run per piece of work feeds every scenario that reads it.

- [ ] Scenario 1. Regression against trunk. A changed Lead pick needs a Studio restart at trunk; at head the next run uses it with Studio left running. Save `next-run.png`. Pass when trunk shows the old model and head the new one. Reads the shared trunk run and head run 1.
- [ ] Scenario 2. An unchanged Save writes and reads back, and the file mtime moves. Save `unchanged-save.png`. Pass when Saved appears and mtime changes. Reads head run 1.
- [ ] Scenario 3. A fresh page shows no Saved, and a failed read-back shows an error. Save `failed-save.png`. Pass when the first load has no Saved and a read-only file shows an error. Reads head run 1.
- [ ] Scenario 4. Every role on the picker matches Studio. Save `picker-vs-studio.png`. Pass when all 17 roles match. Reads head run 1.
- [ ] Scenario 5. pstack's file stays unchanged and the picker's file is the only one read. Save `one-file.png`. Pass when a pstack edit does not change the run and the picker file does. Reads head run 1.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from pressing Save to "Saved", and time from the run form's start to the Lead's first model call.
- [ ] Probe. Ten saves and five run starts at trunk and at head, interleaved.
- [ ] Baseline. Record the trunk medians first.
- [ ] Rule. Head fails if the Save median exceeds 1 second, or if the run-start median is more than 2 seconds over trunk.

**Review gate.** The operator reviews before merge.

- [ ] Run the normal candidate Studio with the dashboard under the 2.2 GB cap. Do not substitute a lighter page, a reduced route, or a screenshot-only path.
- [ ] Copy lane 1, 2, and 5 screenshots into `docs/agents/mechanical-layer/media/P3-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change on a lane VM. Save it as `docs/agents/mechanical-layer/media/P3-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The owner squash-merges after the operator's click.

## Tell Todd about trouble within a minute (P4)

**Depends on.** None.

**Files.**

- [ ] Create `machine/flow/notice.mjs`.
- [ ] Create `machine/flow/notice.test.mjs`.
- [ ] Edit `machine/flow/agents.mjs`.
- [ ] Edit `src/mastra/index.ts`.
- [ ] Edit `scripts/machine-programs.mjs`.

**Build.**

- [ ] Start red. `notice.test.mjs` replays the 7 Nov 16:10:35 `AI_APICallError: The usage limit has been reached` through the Lead and expects one notice. On trunk the run failed and Todd got nothing.
- [ ] Add one `notice` function that posts a card comment mentioning Todd and sets his `issueReminder` 30 seconds later, through the existing path in `scripts/linear-cli.mjs` and `dashboard/lib/ping.js:40-49`. The reminder uses Linear's `at` time, so no timer is needed.
- [ ] Add one error processor with `processAPIError` to the Lead and every helper (`docs-agents-processors.md:115-131`). It sends a notice for a usage limit, a 429 after the last retry, a refused or unknown model, and an authorization block.
- [ ] Add an output processor with `processOutputStep` that sends a notice when `finishReason` is `content-filter`, because a content refusal never reaches `processAPIError`.
- [ ] At Studio boot, send a restart notice for each `card-path` run that storage still shows as `running`.

**You see.**

- [ ] A forced usage-limit error reaches Todd's Linear inbox within a minute, naming the card, the model, and the error.
- [ ] Killing the candidate Studio mid-run reaches Todd as a restart notice within a minute of the restart.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `machine/flow/notice.test.mjs` covers usage limit, 429, unknown model, authorization block, content filter, and boot restart, each sending one notice. Run `node --test machine/flow/notice.test.mjs`.

**Verify, live.** One independent live checker at the PR head, in a fresh session, never the author. It runs the shared lane runner for each scenario and judges only the saved evidence against the pass condition. One practice run per piece of work feeds every scenario that reads it.

- [ ] Scenario 1. Regression against trunk. A usage limit at trunk sends nothing; at head one notice reaches Todd within 60 seconds. Save `usage-limit.png`. Pass when trunk sends none and head sends one. Held. Diagnosis only, no run in this batch.
- [ ] Scenario 2. A refused model reaches Todd within 60 seconds. Save `refused-model.png`. Pass when the notice names the model and arrives in time. Held. Diagnosis only, no run in this batch.
- [ ] Scenario 3. A restart mid-run reaches Todd within 60 seconds. Save `restart.png`. Pass when the restart notice arrives after the new process. Held. Diagnosis only, no run in this batch.
- [ ] Scenario 4. A 429 that recovers sends no notice; one that fails every retry sends one. Save `429.png`. Pass when the recovered case is silent and the failed case sends one. Held. Diagnosis only, no run in this batch.
- [ ] Scenario 5. A content refusal sends a notice. Save `content-filter.png`. Pass when the notice arrives within 60 seconds. Held. Diagnosis only, no run in this batch.
- [ ] Scenario 6. A repeat error sends one notice per error and no more. Save `repeat.png`. Pass when each error has exactly one notice. Held. Diagnosis only, no run in this batch.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Seconds from the error span's end, or from the new process's start, to the reminder in Todd's inbox. Trunk sends no notice, so also time the notice call alone.
- [ ] Probe. Five forced usage limits and five restarts at head. Trunk runs the same five of each and records that no notice arrives.
- [ ] Baseline. Record trunk's result first, which is no notice.
- [ ] Rule. Head fails if any notice takes more than 60 seconds, or if the notice call alone exceeds 5 seconds.

**Review gate.** None. P4 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The owner squash-merges its own PR.

## Give helpers their full budget and a written report (P5)

**Depends on.** P3 and P4.

**Files.**

- [ ] Edit `machine/flow/agents.mjs`.
- [ ] Edit `machine/flow/agents.test.mjs`.

**Build.**

- [ ] Start red. `agents.test.mjs` has the Lead pass `maxSteps` 12 to a helper that keeps calling tools, as the 7 Nov Lead did with 18, 15, and 12. On trunk the helper stops at 12 with empty text.
- [ ] Add `delegation.onDelegationStart` to the Lead's `defaultOptions`, returning `modifiedMaxSteps` equal to the helper's own budget (`docs-subagents.md:68-78`).
- [ ] Add a `processInputStep` processor to every helper that returns `toolChoice: 'none'` on the last step (`docs-agents-processors.md:260-269`). Steps count from 0, so the last step is the budget minus one.
- [ ] Add `delegation.onDelegationComplete`. When the helper's text is empty, it returns a `resultText` that names a machine fault (`docs-subagents.md:136-144`), stamps a `machineFault` attribute on the span, and sends a P4 notice.

**You see.**

- [ ] Every helper span in a practice run ends with text.
- [ ] A helper forced to end empty shows as a machine fault in the trace and reaches Todd as a notice.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `machine/flow/agents.test.mjs` gains cases for the budget override, the last-step text, and the machine fault. Run `node --test machine/flow/agents.test.mjs`.

**Verify, live.** One independent live checker at the PR head, in a fresh session, never the author. It runs the shared lane runner for each scenario and judges only the saved evidence against the pass condition. One practice run per piece of work feeds every scenario that reads it.

- [ ] Scenario 1. Regression against trunk. A helper cut to 12 steps ends empty at trunk; at head it uses its full budget and ends with text. Save `empty-helpers.png`. Pass when head has no empty helper. Reads the shared trunk run and head run 1.
- [ ] Scenario 2. The Lead's maxSteps cannot cut the helper's budget. Save `budget.png`. Pass when each helper's budget equals its own setting. Reads head run 1.
- [ ] Scenario 3. The last step sends toolChoice none and ends with text. Save `last-step.png`. Pass when the last step has no tool call and has text. Reads head run 1.
- [ ] Scenario 4. An empty report is a machine fault in the trace and a notice. Save `fault.png`. Pass when the span carries machineFault and Todd gets one notice. Reads head run 2.
- [ ] Scenario 5. A panel helper ends with text and the Lead quotes its report. Save `panel-helper.png`. Pass when the panel helper has text and the Lead's next step quotes it. Reads head run 1.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Helper model calls per delegation and helper wall time per delegation.
- [ ] Probe. The practice card at trunk and head, three runs each, interleaved.
- [ ] Baseline. Record the trunk numbers first.
- [ ] Rule. Head fails if a helper exceeds its own budget, or if the median helper wall time exceeds 15 minutes.

**Review gate.** None. P5 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The owner squash-merges its own PR.

## Refuse other coding programs from the build shell (P6)

**Depends on.** P5.

**Files.**

- [ ] Edit `machine/flow/agents.mjs`.
- [ ] Create `machine/flow/refused-programs/` with one refusing script per program name.
- [ ] Edit `machine/flow/agents.test.mjs`.

**Build.**

- [ ] Start red. `agents.test.mjs` sends `codex exec "do the card"` through the Lead's `execute_command`, as the Lead did nine times on 7 Nov from 15:30:21. On trunk it runs.
- [ ] Put `machine/flow/refused-programs/` first on the `PATH` of the Lead and helper sandboxes. Each script, named `codex`, `claude`, `cursor-agent`, `mastracode`, `opencode`, `gemini`, `aider`, and `commandcode`, prints a refusal and exits 126.
- [ ] Add a workspace `tools.hooks.beforeToolCall` that returns `{ proceed: false, output }` for any command naming those programs, including by absolute path or through `npx` (`reference-workspace-workspace-class.md:68`, `:185-200`).

**You see.**

- [ ] A planted `codex exec` in a practice run is refused, and the refusal shows in the run's trace.
- [ ] `~/.codex/sessions` holds no session from the practice run.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `machine/flow/agents.test.mjs` gains cases for the plain name, `bash -c`, a split quote, a script file, base64 through `eval`, an absolute path, and `npx @openai/codex`, each refused. Git, npm, and node still run. Run `node --test machine/flow/agents.test.mjs`.

**Verify, live.** One independent live checker at the PR head, in a fresh session, never the author. It runs the shared lane runner for each scenario and judges only the saved evidence against the pass condition. One practice run per piece of work feeds every scenario that reads it.

- [ ] Scenario 1. Regression against trunk. A planted codex exec runs at trunk and is refused at head. Save `planted-codex.png`. Pass when trunk runs it and head refuses it. Reads trunk run 2 (planted codex) and head run 1.
- [ ] Scenario 2. An absolute path is refused. Save `abs-path.png`. Pass when the hook refuses `/usr/local/bin/codex`. No Studio. Script in the shared runner.
- [ ] Scenario 3. npx is refused. Save `npx.png`. Pass when `npx @openai/codex` is refused. No Studio. Script in the shared runner.
- [ ] Scenario 4. A script file calling codex exits 126. Save `script-file.png`. Pass when the refusing script answers with exit 126. No Studio. Script in the shared runner.
- [ ] Scenario 5. A helper's delegated codex is refused. Save `helper-codex.png`. Pass when the helper's codex call is refused. Reads head run 1.
- [ ] Scenario 6. Git, npm, and node still run, and `~/.codex/sessions` gains nothing. Save `normal-build.png`. Pass when the build runs and no codex session lands in the run window. Reads head run 1.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall time of one `execute_command` for `git status` in the build worktree.
- [ ] Probe. One hundred calls at trunk and head, interleaved in blocks of ten.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Head fails if its median is more than 20 ms over trunk.

**Review gate.** None. P6 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The owner squash-merges its own PR.

## Resume an interrupted build from its last step (P7)

**Depends on.** P1, P4, and P6.

**Files.**

- [ ] Edit `machine/flow/agents.mjs`.
- [ ] Edit `machine/flow/steps.mjs`.
- [ ] Edit `machine/flow/mastra.mjs`.
- [ ] Edit `machine/flow/workflow.test.mjs`.

**Build.**

- [ ] Start red. `workflow.test.mjs` kills a child process mid-build and restarts it. On trunk the build step replays from model step 0, as the 7 Nov run `ffc3d864` did at 16:01:59 in a second trace.
- [ ] Wrap the Lead with `createDurableAgent` and a `shouldPersistSnapshot` that includes `running` (`docs-harness-durable-agents.md:283`, `:293-306`). Keep P5's delegation hooks in `defaultOptions.delegation`, which Mastra merges back after recovery (`:289`). Hook closures passed per call are not restored.
- [ ] Replace `createStep(agents.build)` with a build step that uses the run id `<workflow run id>-build`. If `listActiveRuns()` shows that id, the step calls `recover()`. Otherwise it starts the run. Keep `recovery.durableAgents` off, so the stock workflow sweep (`docs-workflows-overview.md:487-503`) is the one thing that restarts a card.
- [ ] Set `maxBatchSize: 1` on `MastraStorageExporter`, so the steps before a kill reach the trace. DuckDB supports only the event-sourced strategy, so batch size is the one setting that does this.

**You see.**

- [ ] A Studio restart mid-build resumes the build at its last saved step.
- [ ] The run's trace shows each earlier step once.
- [ ] The first helper call after a resume runs its full step budget and ends with text.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `machine/flow/workflow.test.mjs` gains a SIGKILL-and-restart case that counts model steps and finds each earlier one once. Run `node --test machine/flow/workflow.test.mjs`.

**Verify, live.** One independent live checker at the PR head, in a fresh session, never the author. It runs the shared lane runner for each scenario and judges only the saved evidence against the pass condition. One practice run per piece of work feeds every scenario that reads it.

- [ ] Scenario 1. Regression against trunk. A kill restarts at step 0 at trunk; at head it resumes at step 20 or 21. Save `resume.png`. Pass when trunk restarts at 0 and head resumes at 20 or 21. Reads trunk run 3 (build killed partway) and head run 1.
- [ ] Scenario 2. Every earlier step shows once. Save `once.png`. Pass when no step span repeats. Reads head run 1.
- [ ] Scenario 3. A kill during a helper delegation replays only that delegation, and the first helper call after resume has full budget and text. Save `helper-kill.png`. Pass when only that delegation replays and the next helper call has its full budget and text. Reads head run 2.
- [ ] Scenario 4. A double kill resumes both times and finishes. Save `double-kill.png`. Pass when both resumes land and the build finishes. Reads head run 3.
- [ ] Scenario 5. A kill while the card waits for Todd does not rerun the build. Save `waiting-kill.png`. Pass when the wait comes back unanswered and the build does not rerun. Reads head run 4.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Seconds from the new Studio process's start to the resumed build's next model call, and the cost of the build's model steps after a kill.
- [ ] Probe. Three kills at step 20 at trunk and at head, interleaved.
- [ ] Baseline. Record the trunk numbers first. Trunk repeats 20 steps.
- [ ] Rule. Head fails if it repeats more than one model step, or if the resume takes more than 60 seconds.

**Review gate.** None. P7 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The owner squash-merges its own PR.

## Fail CI when a pstack update breaks an enforced line (P8)

**Depends on.** None.

**Files.**

- [ ] Create `docs/agents/mechanical-layer/pstack-anchors.json`.
- [ ] Create `scripts/check-pstack-anchors.mjs`.
- [ ] Create `scripts/check-pstack-anchors.test.mjs`.
- [ ] Edit `.github/workflows/ci.yml`.

**Build.**

- [ ] Start red. A test PR that changes "explicit model per role" in `.agents/skills/poteto-mode/SKILL.md` passes CI on trunk. Nothing reads the anchors today.
- [ ] Write the seven rows of `pstack-inventory.md` as data in `pstack-anchors.json`, each with its rule, file, anchor, and enforcing code.
- [ ] `check-pstack-anchors.mjs` fails when an anchor is missing or appears more than once in its file, and names the rule.
- [ ] On a PR that changes `.agents/skills/PSTACK-SOURCE.md`, the script diffs the installed pstack files against the base commit and lists each added line under its `##` heading in `SKILL.md` and its `###` heading in the playbooks that no anchor covers. CI posts the list as a PR comment.

**You see.**

- [ ] A test PR that edits one anchored pstack line shows the anchor check red naming the rule, and the pin check red because the pin is unchanged.
- [ ] A test PR that adds pstack text shows that text in a PR comment.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `scripts/check-pstack-anchors.test.mjs` covers a missing anchor, a doubled anchor, an untouched tree, and added text under a heading. Run `node --test scripts/check-pstack-anchors.test.mjs`.

**Verify, live.** One independent live checker at the PR head, in a fresh session, never the author. It runs the shared lane runner for each scenario and judges only the saved evidence against the pass condition. One practice run per piece of work feeds every scenario that reads it.

- [ ] Scenario 1. Regression against trunk. A test PR that edits an anchor passes on trunk and fails at head, with the anchor check naming the rule. The pin red is accepted. Save `anchor-edit.png`. Pass when trunk has no anchor step, head names the rule, and both results are recorded. No Studio. CI script in the shared runner.
- [ ] Scenario 2. A removed anchor fails naming the rule. Save `anchor-removed.png`. Pass when CI names the rule. No Studio. CI script in the shared runner.
- [ ] Scenario 3. A doubled anchor fails. Save `anchor-doubled.png`. Pass when CI names the rule. No Studio. CI script in the shared runner.
- [ ] Scenario 4. New pstack text under a heading is listed in the PR comment. Save `new-text.png`. Pass when the comment lists the added line under its heading. No Studio. CI script in the shared runner.
- [ ] Scenario 5. A non-pstack change posts no comment. Save `no-pstack.png`. Pass when no comment is posted. No Studio. CI script in the shared runner.
- [ ] Scenario 6. A moved anchor still passes. Save `moved.png`. Pass when CI passes. No Studio. CI script in the shared runner.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall time of the hygiene job. Trunk lacks the anchor step, so also time the script alone.
- [ ] Probe. Three CI runs at trunk and head, interleaved, read from `gh run view`.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Head fails if the hygiene job's median grows by more than 30 seconds, or if the script alone exceeds 10 seconds.

**Review gate.** None. P8 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The owner squash-merges its own PR.

## Prove the card on a practice run with Shipping by hand (P9)

**Depends on.** P1, P2, P3, P4, P5, P6, P7, and P8.

**Files.**

- [ ] Create `docs/agents/mechanical-layer/proof/` with the trace queries and their outputs.
- [ ] Create `docs/scorecards/JUL-342.md`.

**Build.**

- [ ] Create a throwaway practice card in Linear. Set every pick on the picker to the free model. Start the card from Studio's run form on main.
- [ ] Run Shipping by hand, from a fresh agent given only the card's criteria, its UAT steps, and the code, on `gpt-6-luna`, moving to `gpt-6.1-terra` if Luna misses a real failure. Record its verdict per criterion.
- [ ] Hand the UAT steps to Todd with the preview address.

**You see.**

- [ ] Shipping's verdict lists all 13 criteria with what it saw.
- [ ] Todd follows the four UAT steps and says yes.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Every test file named in P1 to P8 passes on main. Run `node scripts/test-owners.mjs --run local`.

**Verify, live.** One independent live checker at the PR head, in a fresh session, never the author. It runs the shared lane runner for each scenario and judges only the saved evidence against the pass condition. One practice run per piece of work feeds every scenario that reads it. All scenarios below read this piece's one head practice run.

- [ ] Scenario 1. Regression against trunk. The 7 Nov red queries show each failure on JUL-341 and none on the practice trace. Save `seven-nov.png`. Pass when JUL-341 shows each failure and the practice trace shows none. Reads head run 1.
- [ ] Scenario 2. Every model in the practice trace equals Todd's pick. Save `models.png`. Pass when each model matches its role. Reads head run 1.
- [ ] Scenario 3. The run has at least 100 Lead steps and no Studio restart. Save `long.png`. Pass when the step count is at least 100 and NRestarts is unchanged. Reads head run 1.
- [ ] Scenario 4. A restart mid-run resumes, each earlier step once, and a notice arrives within 60 seconds. Save `restart.png`. Pass when the run resumes, no step repeats, and the notice arrives. Reads head run 1.
- [ ] Scenario 5. The Studio folder stays on main and clean. Save `folder.png`. Pass when it is on main and clean through the run. Reads head run 1.
- [ ] Scenario 6. Every helper span ends with text. Save `helpers.png`. Pass when no helper ends empty. Reads head run 1.
- [ ] Scenario 7. A planted codex exec is refused and no codex session lands. Save `codex.png`. Pass when the trace shows the refusal and the sessions gain nothing. Reads head run 1.
- [ ] Scenario 8. Shipping's verdict lists all 13 criteria and the UAT steps pass. Save `uat-run.png`. Pass when the verdict has 13 criteria and the picker and run UAT steps pass. Reads head run 1.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Peak Studio RSS over the practice run, and the run's cost from the scorecard.
- [ ] Probe. `systemctl --user show julia-studio -p MemoryPeak` before and after the run, and `node scripts/scorecard.mjs JUL-342`. The 7 Nov JUL-341 run is the trunk side.
- [ ] Baseline. Record the 7 Nov peak first, which was 1.8 GB before the kill.
- [ ] Rule. The practice run fails if its peak RSS exceeds 2.2 GB.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, 3, and 8 screenshots into `docs/agents/mechanical-layer/media/P9-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the practice run on a lane VM. Save it as `docs/agents/mechanical-layer/media/P9-review.mp4`.
- [ ] Post the screenshots and the video in chat, and send the UAT steps to the operator. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The owner squash-merges after Todd's UAT yes. Main CI is green on the merge commit, and JUL-342 moves to Complete with that commit in a comment.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names.
- [ ] Run the retro skill on each slice's session after it merges, per AGENTS.md.

## Appendix A. Prototype evidence

Every prototype ran against `@mastra/core` 1.82.0 with a scripted `MockLanguageModelV3` from `ai/test`, no network, and no paid model. The scripts and their output files are in the scratch folders named below. They are throwaway and are not on a branch.

**Delegation and command gate.** Folder `~/.local/state/julia-scratch/jul-342-proto-delegation/`.

- `q1-modified-max-steps.mjs` measured that `modifiedMaxSteps` in the Lead's `defaultOptions` reaches helpers set through `agents`. With the hook, a Lead asking for 12 steps gave 30 helper calls. Without it, the helper stopped at 12 with empty text, which is the 7 Nov failure.
- `q2-last-step-tool-choice.mjs` measured that `stepNumber` counts from 0 and that `toolChoice: 'none'` on the last step ends the helper with text. `ProcessInputStepArgs` carries no `maxSteps`, so the processor needs the same number the hook sets.
- `q3-command-gate.mjs` measured that `enabled: false` removes the shell, which also stops git and npm. A `beforeToolCall` refusal reaches the model as the tool result and shows in the trace. The regex alone missed split quotes, a script file, an absolute path, and base64. The refusing scripts on `PATH` caught all but the absolute path. Both layers together caught every case tried. `npx` was not run, because it needs the network.
- `q4-empty-text-signal.mjs` measured that `onDelegationComplete` sees `finishReason=tool-calls` and empty text, and that `resultText` replaces what the Lead sees.

**Resume, memory, and errors.** Folder `~/.local/state/julia-scratch/jul-342-proto-resume/`.

- `p1-workflow-restart.mjs` measured that the stock boot sweep restarts the build step from model step 0, with every earlier step twice in the trace.
- `p2-durable.mjs` measured that `createStep(durable)` with `durableAgents: 'auto'` ran two copies of the build. Our own adopt-or-start step with `durableAgents` off repeated only the tool call in flight. A helper delegation in flight replays whole. Each earlier step showed once, but the last exporter batch before the kill was lost.
- `p3-memory.mjs` measured quadratic heap growth from span serialization, ending in a heap-limit crash and one kernel kill (exit 137). With `serializationOptions.maxStringLength` 2000 the heap ended near 100 MB.
- A rerun under a 1 GB memory cap, `p3b-memory.mjs` with output `q3b.out`, measured trace bytes, not heap, growing with the square of the step count. The two stock processor spans carried it. At 16 steps with 20 KB tool results the trace was 11162 KB, 1325 KB with `maxStringLength` 2000, and 360 KB with `excludeSpanTypes: [PROCESSOR_RUN]`. The heap grew about 300 KB per step whatever the payload, so what drove the 7 Nov peak stays a guess. The leading guess is the observe stream serializing one chunk past the V8 string limit, which matches the 158 `Invalid string length` lines in the 7 Nov journal.
- The rerun's `q2b-batch1.out` measured that `maxBatchSize: 1` keeps every finished step's span after a kill, while the default batching lost steps 0 to 3.
- The rerun's `q4.out` measured that a plain 429 is retried twice before it fails, while the usage-limit 429 fails at once. A content refusal returns `status=success` with empty text and reaches only `processOutputStep`.
- `p4-errors.mjs` measured that `processAPIError` sees a 429, a usage limit, an unknown model, and a 403 within about 25 ms. A content-filter refusal does not throw and shows only in the span.

**7 Nov evidence.** Folder `~/.local/state/julia-scratch/jul-342-forensics/`, queried with `q.mjs` over copies of the live Studio `state.db` and `trace.duckdb` from `src/mastra/public/.artifacts/flow/studio/`.

- Helpers `c94ec9dc25b6091a`, `3dd98706a64e9215`, and `601683f63772badb` ran with `maxSteps` 18, 15, and 12, ended `stopReason=max_steps`, and returned empty text.
- The Lead ran `codex exec` nine times from 15:30:21 on gpt-5.4, gpt-6-astra, gpt-6-luna, and gpt-6.1-sol, plus `mastracode` on DeepSeek, with rollout files in `~/.codex/sessions/2026/11/07/`.
- Studio was OOM-killed at 16:01:14 with a 1.8 GB peak. Trace 1 stored 394 MB of span text in 34 minutes.
- Run `ffc3d864` started again from step 0 at 16:01:59 in trace `067b4bce`.
- The reflog shows the Studio folder moved from main to `jul-341-apothecary` at 15:31:27.
- The Lead failed with `The usage limit has been reached` at 16:10:35, and no notice was sent.

**Unproven.** These are settled by the first box of the slice that names them.

- Whether Studio's agent page shows the id that a `model` function resolves, or only shows "dynamic". P3 lane 5 settles it.
- Whether `agents` as a function lets a panel role change its helper count without a restart. P3 lane 6 settles it.
- Whether `npx @openai/codex` gets past the refusing scripts. P6 lane 4 settles it.
- Whether a real provider can return empty text under `toolChoice: 'none'`. P5 lane 4 covers the case either way.

## Appendix B. Alternatives rejected

- Turning off the shell with `enabled: false` stops git, npm, and tests, so the Lead could not build. P6 uses the two-layer gate instead.
- A `beforeToolCall` regex alone missed four spellings in the prototype. P6 pairs it with refusing scripts on `PATH`.
- The stock `createStep(durable)` with `durableAgents: 'auto'` ran two copies of one build. P7 uses its own adopt-or-start step.
- Turning off boot recovery leaves a crashed card stuck in `running`. P7 keeps the stock sweep and makes the build step resume.
- `ToolCallFilter` did not bound memory in the prototype. P1 uses `serializationOptions`.
- Restarting Studio after each pick is what the end state removes. P3 resolves models per call instead.
- Writing the machine's picks into `~/.agents/pstack-models.md` would edit the file pstack uses for hand-run sessions and leave two files to drift. P3 keeps the picker's file as the machine's one file and leaves pstack's untouched.
- Folding the Lead's model into the picker's role file would add a line the picker does not define. The Lead's model stays in its own one-line setting.

## Appendix C. Risks

- P3. Studio may show a `model` function as "dynamic" instead of an id. If it does, the criterion that the picker and Studio show the same model fails, and the owner reports it as a finding before building around it.
- P3. The Lead's pstack instructions name `~/.agents/pstack-models.md`, which the machine no longer writes. A hand edit there could change what the Lead asks for, but not what runs. P6 keeps the Lead from reaching any other model.
- P2. A build worktree left from a crashed run must be reused, not duplicated. P2 lane 4 checks it.
- P4. Linear does not notify Todd about a comment posted with his own key. The `issueReminder` is the notice that reaches him, per ADR 0024.
- P4 and P7. A restart notice must not repeat for a run that was already reported. P4 lane 8 checks repeats.
- P7. A delegation in flight replays whole after a kill, so a helper's file writes can repeat. The build worktree's git history shows any duplicate.
- P6. Shell gating cannot be complete. A determined model can write its own client. The real fix is that P3 and P5 remove the reason to route around the helpers.
- P9. Tests of the machine run on free models only. The practice card is throwaway, and no real card runs while a slice is unmerged.

## Appendix D. Links and reading list

Read `docs/agents/mechanical-layer/end-state.md`, `pstack-inventory.md`, and `mastra-1.82-feature-check.md` before editing. Every slice that changes `machine/flow` reads `docs/agents/server-runbook.md` and runs `.agents/skills/interrogate/SKILL.md` on its diff. P3 and P7 also run `.agents/skills/how/SKILL.md`, because they change how Studio resolves models and how a build resumes. The decision trail follows `.agents/skills/show-me-your-work/SKILL.md` and lives in `docs/agents/mechanical-layer/trail.md`.

The card asks for a map from each criterion and each anchor to its Mastra 1.82.0 doc and to the code that does the work. Doc paths are under `node_modules/@mastra/core/dist/docs/references/`.

| Criterion | Slice | Mastra doc | Code |
| --- | --- | --- | --- |
| Every model call runs on Todd's pick for its role | P3, P6 | `reference-agents-agent.md:560`, `:562` | `machine/flow/role-models.mjs`, `machine/flow/models.mjs` |
| A planted coding program is refused and shows in the trace | P6 | `reference-workspace-workspace-class.md:185-200`, `reference-workspace-local-sandbox.md:49` | `machine/flow/agents.mjs` sandbox `env.PATH` and `hooks` |
| A saved pick reaches the next run with Studio left running | P3 | `reference-agents-agent.md:560`, `:562`, `docs-server-request-context.md:127-153` | `machine/flow/agents.mjs` |
| Save records every time, and "Saved" follows the record | P3 | None. Dashboard code | `dashboard/lib/model-settings.js`, `start-screen.jsx` |
| The picker and Studio show the same model | P3 | `reference-agents-agent.md:560` | shared resolver in `dashboard/lib/roles.js` and `machine/flow/role-models.mjs` |
| Every helper ends with a written report on its full budget | P5 | `docs-subagents.md:68-78`, `docs-agents-processors.md:260-269` | Lead `defaultOptions.delegation`, helper `inputProcessors` |
| An empty report is a machine fault in the trace and a notice | P5, P4 | `docs-subagents.md:136-144` | `onDelegationComplete`, `machine/flow/notice.mjs` |
| A long build ends with Studio running | P1 | `reference-observability-tracing-configuration.md:62-68` | `machine/flow/mastra.mjs` |
| A restarted build resumes at its last step, each step once | P7 | `docs-workflows-overview.md:487-503`, `docs-harness-durable-agents.md:283-306`, `:363-368` | build step in `machine/flow/steps.mjs` |
| The Studio folder stays on main | P2 | None. Workspace base path | `machine/flow/agents.mjs`, `start-build` |
| A restart, refused model, or usage limit reaches Todd within a minute | P4 | `docs-agents-processors.md:115-131` | `machine/flow/notice.mjs`, `src/mastra/index.ts` |
| A changed or removed anchor fails CI naming the rule | P8 | None. Repo script | `scripts/check-pstack-anchors.mjs` |
| New pstack text is listed in its own PR | P8 | None. Repo script | `scripts/check-pstack-anchors.mjs`, `.github/workflows/ci.yml` |

| Anchor | File and line | Enforced by |
| --- | --- | --- |
| explicit model per role | `.agents/skills/poteto-mode/SKILL.md:96` | P6 gate, P3 per-call models |
| `Mandatory: no skip-with-reason escape` | `.agents/skills/poteto-mode/playbooks/feature.md:12` | P6, so a helper is the Lead's only route to code |
| Delegate code-writing to a subagent using your configured feature model | `.agents/skills/poteto-mode/playbooks/feature.md:12` | P3 role-to-model map |
| Defaults for every | `.agents/skills/poteto-mode/SKILL.md:96` | P3, one models file with `roles.json` defaults |
| waits on a nested agent | `.agents/skills/poteto-mode/playbooks/feature.md:12` | helpers have no `agents`, unchanged |
| Fresh subagents by default. | `.agents/skills/poteto-mode/SKILL.md:102` | stock Mastra, one thread per delegation |
| Write the resume note off-context. | `.agents/skills/poteto-mode/playbooks/pause-safely.md:8` | P7 resume |

The bug-fix and refactoring playbooks word the delegation line differently from `feature.md:12`. P8 anchors each file's own sentence, read at the pinned commit before the anchor data is written.
