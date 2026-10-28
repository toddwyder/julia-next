# JUL-276 Start screen plan

Todd opens the dashboard on the server, sees his Ready cards, opens one, picks models and effort, presses Start, watches the build run, and stops it if he wants. Work lands as seven small PRs, each proven on the screen he uses. The program enforces one rule, every PR shows on a screen or Todd approves the exception in writing.

- PR-1 dashboard page you can open, Ready cards on it
- PR-2 Start screen read only, matching picture 08
- PR-3 model, group, panel and effort controls that change things
- PR-4 start with last settings
- PR-5 spike, no screen, effort reaches every helper
- PR-6 start and stop a real build
- PR-7 did not start, try again, finish ping, several builds at once

## How to read this

One box is one unit of work and every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run or a SHA. The body is a how-to, the appendices explain and record.

The program runs `playbooks/autopilot-full.md` from `.agents/skills/poteto-mode`. Each PR has one owner who carries it from build to merge. Todd's yes is a gate on PR-1, PR-2, PR-3, PR-4, PR-6 and PR-7, because each one changes something he uses. PR-5 has no screen and needs his explicit approval before it starts.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State this plan to Todd and stop. Start only on his explicit go.
- [ ] Read these from trunk at program start and again at every tick.
  - [ ] `git show origin/main:.agents/skills/poteto-mode/playbooks/autopilot-full.md`
  - [ ] `git show origin/main:.agents/skills/poteto-mode/playbooks/multi-phase-plan.md`
  - [ ] `git show origin/main:.agents/skills/swarm/SKILL.md`
  - [ ] `git show origin/main:.agents/skills/verify-julia/SKILL.md`
  - [ ] `git show origin/main:.agents/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `git show origin/main:.agents/skills/poteto-mode/playbooks/shipping.md`
  - [ ] `git show origin/main:docs/plans/path-forward.md`
  - [ ] `git show origin/main:CODING_STANDARDS.md`
- [ ] On Todd's go, arm the audit tick as `/loop 1h`. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to Todd in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only he can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in the decision trail. The row names the items reported, or none."
- [ ] On Todd's hold or stand-down, send every owner a zero-writes order at once.
- [ ] Ask Todd these three things now, in one message, and keep building nothing that needs the answer.
  - [ ] Approve PR-5 as an exception, it ships no screen because it proves a machine fact.
  - [ ] Create two practice cards in Ready, each asking for a docs-only change, so the first real build is harmless.
  - [ ] Accept that a model with no published price shows "No published price" instead of a number, because CommandCode's DeepSeek V4.1 Flash has no listed price.

### Spawn owners

- [ ] Spawn one owner per PR with the lifecycle `autopilot-full` names. Owners branch from `main`, never stacked.
- [ ] Follow this dependency graph. Start a child only after its parent merges.
  - [ ] PR-1 and PR-5 are independent and first. PR-1 needs no card and no settings, PR-5 needs no screen.
  - [ ] PR-2 after PR-1.
  - [ ] PR-3 after PR-2.
  - [ ] PR-4 after PR-3.
  - [ ] PR-6 after PR-4.
  - [ ] PR-7 after PR-6.
- [ ] Hold the file boundaries. PR-1 and PR-2 touch only `app/dashboard/**`, `lib/dashboard/**`, `docs/design/dashboard/**`, `docs/adr/**`, `scripts/linear-cli.mjs`, `.agents/skills/verify-julia/tests/dashboard*.spec.mjs`. PR-3 and PR-4 add only `lib/dashboard/start-*.js` and the Start screen files. PR-5 touches only `scripts/**` and `docs/research/**`. PR-6 and PR-7 add only `lib/dashboard/run*.js`, `app/api/dashboard/**`, `instrumentation.js` and `dashboard/kickoff.md`.
- [ ] Hold the review gate. PR-1, PR-2, PR-3, PR-4, PR-6 and PR-7 change an interaction. They wait for Todd's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`, and use `origin pr` instead if `command -v origin` succeeds and Origin resolves this repository. Record any fallback.
- [ ] Open the PR ready, never draft, base `main`.
- [ ] Run `npm run build`, `npm run lint:framework` and `node scripts/test-owners.mjs --run local` once before the PR-facing push. Push with hooks on.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`.
- [ ] Rebase onto current trunk before the code-ready report and babysit. Rebase again only at merge prep, on a `git merge-tree` conflict, or on a CI failure that comes from trunk.
- [ ] Write the card's scorecard line into the PR body with `node scripts/scorecard.mjs JUL-276`, per ADR 0024.

### Verdict and merge, for every PR

- [ ] A full swarm runs once at the code-ready head, per `.agents/skills/swarm/SKILL.md`, one gates lane, the ten live lanes below, the perf lane, and two audit lanes that distrust the PR body.
- [ ] Clean only when every lane is PASS. Send findings back to the owner, including defects a lane filed as a note.
- [ ] Todd's yes on the screen is required before merge for PR-1, PR-2, PR-3, PR-4, PR-6 and PR-7. PR-5 merges on the gates plus his approval of the exception.
- [ ] The owner merges its own PR, then confirms main CI is green on the merge commit and records that commit on the card.

### Boot recipe, for every live lane

Each lane runs in its own worktree on this server at the PR head, driven through `.agents/skills/verify-julia/SKILL.md`. There is no cloud VM in this repo and no `control-ui` skill installed, so `verify-julia` is the control skill.

- [ ] `git worktree add /home/ubuntu/verifications/jul-276-<pr>-<lane> <head SHA>` and `npm ci` in it.
- [ ] Start with `DASHBOARD_MACHINE=0 npm run build && DASHBOARD_MACHINE=0 npm run start -- --port <3100 + lane>`. Wait for the ready line, then load `http://127.0.0.1:<port>/dashboard`.
- [ ] Deliver input only through the named Playwright browser session. Name the read-only diagnostics when a lane needs them, `curl -s -o /dev/null -w '%{http_code}'` and `node scripts/julia-agents.mjs -- node scripts/linear-cli.mjs get-issue <ID>`.
- [ ] Save every screenshot to `docs/scorecards/jul-276/pr-<n>/<slug>.png` and return the paths with the report.
- [ ] Remove the worktree after the lane reports, per `playbooks/worktree-cleanup.md`.

## Build the dashboard page you can open (PR-1)

**Depends on.** None.

**Files.**

- [ ] Create `app/dashboard/layout.jsx`, the Mint and Iris tokens, Public Sans, and the gate that answers 404 unless `DASHBOARD_MACHINE=1`.
- [ ] Create `app/dashboard/page.jsx`, the Ready card list as a server component.
- [ ] Create `app/dashboard/dashboard.module.css`.
- [ ] Create `lib/dashboard/cards.js`, which asks Linear for Ready cards and maps them to `{id, title, url}`.
- [ ] Create `lib/dashboard/cards.test.mjs`.
- [ ] Edit `scripts/linear-cli.mjs`, adding `listReady(opts)` and a `list-ready` command that prints JSON.
- [ ] Create `scripts/linear-cli.test.mjs`, covering `listReady` and `setState` argument building against a stubbed `fetchImpl`.
- [ ] Create `docs/adr/0026-dashboard-runs-on-the-server.md`, recording that the dashboard is a route in this Next app, served by `next start` on the server, reached over Tailscale, gated by `DASHBOARD_MACHINE`, and that its runner is in-process so one unit serves it.
- [ ] Copy `08-phone-start-screen.png` and `12-design-system-mint-iris.png` from `origin/pilot/dashboard-d2` into `docs/design/dashboard/`.
- [ ] Create `.agents/skills/verify-julia/tests/dashboard.spec.mjs` with the Ready list, empty and gate cases.

**Build.**

- [ ] `readReadyCards()` in `lib/dashboard/cards.js` runs `node scripts/julia-agents.mjs -- node scripts/linear-cli.mjs list-ready` with a 10 second timeout and returns cards sorted by identifier.
- [ ] `listReady()` in `scripts/linear-cli.mjs` queries the Julia-next team for issues in the state whose name is Ready, page size 50, and returns identifier, title, url and state.
- [ ] `app/dashboard/layout.jsx` exports `dynamic = 'force-dynamic'`, sets `colorScheme` light, loads Public Sans through `next/font/google`, and calls `notFound()` when `process.env.DASHBOARD_MACHINE !== '1'`.
- [ ] `page.jsx` renders one row per Ready card with its identifier and title, no Start button yet, and the three states below.
- [ ] Empty state shows one plain line, "Nothing is ready. Cards land here when they are settled."
- [ ] Loading state comes from `app/dashboard/loading.jsx`, a skeleton of three rows.
- [ ] Failed state renders when the Linear read throws, with the line "The dashboard cannot reach Linear." and nothing else.
- [ ] `DASHBOARD_SIMULATE_FAILURE=linear` makes the read throw, so the failed state is provable and demoable.
- [ ] Tokens live in `dashboard.module.css` as custom properties, mint `#10B981`, iris `#6366F1`, amber `#F59E0B`, slate `#64748B`, rose sampled from picture 12, and every status also carries a word.

**You see.**

- [ ] `http://<tailscale-host>:3000/dashboard` lists only Ready cards, each with its identifier and title.
- [ ] With `DASHBOARD_MACHINE=0` the route answers 404 and no card data appears.
- [ ] With `DASHBOARD_SIMULATE_FAILURE=linear` the page shows the reach failure line and no rows.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `lib/dashboard/cards.test.mjs` proves the ready filter keeps only state Ready, that ordering is by identifier, and that a command failure throws a typed error. Run `node --test lib/dashboard/cards.test.mjs`.
- [ ] `scripts/linear-cli.test.mjs` proves `listReady` sends one query with the Ready state name and `setState` resolves a state id before updating. Run `node --test scripts/linear-cli.test.mjs`.
- [ ] CI discovers both files, `node scripts/test-owners.mjs --plan` lists them under the root owner.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `commandcode/deepseek/deepseek-v4.1-flash` at the PR head, one worktree each, driven through `verify-julia`.

- [ ] Lane 1. Regression lane against trunk. Open `/dashboard` at trunk and at head. Trunk answers 404, record that. Save `lane-1-trunk-404.png`. Pass when trunk is 404 or has no route and the head lists Ready cards.
- [ ] Lane 2. A Ready card appears once with its identifier and title and nothing else. Save `lane-2-ready-row.png`. Pass when the row count equals the number of Ready cards and no non-Ready card appears.
- [ ] Lane 3. A card moved out of Ready in Linear disappears from the page on reload. Save `lane-3-left-ready.png`. Pass when the row count drops by one and the identifier is gone.
- [ ] Lane 4. Empty state, proven on a worktree pointed at a Linear stub with zero Ready cards. Save `lane-4-empty.png`. Pass when the single empty line shows and no row renders.
- [ ] Lane 5. Failed state through `DASHBOARD_SIMULATE_FAILURE=linear`. Save `lane-5-failed.png`. Pass when the reach line shows, no row renders, and the page does not crash.
- [ ] Lane 6. Loading state on a throttled load. Save `lane-6-loading.png`. Pass when three skeleton rows show before content and vanish after it.
- [ ] Lane 7. Phone width 390 by 844. Save `lane-7-phone.png`. Pass when every identifier and title is fully visible, no ellipse, no horizontal scroll.
- [ ] Lane 8. Desktop width 1280 by 800. Save `lane-8-desktop.png`. Pass when the same rows show in one column at full width and nothing is cut.
- [ ] Lane 9. Gate off, run with `DASHBOARD_MACHINE=0`. Save `lane-9-gated.png`. Pass when the response is 404 and no card data is in the HTML.
- [ ] Lane 10. Browser console and network. Save `lane-10-console.png`. Pass when there are zero console errors and zero failed requests apart from the deliberate ones.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Server response time for `/dashboard`, ten sequential `curl -w '%{time_total}'` samples, median reported.
- [ ] Probe. Run the curl loop at trunk and at head, interleaved, against ports 3100 and 3101. Trunk has no route, so the trunk number is the 404 path and only records the floor.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Head median must stay under 1500 ms with Linear reads included, and under 300 ms when the 10 second card cache is warm. Over either number fails the lane.

**Review gate.** Todd reviews before merge.

- [ ] Copy lane 2, 4, 5, 7 and 8 screenshots into `docs/scorecards/jul-276/pr-1/review/`.
- [ ] Record a 30 to 60 second video of the page on a lane worktree, phone width, showing rows, empty state and failed state. Save it as `docs/scorecards/jul-276/pr-1/review/pr-1.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Owner squash-merges its own PR and confirms main CI green on the merge commit.

## Show the Start screen read only (PR-2)

**Depends on.** PR-1.

**Files.**

- [ ] Create `app/dashboard/start/[card]/page.jsx`, the server component that loads the card, the catalogue and last settings.
- [ ] Create `app/dashboard/start/[card]/start-screen.jsx`, the client shell that renders the screen from props and changes nothing yet.
- [ ] Create `app/dashboard/start/[card]/start-screen.module.css`.
- [ ] Create `lib/dashboard/catalogue.js`, which loads the live models.dev catalogue, scopes it to Todd's three accounts and joins prices.
- [ ] Create `lib/dashboard/catalogue.test.mjs`.
- [ ] Create `lib/dashboard/roles.js`, the five groups and the 17 pstack role lines with one-line plain explanations.
- [ ] Create `lib/dashboard/roles.test.mjs`.
- [ ] Create `docs/adr/0027-models-and-prices-from-models-dev.md`, recording the catalogue source, the hourly cache, the bundled fallback and the no-price display.
- [ ] Create `.agents/skills/verify-julia/tests/dashboard-start.spec.mjs`.

**Build.**

- [ ] `loadCatalogue()` fetches `https://models.dev/api.json` with a 20 second timeout, keeps providers `anthropic` and `openai` plus every provider named in the mastracode settings `customProviders`, and maps each model to `{id, provider, name, in, out, free}` from `cost.input` and `cost.output`, both already per million tokens.
- [ ] The catalogue caches to `~/.local/state/julia/dashboard/catalogue.json` with the fetch time, refreshes when older than one hour, serves the cache when the fetch fails, and falls back to `@mastra/observability` `pricing-data.json` only when no cache exists.
- [ ] A model with no entry shows `No published price` and never a zero.
- [ ] `lib/dashboard/roles.js` exports `GROUPS` with the model for each group and `ROLES` with the 17 pstack role lines, the group each belongs to, and a plain explanation of at most 90 characters.
- [ ] The screen shows the card title, the main session model with its price, the Shipping model with its price, the effort summary, the effort picker with Large preselected from last settings if any, and the group rows with a down arrow.
- [ ] A group row shows one model for the whole group. The arrow reveals its roles, each with its own model and an info icon.
- [ ] An info icon opens a small popup with that role's explanation, dismissed by a tap anywhere.
- [ ] Panels render their model list as chips with a cross and an add chip, and a panel never renders empty.
- [ ] Start sits fixed at the bottom and is disabled in this PR, with the title attribute `Not wired yet`.
- [ ] Back returns to `/dashboard`.

**You see.**

- [ ] `/dashboard/start/<card>` shows the title, both summary models with prices, the effort picker with four options and the info popup, and five group rows.
- [ ] Opening Building shows four roles each with a model and an info icon, and no main session row anywhere inside a group.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `catalogue.test.mjs` proves scoping keeps only the three account providers, that price mapping reads per-million input and output, that a missing model yields the no-price marker, and that a failing fetch serves the cache. Run `node --test lib/dashboard/catalogue.test.mjs`.
- [ ] `roles.test.mjs` proves every role line in `~/.agents/pstack-models.md` that belongs to a group has exactly one entry, that group models match the settings file, and that every explanation is 90 characters or fewer. Run `node --test lib/dashboard/roles.test.mjs`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `commandcode/deepseek/deepseek-v4.1-flash` at the PR head, one worktree each, driven through `verify-julia`.

- [ ] Lane 1. Regression lane against trunk. Open `/dashboard/start/JUL-276` at trunk and head. Trunk is 404, record that. Save `lane-1-trunk-404.png`. Pass when trunk has no screen and the head renders the full screen.
- [ ] Lane 2. Top summary shows the master model and the Shipping model, each with a price. Save `lane-2-summary.png`. Pass when both names render and both carry either a price or the no-price marker.
- [ ] Lane 3. Effort picker shows Small, Medium, Large and Unlimited, each with one to four brains, and Large is preselected. Save `lane-3-effort.png`. Pass when four options render, the brain count matches and Large carries the selected mark.
- [ ] Lane 4. Effort info icon opens the exact line "How hard the models think. More brains is slower and costs more." Save `lane-4-effort-info.png`. Pass when the popup text matches exactly and closes on a tap outside.
- [ ] Lane 5. All five group rows render the group model, and Building opens to four roles each with its own model. Save `lane-5-groups.png`. Pass when five groups show, four Building roles show and no main session row exists inside a group.
- [ ] Lane 6. A role info popup shows its plain explanation and none is longer than 90 characters. Save `lane-6-role-info.png`. Pass when the popup matches the role and every explanation in the DOM is 90 characters or fewer.
- [ ] Lane 7. Panels open to chips with a cross and an add chip, and removing the last chip is refused. Save `lane-7-panels.png`. Pass when chips render with price on each and the last chip cannot be removed.
- [ ] Lane 8. Model list from a model name tap shows only the three accounts' models, each with down-arrow price, and the info icon explains the arrows. Save `lane-8-model-list.png`. Pass when every row carries an arrow price or the no-price marker and no other provider appears.
- [ ] Lane 9. Phone 390 by 844 and desktop 1280 by 800 side by side with picture 08. Save `lane-9-phone-vs-picture.png` and `lane-9-desktop.png`. Pass when the layout order matches the picture, labels are uncut and no Stitch frame is drawn.
- [ ] Lane 10. Console and network. Save `lane-10-console.png`. Pass when zero console errors appear, the catalogue request happens once per page load and Start is present but disabled.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Server render time for the Start screen with a cold and a warm catalogue cache, ten samples each, median reported.
- [ ] Probe. `curl -w '%{time_total}'` on a warm cache, then once after deleting the cache file, at trunk and at head, interleaved.
- [ ] Baseline. Record the trunk 404 median first.
- [ ] Rule. Head cold median under 4000 ms including the 5.9 MB catalogue fetch, warm median under 400 ms. Over either number fails.

**Review gate.** Todd reviews before merge.

- [ ] Copy lane 2, 3, 5, 7 and 9 screenshots into `docs/scorecards/jul-276/pr-2/review/`.
- [ ] Record a 30 to 60 second video walking the screen top to bottom, opening one group and one info popup. Save it as `docs/scorecards/jul-276/pr-2/review/pr-2.mp4`.
- [ ] Post the screenshots, the side-by-side comparison and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Owner squash-merges its own PR and confirms main CI green on the merge commit.

## Change models, groups, panels and effort (PR-3)

**Depends on.** PR-2.

**Files.**

- [ ] Create `lib/dashboard/start-settings.js`, the defaults and one pure reducer over the Start screen state.
- [ ] Create `lib/dashboard/start-settings.test.mjs`.
- [ ] Edit `app/dashboard/start/[card]/start-screen.jsx`, wiring the controls to the reducer.
- [ ] Create `app/dashboard/start/[card]/model-picker.jsx`.
- [ ] Create `app/dashboard/start/[card]/group-row.jsx`.
- [ ] Create `app/dashboard/start/[card]/effort-picker.jsx`.
- [ ] Create `app/dashboard/start/[card]/panels.jsx`.

**Build.**

- [ ] `start-settings.js` exports `initialSettings(catalogue, last)` and `reduce(start, action)` with actions `pick-main`, `pick-shipping`, `pick-group`, `pick-role`, `add-panel-model`, `remove-panel-model` and `pick-effort`.
- [ ] `pick-group` writes the chosen model to every role in that group and marks those roles as group-set.
- [ ] `pick-role` sets one role only and marks it as overridden, so the group row keeps the group model.
- [ ] `remove-panel-model` refuses when one model is left.
- [ ] Every model name is a button that opens the model picker, filtered to the three accounts, each row showing name, price and the free marker when the price is zero.
- [ ] The picker carries an info icon that explains down arrow for input price and up arrow for output price, per million tokens.
- [ ] The effort picker writes one of `small`, `medium`, `large`, `unlimited` and the summary line follows it.
- [ ] State survives a group collapse and an info popup open and close.

**You see.**

- [ ] Tapping the Building model and picking another one changes all four Building roles in one move.
- [ ] Tapping one Building role and picking another model changes that role only, and the group row keeps its own model.
- [ ] Removing a panel chip leaves the rest, and the last chip has no cross.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `start-settings.test.mjs` proves group set overwrites all roles in the group, role override survives a later group change only for roles it did not set, the last panel model cannot be removed, and effort changes the summary. Run `node --test lib/dashboard/start-settings.test.mjs`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `commandcode/deepseek/deepseek-v4.1-flash` at the PR head, one worktree each, driven through `verify-julia`.

- [ ] Lane 1. Regression lane against trunk. Screenshot the Start screen at the previous head and at this head. Save `lane-1-before-after.png`. Pass when every read-only element from PR-2 still renders.
- [ ] Lane 2. Change the Building group model. Save `lane-2-group-change.png`. Pass when all four Building roles show the new model.
- [ ] Lane 3. Change one Building role. Save `lane-3-role-override.png`. Pass when that role shows its own model and the other three keep the group model.
- [ ] Lane 4. Model list contents and prices. Save `lane-4-picker.png`. Pass when only anthropic, openai and commandcode models appear and every row has a price or the no-price marker.
- [ ] Lane 5. Panel add and remove with the last chip protected. Save `lane-5-panels-edit.png`. Pass when a removed chip is gone and the last chip shows no cross.
- [ ] Lane 6. Effort change from Large to Unlimited updates the summary and keeps the selection. Save `lane-6-effort-change.png`. Pass when four brains show and the summary names Unlimited.
- [ ] Lane 7. Info popups for three different roles each show their own text. Save `lane-7-popups.png`. Pass when three texts differ and none is jargon.
- [ ] Lane 8. State survives collapse and popup round trips. Save `lane-8-state-kept.png`. Pass when every edit from lanes 2, 3, 5 and 6 is still shown afterwards.
- [ ] Lane 9. Phone 390 by 844 and desktop 1280 by 800 with the picker open. Save `lane-9-phone-picker.png` and `lane-9-desktop-picker.png`. Pass when the picker fits the phone screen, scrolls inside itself and nothing is cut.
- [ ] Lane 10. Console and network. Save `lane-10-console.png`. Pass when zero console errors appear and the edits issue no network calls.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Input latency of one group change in the browser, measured as the time from click to the painted update, ten samples, median reported.
- [ ] Probe. Run the same Playwright script at the previous head and at this head, interleaved, for a picker open and a pick.
- [ ] Baseline. Record the previous head median first, since the previous head cannot change a model.
- [ ] Rule. Head median under 150 ms per interaction, and no interaction over 400 ms. A frozen or delayed update fails.

**Review gate.** Todd reviews before merge.

- [ ] Copy lane 2, 3, 5, 6 and 9 screenshots into `docs/scorecards/jul-276/pr-3/review/`.
- [ ] Record a 30 to 60 second video showing a group change, a role override and a panel chip removal. Save it as `docs/scorecards/jul-276/pr-3/review/pr-3.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Owner squash-merges its own PR and confirms main CI green on the merge commit.

## Start with last settings (PR-4)

**Depends on.** PR-3.

**Files.**

- [ ] Create `lib/dashboard/store.js`, atomic JSON read and write for the dashboard state directory.
- [ ] Create `lib/dashboard/store.test.mjs`.
- [ ] Create `app/api/dashboard/settings/route.js`, GET and PUT of the last Start settings.
- [ ] Edit `app/dashboard/start/[card]/page.jsx`, loading last settings as the initial state.
- [ ] Edit `app/dashboard/start/[card]/start-screen.jsx`, adding the Start with last settings button at the top.

**Build.**

- [ ] `readState(name, fallback)` and `writeState(name, value)` write through a temp file and a rename inside `~/.local/state/julia/dashboard/`, with mode 0600.
- [ ] Last settings live in `~/.local/state/julia/dashboard/last-start.json` as `{main, shipping, effort, groups, roles, panels}`.
- [ ] The Start screen loads last settings on open, so the controls show the previous choice, and Large when nothing is saved.
- [ ] Start with last settings appears only when a saved file exists, and it resets every control to the saved values in one tap.
- [ ] Settings are saved only by a later Start press, so this PR proves the read path and the button, and PR-6 adds the write.

**You see.**

- [ ] On a fresh machine the screen opens with defaults and no Start with last settings button.
- [ ] With a seeded last-start file the screen opens showing those choices and the button, and the button restores them after edits.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `store.test.mjs` proves a write is atomic, survives a crash between temp write and rename, reads a missing file as absent instead of throwing, and keeps mode 0600. Run `node --test lib/dashboard/store.test.mjs`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `commandcode/deepseek/deepseek-v4.1-flash` at the PR head, one worktree each, driven through `verify-julia`.

- [ ] Lane 1. Regression lane against trunk. Open the Start screen at the previous head and at this head. Save `lane-1-before-after.png`. Pass when every PR-3 interaction still works.
- [ ] Lane 2. Fresh state, no saved file. Save `lane-2-no-saved.png`. Pass when defaults show and the button is absent.
- [ ] Lane 3. Seeded file loads its values. Save `lane-3-saved-loaded.png`. Pass when every control shows the seeded model and effort.
- [ ] Lane 4. Edit then press Start with last settings. Save `lane-4-restored.png`. Pass when every control returns to the seeded values in one tap.
- [ ] Lane 5. A corrupted file is ignored. Save `lane-5-corrupt.png`. Pass when defaults show, the page does not crash and one plain warning line appears.
- [ ] Lane 6. File mode is 0600 and the directory is 0700. Save `lane-6-mode.png`. Pass when `stat -c '%a'` shows exactly those modes.
- [ ] Lane 7. Two browser tabs reload without a partial read. Save `lane-7-two-tabs.png`. Pass when both tabs show identical values.
- [ ] Lane 8. Unknown model in the saved file is dropped. Save `lane-8-unknown-model.png`. Pass when that role falls back to its group model and the page renders.
- [ ] Lane 9. Phone 390 by 844 and desktop 1280 by 800 with the button present. Save `lane-9-phone.png` and `lane-9-desktop.png`. Pass when the button sits above the summary and nothing is cut.
- [ ] Lane 10. Console and network. Save `lane-10-console.png`. Pass when zero console errors appear and the settings GET returns 200 once per load.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Extra server time added by reading last settings, ten samples, median reported.
- [ ] Probe. `curl -w '%{time_total}'` on the Start screen with and without last-start present, at the previous head and at this head, interleaved.
- [ ] Baseline. Record the previous head median first.
- [ ] Rule. Head adds under 30 ms median against the previous head for the same scenario. Over 30 ms fails.

**Review gate.** Todd reviews before merge.

- [ ] Copy lane 2, 3 and 4 screenshots into `docs/scorecards/jul-276/pr-4/review/`.
- [ ] Record a 30 to 60 second video of edit, restore and reload. Save it as `docs/scorecards/jul-276/pr-4/review/pr-4.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Owner squash-merges its own PR and confirms main CI green on the merge commit.

## Prove effort reaches every helper (PR-5)

**Depends on.** None. It runs in parallel with PR-1 and touches no screen.

**Files.**

- [ ] Create `scripts/prove-effort.mjs`, a repeatable probe that runs headless builds and reads the results back.
- [ ] Create `scripts/prove-effort.test.mjs`, covering the reading and comparison helpers against a fixture database.
- [ ] Create `docs/research/effort-reaches-helpers.md`, the evidence report.
- [ ] Create `docs/adr/0028-effort-is-per-session.md`, recording how effort is delivered and what it cannot promise.

**Build.**

- [ ] The probe writes a per-run settings file with a chosen `thinkingLevel`, a per-run role models file, and a kickoff prompt that makes the build spawn one helper per group.
- [ ] The probe reads each run's thread and its subagent calls from `~/.local/share/mastracode/mastra.db`, using `readThreads` from `scripts/scorecard.mjs`.
- [ ] The probe runs each effort level three times, with hardcoded role models, and reports reasoning tokens per model, subagent model ids, and step counts.
- [ ] The report states, for each of the four effort options, whether the level reached the main session and every helper, with the database rows that show it.

**You see.**

- [ ] There is no screen in this PR, by Todd's explicit approval.
- [ ] The report shows a table of level, run, helper model id and reasoning tokens, and a verdict per level.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `prove-effort.test.mjs` proves the parser finds subagent calls with their model ids and reports a missing level as unknown instead of zero. Run `node --test scripts/prove-effort.test.mjs`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `commandcode/deepseek/deepseek-v4.1-flash` at the PR head, one worktree each, driven through `verify-julia`.

- [ ] Lane 1. Regression lane against trunk. Run the same probe against trunk, where no probe exists, and record that. Save `lane-1-trunk.txt`. Pass when trunk lacks the probe and the head produces the report.
- [ ] Lane 2. Small runs three times and each helper reports the same model ids as the role file. Save `lane-2-small.json`. Pass when nine of nine helper calls carry the intended model ids.
- [ ] Lane 3. Medium runs three times, same check. Save `lane-3-medium.json`. Pass when nine of nine match.
- [ ] Lane 4. Large runs three times, same check. Save `lane-4-large.json`. Pass when nine of nine match.
- [ ] Lane 5. Unlimited runs three times, same check. Save `lane-5-unlimited.json`. Pass when nine of nine match.
- [ ] Lane 6. Reasoning tokens rise with effort across levels. Save `lane-6-tokens.json`. Pass when the median per level is non-decreasing and Small is below Unlimited on at least two of three pairs.
- [ ] Lane 7. Two probe runs at once do not corrupt the database or the role files. Save `lane-7-parallel.json`. Pass when both runs report their own model ids and the database opens clean afterwards.
- [ ] Lane 8. A role model with no published price still runs. Save `lane-8-unpriced.json`. Pass when the run completes and the report marks the model as unpriced.
- [ ] Lane 9. A run that fails to start is reported as unknown, never as a pass. Save `lane-9-failed.txt`. Pass when the report shows unknown and the exit code is non-zero.
- [ ] Lane 10. Total spend for all runs in this PR is under 5 USD. Save `lane-10-spend.json`. Pass when the summed priced cost is under 5.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Probe wall time and total token cost for one level of three runs.
- [ ] Probe. Time `node scripts/prove-effort.mjs --level large` at the head, one level only, and record cost from the database.
- [ ] Baseline. The head is the first implementation, so record the single measured value as the budget.
- [ ] Rule. One level of three runs must finish under 20 minutes and under 2 USD, or the probe is too expensive to repeat and fails.

**Review gate.** None. PR-5 is not review-gated, because it ships no interaction and Todd approved the no-screen exception before it started.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Report committed under `docs/research/` with every database row it cites.
- [ ] Owner squash-merges its own PR and confirms main CI green on the merge commit.

## Start and stop a real build (PR-6)

**Depends on.** PR-4 and PR-5.

**Files.**

- [ ] Edit `instrumentation.js`, starting the supervisor when `DASHBOARD_MACHINE=1` and doing nothing otherwise.
- [ ] Create `lib/dashboard/runs.js`, the run record store and the reconcile-on-boot logic.
- [ ] Create `lib/dashboard/runs.test.mjs`.
- [ ] Create `lib/dashboard/supervisor.js`, which starts, watches and stops headless builds.
- [ ] Create `lib/dashboard/kickoff.js`, which renders the build prompt from `dashboard/kickoff.md` with the card and the role models file.
- [ ] Create `dashboard/kickoff.md`.
- [ ] Create `app/api/dashboard/runs/route.js`, POST to start and GET to list.
- [ ] Create `app/api/dashboard/runs/[id]/stop/route.js`.
- [ ] Create `app/api/dashboard/events/route.js`, the live update stream.
- [ ] Edit `app/dashboard/page.jsx` and `app/dashboard/dashboard.module.css`, adding the starting and running pill, Stop with its confirm, and the live update client.
- [ ] Edit `app/dashboard/start/[card]/start-screen.jsx`, enabling Start and saving last settings on press.
- [ ] Edit `scripts/linear-cli.mjs`, adding `setState(identifier, stateName)` and a `set-state` command.
- [ ] Create `docs/adr/0029-runner-lives-in-the-next-server.md`, recording the supervisor, the worktree per run, headless children, disk-backed state and tracing off.
- [ ] Create `.agents/skills/verify-julia/tests/dashboard-run.spec.mjs`.

**Build.**

- [ ] `POST /api/dashboard/runs` accepts `{card, settings}`, refuses a card that is not Ready, writes the run record, prepares a worktree at `~/builds/<card>-<runId>` on branch `card/<card>`, then moves the card to Implementation.
- [ ] The run record lives at `~/.local/state/julia/dashboard/runs/<runId>.json` with `{runId, card, startedAt, status, pid, worktree, branch, threadId, settings, reason}` and is written atomically.
- [ ] The supervisor spawns `mastracode --settings <run>/settings.json --model <main> --thinking-level <effort> --prompt <kickoff> --output jsonl --permission-mode auto`, with stdout to `<run>/events.jsonl`, and records the pid.
- [ ] The kickoff prompt names the card, the per-run role models file, the Shipping model, and the card's playbook, and tells the build to read its role models from that file.
- [ ] `POST /api/dashboard/runs/:id/stop` sends SIGTERM, waits up to 10 seconds, then SIGKILL, and leaves the worktree and branch in place.
- [ ] Stop shows the confirmation "Stop this build? The work is kept." and does nothing until confirmed.
- [ ] The card stays in Implementation after Stop, and the run status becomes stopped.
- [ ] A restart of the server reconciles every record against its pid, marks dead runs exited, and never starts a second child for the same run.
- [ ] `GET /api/dashboard/events` streams run status changes as server-sent events, so the page updates without a reload.
- [ ] Starting a run shows Starting then Running on both the page and the Start screen, and several runs can run at once.
- [ ] Tracing is off for dashboard runs, and the settings copy sets `observability.enabled` to false.
- [ ] `setState` resolves the team state id for the asked name and updates the issue, refusing unknown names.

**You see.**

- [ ] Press Start on the practice card. The page shows Starting, then Running, and the card is in Implementation in Linear.
- [ ] The build has a branch and a worktree, and its thread id appears on the page.
- [ ] Press Stop, confirm, and the pill shows Stopped. The branch and worktree remain and the card stays in Implementation.
- [ ] Start again and a new run starts fresh on the same branch.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `runs.test.mjs` proves a record round-trips atomically, that reconcile marks a dead pid exited once, that reconcile never spawns, and that a non-Ready card is refused. Run `node --test lib/dashboard/runs.test.mjs`.
- [ ] `scripts/linear-cli.test.mjs` proves `setState` resolves the wanted state and refuses an unknown name. Run `node --test scripts/linear-cli.test.mjs`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `commandcode/deepseek/deepseek-v4.1-flash` at the PR head, one worktree each, driven through `verify-julia`.

- [ ] Lane 1. Regression lane against trunk. Open the page and the Start screen at the previous head and at this head. Save `lane-1-before-after.png`. Pass when every PR-1 to PR-4 screen still renders and start stays disabled at the previous head.
- [ ] Lane 2. Start the practice card and watch Starting then Running without a reload. Save `lane-2-starting-running.png`. Pass when both states appear in order and the final state is Running.
- [ ] Lane 3. Linear shows the card in Implementation after Start. Save `lane-3-linear-state.png`. Pass when `get-issue` reports Implementation.
- [ ] Lane 4. Stop with confirm and the work is kept. Save `lane-4-stopped.png`. Pass when the pill shows Stopped, the worktree path exists, the branch exists, and the card is still in Implementation.
- [ ] Lane 5. Stop without confirming changes nothing. Save `lane-5-stop-cancel.png`. Pass when the confirm appears, cancel is pressed, and the build is still Running.
- [ ] Lane 6. Two builds run at once and both show on the page. Save `lane-6-two-runs.png`. Pass when two rows show Running with different thread ids.
- [ ] Lane 7. Restart the server mid-run and the page still reports the truth. Save `lane-7-restart.png`. Pass when reconcile marks the killed run exited and never launches a duplicate.
- [ ] Lane 8. Start is refused for a card that left Ready. Save `lane-8-not-ready.png`. Pass when the call returns a refusal and no worktree is created.
- [ ] Lane 9. Phone 390 by 844 and desktop 1280 by 800 with two runs. Save `lane-9-phone.png` and `lane-9-desktop.png`. Pass when Stop and the pill are visible and fully labelled with both word and colour.
- [ ] Lane 10. Console and network. Save `lane-10-console.png`. Pass when zero console errors appear and the event stream reconnects once after a dropped connection.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from Start press to the Running state on screen, and time from Stop press to the Stopped state.
- [ ] Probe. Run each action five times on the practice card, record with `performance.now` marks in the Playwright script, at the previous head and at this head.
- [ ] Baseline. Record the previous head first, where Start is disabled and only the page load is measured.
- [ ] Rule. Start to Running under 15 seconds with a warm cache and under 60 seconds cold, Stop to Stopped under 10 seconds. Over either number fails, because the run is local and the child is cheap to spawn.

**Review gate.** Todd reviews before merge.

- [ ] Copy lane 2, 4, 6 and 9 screenshots into `docs/scorecards/jul-276/pr-6/review/`.
- [ ] Record a 30 to 60 second video of Start, Running, Stop and confirm. Save it as `docs/scorecards/jul-276/pr-6/review/pr-6.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Owner squash-merges its own PR and confirms main CI green on the merge commit.
- [ ] Smoke the live dashboard on the server after the merge and revert if it fails.

## Did not start, try again, finish ping (PR-7)

**Depends on.** PR-6.

**Files.**

- [ ] Create `lib/dashboard/ping.js`, the finish and failure notification.
- [ ] Create `lib/dashboard/ping.test.mjs`.
- [ ] Create `app/api/dashboard/runs/[id]/retry/route.js`.
- [ ] Edit `app/dashboard/page.jsx` and `app/dashboard/dashboard.module.css`, adding the rose Did not start pill, its one-line reason and Try again.
- [ ] Edit `lib/dashboard/supervisor.js`, writing the reason on a spawn or early-exit failure and firing the ping on finish.

**Build.**

- [ ] A run that cannot spawn, or that exits non-zero before the agent starts working, becomes failed with a one-line reason taken from stderr, never a stack trace.
- [ ] The page shows a rose pill with the word Did not start, the reason line and a Try again button that starts a fresh run.
- [ ] A finished run posts a comment on its card and sets a Linear reminder, using `postComment` and the reminder mutation from `scripts/stop-ping.mjs`, so Todd's phone notifies him.
- [ ] The Start screen states `Ping when it finishes: Linear notification to Todd` as information, not a control.
- [ ] A ping failure is recorded on the run and shown nowhere as success.
- [ ] Several runs finishing at once each ping their own card.

**You see.**

- [ ] A card pointed at a build that cannot start shows the rose pill, the reason and Try again, and Todd's phone gets the Linear notification.
- [ ] A finished build comments on the card and sets a reminder, and the comment carries the thread id.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `ping.test.mjs` proves the comment body carries the card, the result and the thread id, that a reminder is set 30 seconds ahead, and that a failed comment is reported as not notified. Run `node --test lib/dashboard/ping.test.mjs`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `commandcode/deepseek/deepseek-v4.1-flash` at the PR head, one worktree each, driven through `verify-julia`.

- [ ] Lane 1. Regression lane against trunk. Run the PR-6 start and stop journey at the previous head and at this head. Save `lane-1-before-after.png`. Pass when Start, Running and Stop behave as before.
- [ ] Lane 2. A build that cannot start shows the rose pill, one line and Try again. Save `lane-2-did-not-start.png`. Pass when the pill carries the word, the reason is one line and Try again is present.
- [ ] Lane 3. Try again starts a fresh run and reaches Running. Save `lane-3-try-again.png`. Pass when a new run id appears and the state reaches Running.
- [ ] Lane 4. The failure comment lands on the card. Save `lane-4-failure-comment.png`. Pass when the comment body carries the reason and no secret appears.
- [ ] Lane 5. The finish comment lands on the card with the thread id. Save `lane-5-finish-comment.png`. Pass when the comment shows the card, the result and the thread id.
- [ ] Lane 6. The reminder is set on the card for 30 seconds ahead. Save `lane-6-reminder.json`. Pass when the mutation returns success and the reminder time is within a minute.
- [ ] Lane 7. The Start screen states the ping line and it is not a control. Save `lane-7-ping-line.png`. Pass when the line renders as text and has no input or button.
- [ ] Lane 8. Three runs finish at once and each card gets its own comment. Save `lane-8-three-pings.png`. Pass when three comments exist, one per card, with no duplicates.
- [ ] Lane 9. Phone 390 by 844 with the failed pill, showing word and colour. Save `lane-9-phone.png`. Pass when the pill word and the rose colour both show and the reason is not cut off.
- [ ] Lane 10. Console and network. Save `lane-10-console.png`. Pass when zero console errors appear and a failed ping shows the run as finished with an unnotified mark.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from child exit to the card comment existing, five samples, median reported.
- [ ] Probe. Run one practice build to completion at the previous head, where no ping exists, and five at this head, timing with `date +%s` around the Linear read.
- [ ] Baseline. Record the previous head first, which has no ping, so the baseline is the absent fact plus the run time.
- [ ] Rule. Ping under 30 seconds median after exit and under 90 seconds at worst. Over 90 seconds fails, because a phone notification that late is a lie about the build.

**Review gate.** Todd reviews before merge.

- [ ] Copy lane 2, 3, 5 and 9 screenshots into `docs/scorecards/jul-276/pr-7/review/`.
- [ ] Record a 30 to 60 second video of a failed start, the reason, Try again, and the comment landing. Save it as `docs/scorecards/jul-276/pr-7/review/pr-7.mp4`.
- [ ] Post the screenshots, the phone notification screenshot and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Owner squash-merges its own PR and confirms main CI green on the merge commit.
- [ ] Card moves to Complete in Linear with the merge commit in a comment after Todd's UAT yes.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Todd has opened the dashboard on his phone over Tailscale and started, watched and stopped a real build.
- [ ] Reply to Todd with the screenshots at phone width and desktop, the seven merged PRs with their commit SHAs, the effort report, and the three answers he gave at the start.

## Appendix A. Prototype evidence

Prototype one, headless builds work. Worktree `/tmp/proto-run`, run `mastracode --prompt "Reply with the single word: ready" --model commandcode/deepseek/deepseek-v4.1-flash --thinking-level low --output jsonl --permission-mode deny`. Exit 0, 34 JSONL events, `result` carried status completed, 16,403 input tokens, thread `c270ed50-3282-4345-9dae-a07db91777fa`. The stream contained one malformed line, so the parser must tolerate bad lines.

Prototype two, per-role models reach helpers. `/tmp/proto-run/settings.json` plus `/tmp/proto-run/roles.md` written by the runner, prompt told the agent to read the role file and spawn one explore helper with that model. Event stream showed 81 occurrences of `"modelId":"openai/gpt-6.1-sol"`, and `scripts/scorecard.mjs` `readThreads` showed the subagent call with `{agentType: 'explore', modelId: 'openai/gpt-6.1-sol'}`. No new code beyond writing two files and one prompt line.

Prototype three, effort is a signal only. Same prompt and helper model at xhigh gave 162 reasoning tokens in thread `976fcdf6-8e78-4a96-a5ce-bcf83879758d`, at low 71 in thread `6037f522-2a38-4c24-8870-976ffdd1accd`. One run each, so PR-5 turns this into nine runs per level before anything claims it.

Prototype four, parallel runs. Two headless runs launched together both exited 0 with the expected text, and the database reached 26 threads without visible corruption. The shell grouping in that probe misfiled one output file, so PR-5 repeats it with absolute paths.

Prototype five, the catalogue. `https://models.dev/api.json` fetch returned 200 and 5.9 MB, with anthropic `claude-opus-5` at 5 in and 25 out, openai `gpt-6.1-sol` at 2 in and 10 out, and no `deepseek-v4.1-flash` anywhere, which is why an unpriced model must show a plain marker.

Still unproven. That a prompt line is enough for every build to honour the role file in practice rather than by luck, that reasoning tokens per helper can be attributed reliably, and that a server restart can never orphan a child.

## Appendix B. Alternatives rejected

A separate runner service, rejected because two units to deploy and restart means two failure modes and a second port, and the Next process already has the lifecycle hook it needs.

A Vercel host for the dashboard, rejected because the machine that starts builds is this server and the page must talk to it locally. The route ships but stays 404 unless `DASHBOARD_MACHINE=1`.

Running builds through the `@mastra/core` controller API instead of a headless child, rejected because a crash in one build would take the dashboard with it, and the CLI path is proven.

A per-run isolated HOME holding its own `.agents/pstack-models.md`, rejected as heavier, because it needs symlinked skills and a copy of the auth state.

Bundled `pricing-data.json` alone for the model list, rejected because a new model would never appear and the card requires the list to refresh itself. The bundled table stays as the last-resort fallback.

Piping build events into `mastra.db` instead of a per-run `events.jsonl`, rejected for the first version because the CLI already writes what we need and a file per run is trivial to read back.

## Appendix C. Risks

PR-6 is the largest PR and may split inside its owner, per Todd's 28 October decision that pstack slices big cards at build time. Watch the run record and the supervisor boundary, which is where the split goes.

The prompt line that delivers per-run role models depends on the build obeying it. PR-5 proves it for the probe, and the kickoff file in PR-6 keeps it short and explicit. If a build ignores it, the fallback is the isolated HOME, which costs a day.

1Password must be unlocked for Linear reads and pings. A locked vault shows as the failed state on the page and as an unnotified run, never as a silent success.

CommandCode's DeepSeek V4.1 Flash has no published price. Todd sees the no-price marker on his own main coding model, which is honest but may look like a bug. The ADR records why.

`verify-julia` is the control skill because no `control-ui` skill is installed here. It drives Playwright against a local port, which is enough for every lane but gives no cloud isolation.

Several runs share one LibSQL database at `~/.local/share/mastracode/mastra.db`. Tracing is off for dashboard runs because only one process can hold the trace file. Concurrent writes were proven once and are watched in PR-6 lane 6.

## Appendix D. Links and reading list

Read before editing, `docs/design/` pictures on branch `pilot/dashboard-d2` at commit `19f3a31`, `docs/adr/0024-run-scorecard-and-stop-ping.md`, `docs/agents/server-runbook.md`, `docs/agents/issue-tracker.md`, `docs/plans/path-forward.md`, and the installed Next docs under `node_modules/next/dist/docs/` before writing any route.

PR-2 and PR-6 get a `how` pass on the models catalogue and the supervisor, and a `interrogate` pass before their code-ready report, because both carry behaviour that is hard to see on screen.

The decision trail per `show-me-your-work` lives at `docs/scorecards/jul-276/trail.tsv`, one row per decision with its evidence.
