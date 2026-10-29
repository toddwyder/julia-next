# JUL-276 Start screen plan

Todd opens the dashboard on the server, sees his Ready cards, opens one, picks models and effort, presses Start, watches the build run, and stops it if he wants. Work lands as nine small PRs, each proven on the screen he uses. The dashboard is its own app in its own folder, run as a service, never part of Julia's Vercel app (decision 0022).

- PR-1 the dashboard app folder, with Ready cards on one page
- PR-2 run it as a service, updating itself from main between builds
- PR-3 the weekly model sweep, and the Start screen read only
- PR-4 model, group, panel and effort controls that change things
- PR-5 start with last settings
- PR-6 spike, no screen, effort reaches every helper and cost recording lands
- PR-7 start and stop a real build
- PR-8 did not start, try again, finish ping, several builds at once. PR-9 Julia's existing Sentry project and Axiom dataset, with every dashboard error and log event labelled `dashboard`.

## How to read this

One box is one unit of work and every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run or a SHA. The body is a how-to, the appendices explain and record.

The program runs `playbooks/autopilot-full.md` from `.agents/skills/poteto-mode`. Each PR has one owner who carries it from build to merge. Todd's yes is a gate on every PR that changes a screen, which is all of them except PR-6. PR-6 has no screen and needs his explicit approval before it starts, which he gave on 28 October 2026.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State this plan to Todd and stop. Start only on his explicit go.
- [ ] Read these from trunk at program start and again at every checkpoint.
  - [ ] `git show origin/main:.agents/skills/poteto-mode/playbooks/autopilot-full.md`
  - [ ] `git show origin/main:.agents/skills/poteto-mode/playbooks/multi-phase-plan.md`
  - [ ] `git show origin/main:.agents/skills/swarm/SKILL.md`
  - [ ] `git show origin/main:.agents/skills/verify-julia/SKILL.md`
  - [ ] `git show origin/main:.agents/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `git show origin/main:.agents/skills/poteto-mode/playbooks/shipping.md`
  - [ ] `git show origin/main:docs/plans/path-forward.md`
  - [ ] `git show origin/main:CODING_STANDARDS.md`
- [ ] Retire the hourly tick. The `/loop 1h` cadence the playbook names does not exist in Mastra Code, which has no timer, so audit at each PR checkpoint instead. The checkpoints are PR opened, verdict given, and merge.
- [ ] At each checkpoint, audit the operation against the playbook and fix drift on the spot. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement at once.
- [ ] Post a short status message to Todd at a checkpoint only when it found a change that no earlier message reported, such as a PR opened, a code-ready head, a verdict, a merge, a stuck lane and the action taken, a blocker added or cleared, or a decision only he can make. Name every such change and nothing else. If the audit found none, post nothing.
- [ ] On Todd's hold or stand-down, send every owner a zero-writes order at once.
- [ ] Reuse Julia's existing Sentry project and Axiom dataset, per Todd's revised 28 October decision 0022 and JUL-276's updated done-means criterion. Retrieve their existing key references from the `Julia agents` 1Password vault. The agent adds `DASHBOARD_SENTRY_DSN`, `DASHBOARD_AXIOM_TOKEN` and `DASHBOARD_AXIOM_DATASET` to `scripts/julia-agents.env` as references to those existing resources, never literal secrets. Label every dashboard error and log event `dashboard`. Create no new project or dataset and request no setup from Todd. PR-9 has no Todd setup dependency.
- [ ] Create the two practice cards yourself, in the Dashboard project, titled `Practice: ...`, each a docs-only change, and cancel them when JUL-276 is complete. Todd approved this on 28 October 2026.
- [ ] Send dashboard-down pings to Todd as Linear notifications through the existing comment-and-reminder path on JUL-276. Do not create or keep open a `Dashboard service` issue. Verify that the notification still reaches Todd after JUL-276 is Complete; if that path cannot notify him, report the limitation before choosing another target.
- [ ] Create two git worktrees of `main` on the server for the program, one under `/home/ubuntu/julia-dashboard` as the deployed dashboard and one under `/home/ubuntu/verifications/jul-276` as the lane sandbox. Record both paths in the decision trail.

### Spawn owners

- [ ] Spawn one owner per PR with the lifecycle `autopilot-full` names. Owners branch from `main`, never stacked.
- [ ] Follow this dependency graph. Start a child only after its parent merges.
  - [ ] PR-1 and PR-6 are independent and first. PR-1 needs no settings, PR-6 needs no screen.
  - [ ] PR-2 after PR-1.
  - [ ] PR-3 after PR-2.
  - [ ] PR-4 after PR-3.
  - [ ] PR-5 after PR-4.
  - [ ] PR-7 after PR-5 and PR-6.
  - [ ] PR-8 after PR-7.
  - [ ] PR-9 after PR-8. Reuse the existing vault keys without waiting on Todd.
- [ ] Hold the file boundaries. PR-1 owns `dashboard/app/**`, `dashboard/lib/linear.js`, `dashboard/docs/**`, `dashboard/tests/**`, `dashboard/playwright.config.mjs`, `dashboard/package.json`, `dashboard/package-lock.json` and the reading commands in `scripts/linear-cli.mjs`. PR-2 owns `dashboard/ops/julia-dashboard*.{service,timer}`, `dashboard/scripts/install-service.mjs`, `dashboard/scripts/update.mjs`, `dashboard/scripts/watchdog.mjs`, `dashboard/lib/ping.js`, `dashboard/app/api/health/**` and `docs/agents/server-runbook.md`. PR-3 owns `dashboard/scripts/sweep.mjs`, `dashboard/lib/models.js`, `dashboard/config/**`, `dashboard/ops/julia-dashboard-sweep.*` and `dashboard/app/start/**`. PR-4 and PR-5 own `dashboard/app/start/**` and `dashboard/lib/{roles,last-start}.js` plus `dashboard/config/roles.json`. PR-6 owns `dashboard/worker/**`, `dashboard/scripts/effort-probe.mjs` and `dashboard/scripts/effort-report.mjs`. PR-7 and PR-8 own `dashboard/lib/{runs,supervisor}.js`, `dashboard/app/api/**`, `dashboard/kickoff.md` and the writing commands in `scripts/linear-cli.mjs`. PR-9 owns `dashboard/lib/telemetry.js`, `dashboard/lib/ping.js`, `dashboard/instrumentation.js`, `dashboard/app/telemetry-report/**`, `dashboard/docs/telemetry.md` and `scripts/julia-agents.env`.
- [ ] Hold the review gate. Every PR except PR-6 changes a screen. Those wait for Todd's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`, and use `origin pr` instead if `command -v origin` succeeds and Origin resolves this repository. Record any fallback.
- [ ] Open the PR ready, never draft, base `main`.
- [ ] Run `npm ci` in `dashboard/`, then `npm run build`, `npm run lint` and `npm test` in `dashboard/`, then `node scripts/test-owners.mjs --run local` from the repo root, once before the PR-facing push. Push with hooks on.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`.
- [ ] Rebase onto current trunk before the code-ready report and babysit. Rebase again only at merge prep, on a `git merge-tree` conflict, or on a CI failure that comes from trunk.
- [ ] Write the card's scorecard line into the PR body with `node scripts/scorecard.mjs JUL-276`, per ADR 0024.

### Verdict and merge, for every PR

- [ ] A full swarm runs once at the code-ready head, per `.agents/skills/swarm/SKILL.md`, one gates lane, the ten live lanes below, the perf lane, and two audit lanes that distrust the PR body.
- [ ] Clean only when every lane is PASS. Send findings back to the owner, including defects a lane filed as a note.
- [ ] Todd's yes on the screen is required before merge for every PR except PR-6. PR-6 merges on the gates plus his approval of the exception.
- [ ] The owner merges its own PR, then confirms main CI is green on the merge commit and records that commit on the card.

### Boot recipe, for every live lane

Each lane runs on this server at the PR head, in a throwaway git worktree under `/home/ubuntu/verifications/jul-276/pr-N`, driven by Playwright against that lane's own app. There is no cloud VM. PR-6 has no screen, so its lanes open the static report file the probe writes into the same worktree.

- [ ] Create the lane worktree from the PR head, run `npm ci` in `dashboard/`, then `npm run build`.
- [ ] Start the app on port `3100 + N` bound to `127.0.0.1`, with `DASHBOARD_STATE_DIR` pointed at a fresh per-lane folder under `/tmp/jul-276-lanes/pr-N`.
- [ ] Keep local run files and trace databases in the lane's isolated state folder, never the deployed dashboard's folder. Read real Linear state and use the two real practice cards for builds. Fixtures remain allowed for unit tests, not as live proof.
- [ ] Record every live lane's real input, card ids, commands, observed result and cleanup. Reserve the practice cards and any shared Linear mutations so parallel lanes cannot interfere. For the empty-list check, move the practice cards out of Ready and restore them afterward; do not move unrelated cards. If unrelated Ready cards prevent an empty result, report the blocker rather than filtering the real list.
- [ ] Produce slow reads by delaying the lane server's real outbound Linear connection, not by returning a recorded answer. Produce failed reads by starting that lane's dashboard without its Linear key. Restore the connection and key after each check.
- [ ] Name any state that cannot be produced for real, show the attempted reproduction and ask Todd before using a stand-in. A missing reproduction remains unverified, never PASS.
- [ ] Open one browser context at 390 by 844 for phone and one at 1280 by 800 for desktop, then follow the lane's steps exactly.
- [ ] Save the screenshot the lane names. A lane fails when its screenshot is missing, when the predicate is unmet, or when the browser console logs an error.
- [ ] Stop the app and release the port at the end of the lane.

## PR-1 The dashboard app folder, with Ready cards on one page

**Depends on.** Nothing. It is the first PR of the program and needs no settings, no models and no runner.

**Files.**
- [ ] Create `dashboard/package.json` and `dashboard/package-lock.json`, a Next app with its own dependencies and nothing imported from Julia's app.
- [ ] Create `dashboard/app/layout.jsx`, `dashboard/app/page.jsx`, `dashboard/app/start/[card]/page.jsx` and `dashboard/app/globals.css`.
- [ ] Create `dashboard/lib/linear.js` and `dashboard/lib/linear.test.mjs`.
- [ ] Add a read only `list-ready` command to `scripts/linear-cli.mjs`.
- [ ] Port the decision records and the glossary out of Linear into `dashboard/docs/decisions/`, one file per decision from 0001 to 0022, plus `dashboard/docs/glossary.md`, so the dashboard's records live in the dashboard folder.
- [ ] Create `dashboard/playwright.config.mjs` and `dashboard/tests/dashboard.spec.mjs`.

**Build.**
- [ ] Put the Mint and Iris colour tokens and Public Sans into `globals.css`, taken from the approved design system picture, light only.
- [ ] List every card in state Ready from the Julia-next team, title and Start, newest first, with `list-ready` asking Linear on each request and never caching.
- [ ] Open `/start/<card>` on Start with that card's title and a Back, and return to the list on Back with the card still Ready.
- [ ] Show a plain empty state, a loading state, and a failed state with a rose line naming the reason Linear gave.
- [ ] Bind to the tailnet address from `DASHBOARD_HOST` on port 4313, and deploy nothing to Vercel.

**You see.**
- [ ] On your phone over Tailscale, one page with your Ready cards, a Start on each, and Back from the card.
- [ ] A named failure instead of a blank page when Linear is slow or down.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] `dashboard/lib/linear.test.mjs` fails when a Ready card is dropped, when a card in another state is listed, and when a malformed Linear answer renders an empty page.
- [ ] `node scripts/test-owners.mjs --run local` picks up `dashboard/` as its own owner and runs its tests in CI with no registry change.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `commandcode/deepseek/deepseek-v4.1-flash` at the PR head, each in its own worktree, port and state folder.
- [ ] Lane 1. Put the two real practice cards in Ready and open the list at 390 by 844. Save `docs/scorecards/jul-276/pr-1/lane-1.png`. Pass when the list matches a fresh Linear read, both practice cards show title and Start, and no label is cut.
- [ ] Lane 2. Open the list at 1280 by 800. Save `docs/scorecards/jul-276/pr-1/lane-2.png`. Pass when the same real Ready cards show in one column and every Start is reachable.
- [ ] Lane 3. Press Start on the first card. Save `docs/scorecards/jul-276/pr-1/lane-3.png`. Pass when the screen shows that card's title, a Back, and the card id in the URL.
- [ ] Lane 4. Press Back. Save `docs/scorecards/jul-276/pr-1/lane-4.png`. Pass when the list returns and Linear still reports the card as Ready.
- [ ] Lane 5. Move the practice cards out of the real Ready column, confirm Linear returns no Ready cards, and reload. Save `docs/scorecards/jul-276/pr-1/lane-5.png`. Pass when a plain empty message shows and no Start is offered. Restore the cards afterward; if other Ready cards prevent this state, use the blocker rule above.
- [ ] Lane 6. Delay the lane server's real outbound Linear connection and reload. Save `docs/scorecards/jul-276/pr-1/lane-6.png`. Pass when loading shows before the real cards arrive. Remove the delay afterward.
- [ ] Lane 7. Run the lane dashboard without its Linear key and reload. Save `docs/scorecards/jul-276/pr-1/lane-7.png`. Pass when a rose line names the real configuration failure and no card is invented. Restore the key afterward.
- [ ] Lane 8. Repeat lane 1 at 200 percent zoom. Save `docs/scorecards/jul-276/pr-1/lane-8.png`. Pass when every Start stays tappable and nothing overlaps.
- [ ] Lane 9. Walk the list, Start and Back twice each. Save `docs/scorecards/jul-276/pr-1/lane-9.png`. Pass when the console shows no error.
- [ ] Lane 10. Repeat lane 9 on desktop. Save `docs/scorecards/jul-276/pr-1/lane-10.png`. Pass when every request succeeds and none answers 500.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] Metric. Time to first byte of `GET /` with real Ready cards read from Linear.
- [ ] Probe. `curl -o /dev/null -s -w '%{time_starttransfer}'` against the lane server, ten times, take the median.
- [ ] Baseline. 1,500 ms on this server.
- [ ] Rule. The median must be at or under the baseline in two runs out of three.

**Review gate.**
- [ ] Send you the phone and desktop screenshot pair, a 30 to 60 second video of list, Start and Back, and the operator note that the card stayed Ready.
- [ ] Merge waits for your yes in chat.

**Merge.**
- [ ] Merge with a merge commit, confirm main CI is green on that commit, and comment the commit on JUL-276.

## PR-2 Run it as a service, updating itself from main between builds

**Depends on.** PR-1, because a service needs the page it serves.

**Files.**
- [ ] Create `dashboard/ops/julia-dashboard.service` and `dashboard/ops/julia-dashboard-update.service` with `dashboard/ops/julia-dashboard-update.timer`.
- [ ] Create `dashboard/ops/julia-dashboard-watchdog.service` with `dashboard/ops/julia-dashboard-watchdog.timer`.
- [ ] Create `dashboard/scripts/install-service.mjs`, `dashboard/scripts/update.mjs`, `dashboard/scripts/watchdog.mjs` and `dashboard/lib/ping.js`.
- [ ] Create `dashboard/app/api/health/route.js` and `dashboard/docs/service.md`.
- [ ] Add the service section to `docs/agents/server-runbook.md`, written from the runbook's own rules.

**Build.**
- [ ] The unit runs `node dashboard/server.js` from a dedicated checkout at `/home/ubuntu/julia-dashboard`, a worktree of `main`, never the operator checkout, with `Restart=always`, `RestartSec=2`, `WantedBy=multi-user.target` and environment from a root owned env file.
- [ ] The update timer runs every five minutes, fetches `origin main`, and fast-forwards only when no run is starting or running, then runs `npm ci`, `npm run build` and restarts the unit.
- [ ] The watchdog timer runs every minute against `/api/health`. After three consecutive failures, send Todd a Linear notification using the existing comment-and-reminder path on JUL-276, then send a recovery notification when health returns. No standing service issue is created. Keep the sender outside the dashboard process so it works while the dashboard is down.
- [ ] Health answers `ok` only when Linear answers, the state folder is writable and every run file parses, and names the failing piece otherwise.
- [ ] Install with `sudo`, which this server allows, and record the unit names in the decision trail.

**You see.**
- [ ] The dashboard coming back on its own after a crash and after a reboot.
- [ ] A merge to main reaching the dashboard between builds, and a Linear notification on your phone when it is down.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] `update.mjs` is tested as a decision function, idle means update, starting or running means skip, and the test fails if a skip still moves the checkout.
- [ ] `watchdog.mjs` is tested on the third failure, on a recovery, and on a single blip that must send nothing.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `commandcode/deepseek/deepseek-v4.1-flash` at the PR head, each in its own worktree, port and state folder.
- [ ] Lane 1. Read `systemctl is-enabled julia-dashboard` and load the page. Save `docs/scorecards/jul-276/pr-2/lane-1.png`. Pass when it reads enabled and the page loads.
- [ ] Lane 2. Kill the process with `kill -9`, wait 15 seconds and reload. Save `docs/scorecards/jul-276/pr-2/lane-2.png`. Pass when the page returns with no manual start.
- [ ] Lane 3. Write an active run file, then trigger the updater. Save `docs/scorecards/jul-276/pr-2/lane-3.png`. Pass when the updater log says skipped and the run file is unchanged.
- [ ] Lane 4. Merge a one line change to main, wait for the timer, reload. Save `docs/scorecards/jul-276/pr-2/lane-4.png`. Pass when the served build id matches the new commit.
- [ ] Lane 5. Stop the unit and wait for three failed minute-spaced watchdog checks, allowing up to four minutes. Open Todd's Linear inbox. Save `docs/scorecards/jul-276/pr-2/lane-5.png`. Pass when the dashboard-down notification reaches Todd through the JUL-276 comment and reminder, and no service issue was created. A comment alone is not proof of delivery.
- [ ] Lane 6. Start the unit again and wait one watchdog pass. Save `docs/scorecards/jul-276/pr-2/lane-6.png`. Pass when the recovery notification reaches Todd and names the dashboard.
- [ ] Lane 7. Load `/api/health`. Save `docs/scorecards/jul-276/pr-2/lane-7.png`. Pass when it reads ok and names the three checks.
- [ ] Lane 8. Corrupt one run file, load `/api/health` and the page. Save `docs/scorecards/jul-276/pr-2/lane-8.png`. Pass when health names that file in rose and the list still serves.
- [ ] Lane 9. Repeat lane 2 at 390 by 844. Save `docs/scorecards/jul-276/pr-2/lane-9.png`. Pass when the phone page recovers with no reload prompt.
- [ ] Lane 10. Walk lanes 2, 5 and 6 again. Save `docs/scorecards/jul-276/pr-2/lane-10.png`. Pass when the console shows no error in any step.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] Metric. Seconds from `kill -9` to the page answering again.
- [ ] Probe. The lane 2 script, timed with `date +%s%3N` before the kill and after the first 200.
- [ ] Baseline. 15 seconds.
- [ ] Rule. Every one of three kills must recover inside the baseline.

**Review gate.**
- [ ] Send you a screenshot of the page after a kill, a 30 to 60 second video of kill and recovery, and the operator note recording the unit names.
- [ ] Merge waits for your yes in chat.

**Merge.**
- [ ] Merge with a merge commit, confirm main CI is green on that commit, and comment the commit on JUL-276.

## PR-3 The weekly model sweep, and the Start screen read only

**Depends on.** PR-2, because the sweep runs as a timer on the same host as the service.

**Files.**
- [ ] Create `dashboard/config/accounts.json` and `dashboard/config/price-sources.json`, the one place the two lists live.
- [ ] Create `dashboard/scripts/sweep.mjs`, `dashboard/lib/models.js` and `dashboard/lib/models.test.mjs`.
- [ ] Create `dashboard/ops/julia-dashboard-sweep.service` and `dashboard/ops/julia-dashboard-sweep.timer`.
- [ ] Rewrite `dashboard/app/start/[card]/page.jsx` as the read only Start screen.

**Build.**
- [ ] Accounts live in `dashboard/config/accounts.json`, three today, the Claude subscription, the ChatGPT plan and the CommandCode grant, and adding a fourth is a one line change in that file.
- [ ] Sweep asks each account what it offers through `listAvailableModels()` on the SDK, which answered 8,243 models with 142 carrying a key on this server, and needs no public catalogue.
- [ ] Sweep adds new models, retires models that disappeared, and records each price from the provider's own pricing page together with the date it was read.
- [ ] A model with no saved price is not written, so every model the screen shows has a price, and the sweep logs the exclusion.
- [ ] The sweep timer runs weekly and writes `models.json` atomically, one line per attempt in `sweep-log.jsonl`.
- [ ] Start screen shows the card title, the main session model and its price, the Shipping model and its price, an effort summary with prices, and the four effort options with the plain explanation from the controls document.
- [ ] Free appears only for a model the sweep recorded as free.
- [ ] Back returns to the list and leaves the card Ready, and nothing on this screen changes a model or an effort.

**You see.**
- [ ] The Start screen for real, with your models, their prices and the effort picker, and no way to change anything yet.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] Price parsing is tested against one saved fixture per provider, and the test fails when a page changes shape and the parse starts returning zero.
- [ ] The add and retire diff is tested, and the test fails when a retired model stays in `models.json`.
- [ ] The unpriced rule is tested, and the test fails when a model without a price reaches the screen.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `commandcode/deepseek/deepseek-v4.1-flash` at the PR head, each in its own worktree, port and state folder.
- [ ] Lane 1. Open the Start screen at 390 by 844 with a `models.json` written by a real provider sweep. Save `docs/scorecards/jul-276/pr-3/lane-1.png`. Pass when the card title, the main model, the Shipping model and the effort summary all show with prices.
- [ ] Lane 2. Open the same screen at 1280 by 800. Save `docs/scorecards/jul-276/pr-3/lane-2.png`. Pass when the same four pieces show and no price is cut.
- [ ] Lane 3. Read every price on the screen. Save `docs/scorecards/jul-276/pr-3/lane-3.png`. Pass when each reads input and output per million tokens in the approved form.
- [ ] Lane 4. Open the effort explanation. Save `docs/scorecards/jul-276/pr-3/lane-4.png`. Pass when it reads `How hard the models think. More brains is slower and costs more.`
- [ ] Lane 5. Try to change a model. Save `docs/scorecards/jul-276/pr-3/lane-5.png`. Pass when no control accepts a change and the saved settings file is byte identical afterwards.
- [ ] Lane 6. Open a sweep older than eight days. Save `docs/scorecards/jul-276/pr-3/lane-6.png`. Pass when a plain line gives the sweep date and no price is invented.
- [ ] Lane 7. Open with an empty `models.json`. Save `docs/scorecards/jul-276/pr-3/lane-7.png`. Pass when the screen names the missing sweep and offers Back, with no model invented.
- [ ] Lane 8. Press Back. Save `docs/scorecards/jul-276/pr-3/lane-8.png`. Pass when the list returns and Linear still reports the card as Ready.
- [ ] Lane 9. Repeat lane 1 at 200 percent zoom. Save `docs/scorecards/jul-276/pr-3/lane-9.png`. Pass when every label stays whole and nothing overlaps.
- [ ] Lane 10. Walk lanes 1, 4 and 8 twice. Save `docs/scorecards/jul-276/pr-3/lane-10.png`. Pass when the console shows no error.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] Metric. Time to first byte of the Start screen with a `models.json` written by a real provider sweep.
- [ ] Probe. `curl -o /dev/null -s -w '%{time_starttransfer}'` against the lane server, ten times, take the median.
- [ ] Baseline. 1,500 ms on this server.
- [ ] Rule. The median must be at or under the baseline in two runs out of three.

**Review gate.**
- [ ] Send you the phone and desktop screenshot pair, a 30 to 60 second video of the screen and its effort explanation, and the operator note that the sweep file was untouched by the screen.
- [ ] Merge waits for your yes in chat.

**Merge.**
- [ ] Merge with a merge commit, confirm main CI is green on that commit, and comment the commit on JUL-276.

## PR-4 Model, group, panel and effort controls that change things

**Depends on.** PR-3, which ships the saved models and prices these controls choose from.

**Files.**
- [ ] Create `dashboard/app/start/[card]/start-screen.jsx`, the client component behind the controls.
- [ ] Create `dashboard/lib/roles.js`, `dashboard/lib/roles.test.mjs` and `dashboard/config/roles.json`.

**Build.**
- [ ] Six group rows, Building, Judgment, Investigating, Learning, Panels and Workers, each with one group model.
- [ ] Tap a model name to open the list, pick one to replace it, and the list shows only models the sweep saved, each with its price.
- [ ] Change a group model and every role in that group follows, matching what `~/.agents/pstack-models.md` does for a real run.
- [ ] Open a group with its down arrow and set one role on its own, and show that role differently from the rest of its group.
- [ ] Panels show chips with a cross and `+ Add`, keep at least one model, and refuse to remove the last one with a plain line.
- [ ] The effort picker offers Small, Medium, Large and Unlimited, one to four brains, and each choice carries its own ⓘ.
- [ ] Every role carries an ⓘ with one plain sentence taken from its pstack role file.
- [ ] Write each change to `draft.json` in the state folder as it happens, so a reload keeps it and a second card can reuse it.

**You see.**
- [ ] Changing one group model and watching every role under it move, and setting one role against its group.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] Group propagation is tested, and the test fails when one role in the group keeps the old model.
- [ ] The panels rule is tested, and the test fails when the last chip can be removed.
- [ ] The effort map is tested, and the test fails when Small or Unlimited lands on the wrong budget.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `commandcode/deepseek/deepseek-v4.1-flash` at the PR head, each in its own worktree, port and state folder.
- [ ] Lane 1. Change the Building group model. Save `docs/scorecards/jul-276/pr-4/lane-1.png`. Pass when all four Building roles show the new model and no other group changed.
- [ ] Lane 2. Set one Building role against its group. Save `docs/scorecards/jul-276/pr-4/lane-2.png`. Pass when that role reads differently from its group and the other three keep the group model.
- [ ] Lane 3. Change a group, reload the page. Save `docs/scorecards/jul-276/pr-4/lane-3.png`. Pass when the choice survives the reload from `draft.json`.
- [ ] Lane 4. Add a second model to Panels. Save `docs/scorecards/jul-276/pr-4/lane-4.png`. Pass when two chips show and each has a cross.
- [ ] Lane 5. Remove both panel chips in turn. Save `docs/scorecards/jul-276/pr-4/lane-5.png`. Pass when the last cross is refused and one chip remains.
- [ ] Lane 6. Pick each effort option in turn. Save `docs/scorecards/jul-276/pr-4/lane-6.png`. Pass when the summary updates and the four labels stay in order.
- [ ] Lane 7. Open the model list. Save `docs/scorecards/jul-276/pr-4/lane-7.png`. Pass when every model shows its price and none is missing one.
- [ ] Lane 8. Open a role ⓘ at 390 by 844. Save `docs/scorecards/jul-276/pr-4/lane-8.png`. Pass when the popup is readable and closable and no label behind it is cut.
- [ ] Lane 9. Repeat lanes 1 and 2 at 200 percent zoom. Save `docs/scorecards/jul-276/pr-4/lane-9.png`. Pass when every row and cross stays tappable.
- [ ] Lane 10. Walk lanes 1 to 6 on desktop. Save `docs/scorecards/jul-276/pr-4/lane-10.png`. Pass when the console shows no error.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] Metric. Milliseconds from a group model tap to every role row repainted.
- [ ] Probe. A Playwright timing around the tap and the last row assertion, ten taps, take the median.
- [ ] Baseline. 100 ms.
- [ ] Rule. The median must be at or under the baseline, and no tap may exceed 250 ms.

**Review gate.**
- [ ] Send you a phone screenshot pair of a group change and a role override, a 30 to 60 second video of both, and the operator note that the saved file held the change.
- [ ] Merge waits for your yes in chat.

**Merge.**
- [ ] Merge with a merge commit, confirm main CI is green on that commit, and comment the commit on JUL-276.

## PR-5 Start with last settings

**Depends on.** PR-4, because the choice this PR saves is the choice those controls make.

**Files.**
- [ ] Create `dashboard/lib/last-start.js` and `dashboard/lib/last-start.test.mjs`.
- [ ] Add the `Start with last settings` control to `dashboard/app/start/[card]/start-screen.jsx`.

**Build.**
- [ ] Save the whole Start choice to `last-start.json`, the main session model, every group and role model, the panels and the effort, written when Start is pressed.
- [ ] Offer `Start with last settings` at the top of a later Start screen, which restores that choice and marks the rows it restored.
- [ ] Pre-select the last choice on open, as the card asks, and show the sweep default on a fresh install with no saved file.
- [ ] Ignore a saved model the sweep has retired, fall back to the sweep default, and say so in one plain line.
- [ ] Keep a saved choice when a card fails, so a failed start does not wipe what you picked.

**You see.**
- [ ] A second card opening on the same models and effort as the first, and one button that puts them back after you change things.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] Restore is tested, and the test fails when a panel list comes back with a different number of models.
- [ ] The retired model rule is tested, and the test fails when a missing model is restored silently.
- [ ] The fresh install path is tested, and the test fails when a choice is invented with no saved file.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `commandcode/deepseek/deepseek-v4.1-flash` at the PR head, each in its own worktree, port and state folder.
- [ ] Lane 1. Press Start on a first card with a changed group model and Large effort. Save `docs/scorecards/jul-276/pr-5/lane-1.png`. Pass when `last-start.json` holds all three pieces.
- [ ] Lane 2. Open a second card. Save `docs/scorecards/jul-276/pr-5/lane-2.png`. Pass when it opens on the first card's models and effort with no tap.
- [ ] Lane 3. Change three things on the second card, then press `Start with last settings`. Save `docs/scorecards/jul-276/pr-5/lane-3.png`. Pass when all three return and the restored rows are marked.
- [ ] Lane 4. Open with no saved file. Save `docs/scorecards/jul-276/pr-5/lane-4.png`. Pass when the sweep default shows and nothing claims to be restored.
- [ ] Lane 5. Hand edit the saved file to name a retired model. Save `docs/scorecards/jul-276/pr-5/lane-5.png`. Pass when the screen names the swap and shows the default.
- [ ] Lane 6. Reload after saving. Save `docs/scorecards/jul-276/pr-5/lane-6.png`. Pass when the same choice returns.
- [ ] Lane 7. Repeat lanes 1 and 3 at 390 by 844. Save `docs/scorecards/jul-276/pr-5/lane-7.png`. Pass when both work with one thumb and no label is cut.
- [ ] Lane 8. Repeat lanes 1 and 3 at 1280 by 800. Save `docs/scorecards/jul-276/pr-5/lane-8.png`. Pass when both work and the page does not scroll sideways.
- [ ] Lane 9. Save, corrupt the file, reload. Save `docs/scorecards/jul-276/pr-5/lane-9.png`. Pass when the screen falls back to the default with a plain line and no crash.
- [ ] Lane 10. Walk lanes 1 to 4 twice. Save `docs/scorecards/jul-276/pr-5/lane-10.png`. Pass when the console shows no error.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] Metric. Milliseconds from opening a card with a saved choice to the screen being ready.
- [ ] Probe. A Playwright timing from `goto` to the last restored row painted, ten opens, take the median.
- [ ] Baseline. 800 ms.
- [ ] Rule. The median must be at or under the baseline, and no open may exceed 1,500 ms.

**Review gate.**
- [ ] Send you a phone screenshot pair of the first card's choice and the second card opening on it, a 30 to 60 second video of the restore button, and the operator note that the saved file was read back.
- [ ] Merge waits for your yes in chat.

**Merge.**
- [ ] Merge with a merge commit, confirm main CI is green on that commit, and comment the commit on JUL-276.

## PR-6 Spike, no screen, the pack rule, the write guard, the reset retry and cost per run

**Depends on.** Nothing from the screen PRs. It starts beside PR-1 and must finish before PR-7, which uses everything it proves.

**Files.**
- [ ] Create `dashboard/worker/run-build.mjs`, the one process that owns a build.
- [ ] Create `dashboard/worker/guarded-write.mjs` and `dashboard/worker/retry.mjs`, with `dashboard/worker/run-build.test.mjs`.
- [ ] Create `dashboard/scripts/effort-probe.mjs` and `dashboard/scripts/effort-report.mjs`.

**Build.**
- [ ] The worker boots `@mastra/code-sdk` in process with its own `MASTRA_APP_DATA_DIR` and `MASTRA_OBSERVABILITY_DB_PATH`, copies the settings into that folder, and calls `getMastra().shutdown()` at the end. That call is the only path proven to flush traces, and the headless CLI never makes it.
- [ ] The worker writes the run's settings with a `customModelPacks` entry named after the run whose `plan` and `build` both resolve to the main session model, and passes that pack to `runMC`.
- [ ] Prove the pack rule, because a launch model loses to the active pack. `activeModelPackId` is `custom:sol/deepseek` on this machine, and that is why today's session ran DeepSeek in build mode and GPT-6.1 Sol in plan mode.
- [ ] The write guard refuses any `write_file` whose content passes 24,000 bytes and answers with `write this in parts`, installed as a `PreToolUse` hook in the run's own config home so only dashboard builds carry it. `disableBuiltinTools` cannot do this, it never touches the workspace file tools, and a hooks file in the worktree would dirty the build's own diff.
- [ ] The retry wraps one turn, and after a connection reset waits 2 seconds, then 4, 8 and 16, capped at 30, for five attempts, and the run fails only when every attempt failed.
- [ ] The observer guard records an error from `memory: observe` or another background observer as a note on the run and never as a run failure, which is what happened all three times today and work carried on each time.
- [ ] No output cap anywhere. Your 25 October decision stands and output stays at the model maximum, because a cap truncates the answer, as today's test showed when five of six capped replies stopped at the cap.
- [ ] The effort probe runs three builds per effort level with one helper spawn in each, and records reasoning tokens, the helper model and cost per model from that run's trace database.
- [ ] The report writes one static `effort-report.html` with a section per level, the pack table, the helper table, the cost table, the guard log, the reset log and the observer log.

**You see.**
- [ ] Nothing, this PR is a machine proof. You approved that exception on 28 October, and PR-7 is the first PR that puts any of it on your screen.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] The retry sequence is tested on a reset at attempt one, three and five, and the test fails when a reset is treated as a finished run.
- [ ] The guard is tested at 23,999 and 24,001 bytes, and the test fails when the larger write is allowed.
- [ ] The observer classification is tested, and the test fails when a `memory: observe` error changes run status.
- [ ] Status mapping is tested on starting, running, stopped, exited and failed, and the test fails when a stopped run reports failed.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `commandcode/deepseek/deepseek-v4.1-flash` at the PR head, each in its own worktree, port and state folder.
- [ ] Lane 1. Open the report at 1280 wide, Small section. Save `docs/scorecards/jul-276/pr-6/lane-1.png`. Pass when three Small runs list reasoning tokens, helper model and cost and none is marked failed.
- [ ] Lane 2. Medium section. Save `docs/scorecards/jul-276/pr-6/lane-2.png`. Pass when three Medium runs are listed beside the Small figures.
- [ ] Lane 3. Large section. Save `docs/scorecards/jul-276/pr-6/lane-3.png`. Pass when three Large runs are listed and the highest level is visible.
- [ ] Lane 4. Unlimited section. Save `docs/scorecards/jul-276/pr-6/lane-4.png`. Pass when three Unlimited runs are listed and every helper they spawned carries the same level.
- [ ] Lane 5. Pack table. Save `docs/scorecards/jul-276/pr-6/lane-5.png`. Pass when plan and build both name the chosen model in all twelve runs.
- [ ] Lane 6. Helper table. Save `docs/scorecards/jul-276/pr-6/lane-6.png`. Pass when every run lists the helper it spawned with a model and a token count.
- [ ] Lane 7. Cost table. Save `docs/scorecards/jul-276/pr-6/lane-7.png`. Pass when every run has a cost row per model read from that run's own trace database.
- [ ] Lane 8. Guard log. Save `docs/scorecards/jul-276/pr-6/lane-8.png`. Pass when a 60,000 byte write was refused with `write this in parts` and the same file then landed in three accepted writes.
- [ ] Lane 9. Repeat the real long concurrent generations that triggered connection resets in the reproduction. Save `docs/scorecards/jul-276/pr-6/lane-9.png` and the request, reset and retry logs. Pass when a real reset is retried after the first wait and the run finishes. If no reset occurs, report the state as unverified and ask before any stand-in.
- [ ] Lane 10. Repeat the real long concurrent generations that triggered observer errors in the reproduction. Save `docs/scorecards/jul-276/pr-6/lane-10.png` and the observer and worker logs. Pass when a real observer error leaves the run running with its status unchanged. If no observer error occurs, report the state as unverified and ask before any stand-in.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] Metric. Share of probe runs whose trace database holds model rows after shutdown.
- [ ] Probe. Query each run's `metric_events` for model token rows, twelve runs.
- [ ] Baseline. All twelve runs, and a cost read under five seconds per run.
- [ ] Rule. Twelve of twelve must hold rows and no read may pass five seconds.

**Review gate.** None. There is no screen in this PR, and the provisioning note is your approved exception.

**Merge.**
- [ ] Merge on gates plus your approval of the exception, confirm main CI is green on that commit, and comment the commit on JUL-276.

## PR-7 Start and stop a real build from the screen

**Depends on.** PR-5 and PR-6, the saved choice and the proven worker.

**Files.**
- [ ] Create `dashboard/lib/runs.js`, `dashboard/lib/supervisor.js` and `dashboard/lib/runs.test.mjs`.
- [ ] Create `dashboard/app/api/runs/route.js`, `dashboard/app/api/runs/[id]/stop/route.js` and `dashboard/app/api/runs/[id]/events/route.js`.
- [ ] Create `dashboard/kickoff.md`, the versioned instructions a build starts from.
- [ ] Wire Start on `dashboard/app/start/[card]/page.jsx` and add `set-state` to `scripts/linear-cli.mjs`.

**Build.**
- [ ] Start writes a run file atomically and only then spawns `dashboard/worker/run-build.mjs` detached in its own session, so a dashboard restart leaves the build running.
- [ ] Each run gets a worktree at `~/builds/<card>-<runId>` from `origin main` and a branch `card/JUL-<n>`, and the card moves to Implementation before the first model call.
- [ ] The button reads `Starting…`, then `Running` on the first worker event, and the screen shows the current step and the time since the last event.
- [ ] Start re-checks the card is still Ready and refuses with a plain rose line when it is not, so a stale page cannot start a card twice.
- [ ] Stop opens `Stop this build? The work is kept.`, sends SIGTERM on yes, leaves the branch and the worktree, keeps the card in Implementation, and a later Start reuses the branch.
- [ ] Several cards start, run and stop at once, one worker process and one trace database each.
- [ ] The supervisor rebinds after a dashboard restart by reading the run files and checking each pid, and records a dead pid as exited with its reason.
- [ ] `kickoff.md` tells the build to work in the worktree, commit and push as it goes, open the pull request with the scorecard line, and stop at the merge gate.

**You see.**
- [ ] A real build start, report its current step and stop, from your phone, with the branch and the work left behind.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] The run file is tested for atomic writes under a mid-write crash, and the test fails when a half written file is read as a run.
- [ ] Admission is tested on a Ready card, a moved card and a card already running, and the test fails when a second worker starts.
- [ ] Rebind is tested on a live pid, a dead pid and a vanished worktree, and the test fails when a dead run still reads as running.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `commandcode/deepseek/deepseek-v4.1-flash` at the PR head, each in its own worktree, port and state folder.
- [ ] Lane 1. Press Start to build a real practice card with the real worker and selected model. Use real practice-card builds for every Start, Running and Stop check below, including the timing probe. Save `docs/scorecards/jul-276/pr-7/lane-1.png`. Pass when the button reads `Starting…` then `Running` and a run file exists.
- [ ] Lane 2. Watch the current step across two worker events. Save `docs/scorecards/jul-276/pr-7/lane-2.png`. Pass when the step text changes without a reload.
- [ ] Lane 3. Press Stop. Save `docs/scorecards/jul-276/pr-7/lane-3.png`. Pass when the dialog reads `Stop this build? The work is kept.`
- [ ] Lane 4. Confirm Stop. Save `docs/scorecards/jul-276/pr-7/lane-4.png`. Pass when the button returns to Start, the branch still exists and the worktree still holds the work.
- [ ] Lane 5. Confirm the card after stop. Save `docs/scorecards/jul-276/pr-7/lane-5.png`. Pass when Linear still reports the card in Implementation.
- [ ] Lane 6. Start the same card again. Save `docs/scorecards/jul-276/pr-7/lane-6.png`. Pass when the branch is reused rather than recreated and no old run file is deleted.
- [ ] Lane 7. Restart the dashboard during a run. Save `docs/scorecards/jul-276/pr-7/lane-7.png`. Pass when the build is still running and the screen reads Running again.
- [ ] Lane 8. Start two cards at once. Save `docs/scorecards/jul-276/pr-7/lane-8.png`. Pass when both read Running, each with its own run file and its own trace database.
- [ ] Lane 9. Press Start twice quickly on one card. Save `docs/scorecards/jul-276/pr-7/lane-9.png`. Pass when exactly one worker process exists.
- [ ] Lane 10. Walk lanes 1, 3 and 7 at 390 by 844. Save `docs/scorecards/jul-276/pr-7/lane-10.png`. Pass when every control is tappable and the console shows no error.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] Metric. Seconds from pressing Start to the button reading `Running`.
- [ ] Probe. A Playwright timing from the tap to the Running assertion, five starts, take the median.
- [ ] Baseline. 10 seconds.
- [ ] Rule. The median must be at or under the baseline, and no start may exceed 20 seconds.

**Review gate.**
- [ ] Send you a phone screenshot pair of Starting and Running, a 30 to 60 second video of start, step change and stop, and the operator note that the branch and work survived the stop.
- [ ] Merge waits for your yes in chat.

**Merge.**
- [ ] Merge with a merge commit, confirm main CI is green on that commit, and comment the commit on JUL-276.

## PR-8 Did not start, try again, the finish ping, and several builds at once

**Depends on.** PR-7, the run that can fail.

**Files.**
- [ ] Extend `dashboard/lib/ping.js` with `finishPing` and add `dashboard/lib/ping.test.mjs`.
- [ ] Extend `dashboard/lib/supervisor.js` and `dashboard/worker/run-build.mjs` for the failed, retried and finished cases.
- [ ] Add the failed, stopped and finished states to `dashboard/app/start/[card]/start-screen.jsx`.

**Build.**
- [ ] A failed start shows a rose `Didn't start` pill, one plain line naming the reason, and `Try again`.
- [ ] The same failure posts a Linear notification on the card, so it reaches your phone, and never claims the build did anything.
- [ ] A finished build posts a comment on the card and sets a reminder, reusing the stop ping path that already reaches your phone.
- [ ] Observer errors never mark a run failed, which PR-6 proved, and the screen says nothing about them.
- [ ] `Try again` starts a fresh run with a new run id, reuses the branch, and never reuses the failed run's leftover state.
- [ ] Two builds at once keep their own status, their own log and their own stop button, and one stopping leaves the other running.

**You see.**
- [ ] A failure that names its reason and offers Try again, and a ping on your phone when a build finishes.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] The reason line is tested on a missing key, a missing model and a dead worker, and the test fails when a raw stack reaches the screen.
- [ ] `finishPing` is tested, and the test fails when a finished run sends no comment or sends two.
- [ ] Try again is tested, and the test fails when the new run keeps the old run id.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `commandcode/deepseek/deepseek-v4.1-flash` at the PR head, each in its own worktree, port and state folder.
- [ ] Lane 1. Start a real practice card with an unavailable model selected and keep the provider's actual failure response. Save `docs/scorecards/jul-276/pr-8/lane-1.png`. Pass when the rose `Didn't start` pill shows and no build claims to run.
- [ ] Lane 2. Read the reason line. Save `docs/scorecards/jul-276/pr-8/lane-2.png`. Pass when it is one plain sentence with no stack and no jargon.
- [ ] Lane 3. Select an available model and press `Try again` on the real practice card. Save `docs/scorecards/jul-276/pr-8/lane-3.png`. Pass when a new run id appears and the button reaches Running.
- [ ] Lane 4. Open the card in Linear after a finish. Save `docs/scorecards/jul-276/pr-8/lane-4.png`. Pass when one comment names the run and its result.
- [ ] Lane 5. Read the reminder record. Save `docs/scorecards/jul-276/pr-8/lane-5.png`. Pass when one reminder exists for that card and its target is your profile.
- [ ] Lane 6. Open the failed card in Linear. Save `docs/scorecards/jul-276/pr-8/lane-6.png`. Pass when the failure notification is on the card and names the reason.
- [ ] Lane 7. Start two cards, stop one. Save `docs/scorecards/jul-276/pr-8/lane-7.png`. Pass when the other still reads Running with its own log growing.
- [ ] Lane 8. Repeat lanes 1 and 7 at 390 by 844. Save `docs/scorecards/jul-276/pr-8/lane-8.png`. Pass when the pill is readable and both rows stay tappable.
- [ ] Lane 9. Press Back from a failed card. Save `docs/scorecards/jul-276/pr-8/lane-9.png`. Pass when the card keeps its stage and the list shows it with a Start again.
- [ ] Lane 10. Walk lanes 1, 3 and 7 twice. Save `docs/scorecards/jul-276/pr-8/lane-10.png`. Pass when the console shows no error and no duplicate worker exists.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] Metric. Seconds from worker exit to the pill and its reason being on screen.
- [ ] Probe. A Playwright timing from the real worker exit after an unavailable-model failure to the pill assertion, five real practice-card attempts, take the median.
- [ ] Baseline. 5 seconds for the pill, 30 seconds for the Linear notification.
- [ ] Rule. Every pill inside five seconds and every notification inside thirty seconds, in five runs out of five.

**Review gate.**
- [ ] Send you a phone screenshot pair of the pill and of the Linear comment, a 30 to 60 second video of fail, reason and Try again, and the operator note that the reminder target was your profile.
- [ ] Merge waits for your yes in chat.

**Merge.**
- [ ] Merge with a merge commit, confirm main CI is green on that commit, and comment the commit on JUL-276.

## PR-9 Share Julia's Sentry project and Axiom dataset

**Depends on.** PR-8 only. Use the existing keys in the `Julia agents` 1Password vault. No setup from Todd is needed.

**Files.**
- [ ] Create `dashboard/lib/telemetry.js` and `dashboard/lib/telemetry.test.mjs`.
- [ ] Create `dashboard/instrumentation.js` and `dashboard/app/telemetry-report/page.jsx`.
- [ ] Add `DASHBOARD_SENTRY_DSN`, `DASHBOARD_AXIOM_TOKEN` and `DASHBOARD_AXIOM_DATASET` to `scripts/julia-agents.env` as references, never as values.
- [ ] Create `dashboard/docs/telemetry.md`.

**Build.**
- [ ] Reuse Julia's existing Sentry DSN, Axiom token and dataset references from the `Julia agents` 1Password vault. The agent adds their references to `scripts/julia-agents.env` and verifies they resolve without printing secrets. Create no separate resources and ask Todd for no setup.
- [ ] Send Start, Stop, build state change and price sweep to Julia's existing Axiom dataset, with fixed fields only and no free text.
- [ ] Send errors to Julia's existing Sentry project with a code and a run id, never a message body.
- [ ] Set `app=dashboard` on every dashboard error and log event. Use a Sentry tag and an Axiom field so both services can filter on the same `dashboard` label. Apply the label in the shared telemetry sender so callers cannot omit or override it.
- [ ] Neither sender throws, and a missing value downgrades to a warning, following the shape `lib/boot-events.js` already proves in Julia's app.
- [ ] The watchdog down ping stays exactly as PR-2 shipped it, so an outage never depends on Sentry or Axiom to reach you.
- [ ] `telemetry-report` lists the last twenty events and the last error, and only renders when `DASHBOARD_REPORT=1`.

**You see.**
- [ ] Find a real dashboard error in Julia's Sentry project and a real Start event in Julia's Axiom dataset by filtering each service on `app=dashboard`. Keep the run id and the matching remote records as proof. A local report alone does not pass.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] Event shape is tested, and the test fails when a free text field reaches Axiom.
- [ ] Error and log event labels are tested. The test fails if any emitted record lacks `app=dashboard` or a caller can replace it.
- [ ] The missing value path is tested, and the test fails when telemetry raises into a request.
- [ ] The blocked network path is tested, and the test fails when a request waits on telemetry.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `commandcode/deepseek/deepseek-v4.1-flash` at the PR head, each in its own worktree, port and state folder.
- [ ] Lane 1. Start a real practice-card build and open the report. Query Julia's existing Axiom dataset with the filter `app=dashboard`. Save `docs/scorecards/jul-276/pr-9/lane-1.png` and the matching remote record. Pass when the Start event is findable by that label and matches the build's run id and Julia's dataset name.
- [ ] Lane 2. Stop that build. Save `docs/scorecards/jul-276/pr-9/lane-2.png`. Pass when a stop event shows beside the start event.
- [ ] Lane 3. Read a state change row. Save `docs/scorecards/jul-276/pr-9/lane-3.png`. Pass when it names starting, running and finished in order.
- [ ] Lane 4. Run the sweep by hand. Save `docs/scorecards/jul-276/pr-9/lane-4.png`. Pass when one sweep row shows with added and retired counts.
- [ ] Lane 5. Start a real practice-card build with an unavailable model to produce a real worker error. Query Julia's existing Sentry project with the tag filter `app:dashboard`. Save `docs/scorecards/jul-276/pr-9/lane-5.png` and the matching remote record. Pass when the dashboard error is findable by that label and matches the report's code and run id.
- [ ] Lane 6. Unset the Axiom token and start a build. Save `docs/scorecards/jul-276/pr-9/lane-6.png`. Pass when the build runs and one warning shows.
- [ ] Lane 7. Block the telemetry hosts. Save `docs/scorecards/jul-276/pr-9/lane-7.png`. Pass when Start and Stop still answer inside the perf gate.
- [ ] Lane 8. Open the report at 390 by 844. Save `docs/scorecards/jul-276/pr-9/lane-8.png`. Pass when rows are readable and no label is cut.
- [ ] Lane 9. Open the dashboard with `DASHBOARD_REPORT` unset. Save `docs/scorecards/jul-276/pr-9/lane-9.png`. Pass when the report route answers 404.
- [ ] Lane 10. Walk lanes 1 to 5 twice. Save `docs/scorecards/jul-276/pr-9/lane-10.png`. Pass when the console shows no error and no duplicate event is sent.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.
- [ ] Metric. Milliseconds added to a Start or Stop request by the telemetry send.
- [ ] Probe. Compare the same request with telemetry on and off, twenty samples each, take the medians.
- [ ] Baseline. 50 ms added at the median, and 5 percent on time to first byte.
- [ ] Rule. The median must be at or under the baseline in two runs out of three.

**Review gate.**
- [ ] Send you a screenshot of the report page and a 30 to 60 second video of a real build. Include the remote proof of its Start event in Julia's Axiom dataset and its error in Julia's Sentry project, each found by filtering on the `dashboard` label. Include an operator note confirming that both use Julia's existing resources and that no separate project or dataset was created.
- [ ] Merge waits for your yes in chat.

**Merge.**
- [ ] Merge with a merge commit, confirm main CI is green on that commit, and comment the commit on JUL-276.

## Close the program

The program is finished when all nine PRs are merged to main, main CI is green on each merge commit, each commit is commented on JUL-276, and each PR's scorecard is written and committed. The two practice cards you asked for are created by the agent in the Dashboard project with titles starting `Practice:` and cancelled at the end, so nothing of theirs is left in Ready. The dashboard is running as a service from main at the tailnet address, the sweep timer is enrolled, and the watchdog sends dashboard-down Linear notifications to Todd without a standing service issue. Verify the notification path still works with JUL-276 Complete. PR-9's proof includes a real dashboard error found in Julia's existing Sentry project and a real Start event found in Julia's existing Axiom dataset, both filtered by the `dashboard` label. The decision records in `dashboard/docs/decisions/` carry every choice this program made, including the six decisions below that were taken while planning, and the card's own record is a comment naming the nine commits. Then JUL-276 goes Complete in Linear, and the retro waits for your approval as usual.

## Appendix A Prototype evidence

Everything here was run on this server today, and each result is what the plan leans on.

- The headless CLI runs, exits 0, and emits 34 JSONL events with a thread id and usage, so a worker can read live status from the stream.
- The CLI never flushes traces. Two per-run trace databases stayed empty after clean exits, and `run-mc.js` ends without a shutdown call, which is why the worker drives the SDK in process instead.
- The SDK path with `getMastra().shutdown()` wrote a 3.6 MB trace database with model token rows for the run, so cost recording can stay on for every build.
- Two concurrent CLI runs collided on one thread lock because both resumed the most recent thread. Two concurrent runs with their own app data dirs both exited 0, so per-run folders are the isolation rule.
- `listAvailableModels()` answered 8,243 models with 142 carrying a key, split 17 anthropic, 52 openai, 72 commandcode and 1 mastracode, so the sweep has an account-scoped source.
- Read-only probes found that the existing Sentry and Axiom tokens cannot create resources. Todd's revised 28 October decision removes that requirement. Reuse Julia's existing project, dataset and vault keys without waiting for new resources.
- The pack beats the launch model. `activeModelPackId` is `custom:sol/deepseek` and that is why today's session ran DeepSeek in build mode and GPT-6.1 Sol in plan mode.
- The connection reset was reproduced on purpose. Eight concurrent long requests reset seven times with `read ECONNRESET` on a 200 stream, the same signature as the failures in this session, and short replies never failed.
- The cap was tested and rejected. Six concurrent long requests with a 10,000 token cap passed 6 of 6, and five of them stopped at the cap, which is why output stays at the model maximum and the fix is a write guard plus a retry.
- The observer never decides a run. All three observer resets recovered within a second while the main turn kept issuing tool calls.

## Appendix B Decisions taken while planning this program

- Cost recording stays on for every dashboard build, solved with a per-run app data folder and a shutdown call rather than switched off, which is your 28 October instruction.
- The dashboard is its own app in `dashboard/`, server only, with its own decision records and glossary, and it is never part of Julia's Vercel app.
- Todd revised decision 0022 on 28 October 2026. The dashboard shares Julia's existing Sentry project and Axiom dataset using keys already in the agents vault. Every dashboard error and log event has the label `app=dashboard`. PR-9 requires no setup from Todd and is complete only when a real dashboard error and Start event are findable in those services by that label.
- The model list and every price come from the weekly sweep, and the screen shows only what the sweep saved, so no model reaches the screen without a price.
- No output cap. Output stays at the model maximum per your 25 October decision, and the reset is answered with a size-refusing write guard and a retry with a growing wait.
- The main session choice is applied as a model pack for plan and build, because a launch model is overwritten by the active pack.
- An observer error is never a run failure, agreed on 28 October after all three today recovered on their own.

## Appendix C Risks and what this plan does about them

- The sweep could read a pricing page whose shape changed and save a wrong price. Each parse has a fixture and a zero-result failure test, and the sweep log keeps the page it read with the date.
- A per-run config home could lose the subscription credentials. The worker copies the settings and the auth file into the run folder, and the run fails as `Didn't start` with a plain reason rather than silently using another account.
- A long build could be cut by a merge to main. The updater skips while any run is starting or running, and it is the only thing allowed to move the deployed checkout.
- A restarted dashboard could lose track of a running build. Workers run detached in their own session and the supervisor rebinds from run files and pid liveness.
- The write guard could block a legitimate large file. It answers `write this in parts`, and the proof requires the same file to land in parts, so a blocked build keeps working rather than stalling.
- Telemetry could slow the screen down. Both senders never throw and are measured against a 50 ms median budget with the network blocked.

## Appendix D Links

- The card is JUL-276 in the Julia-next team, with the Start screen controls and sources document attached to it as a Linear document.
- The approved design is the picture set from 27 October, picture 08 for this screen and picture 12 for the colours.
- The decisions this program must obey are 0007, 0009, 0011 to 0016 and 0020 to 0022, ported into `dashboard/docs/decisions/` by PR-1.
- The runner is a Mastra workflow per your 27 October decision, and the worker in PR-6 is the piece that runs one build.
- The stop ping path that the finish ping follows is `scripts/stop-ping.mjs` with ADR 0024, already in main.

