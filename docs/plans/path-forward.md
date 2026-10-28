# Path forward — plan (agreed with Todd, 23 Oct 2026)

Working document. Each line is a decision Todd agreed in conversation.

## 24 October decisions (Todd)

- Deployment safety is dropped. The updater as sole service starter, its ownership of the Tailscale route, its test and its proofs are not built.
- Clean-up is one pull request with no card. Settled scope: the no-fakes CI check; the four writing-for-agents rules as one script that triage runs before showing Todd a brief; removal of live server-state descriptions from the setup notes; confirmation that Start's admission check accepts the current triage card shape by running it on JUL-263; this plan update.
- GitHub merge protection moves to the UAT-and-merge card (order of work 8).
- The pstack folder move, the framework-lint fix and the Code review column removal are cut.
- The board-style dashboard view is parked. The Linear board flow stands as written, without the Code review column change.

## Standing rule
- Every correction is fixed as high in poteto's inverse pyramid as it will go ([inverse-pyramid.md](../principles/inverse-pyramid.md)). Writing it into a file and hoping the agent follows it is not a fix.

## Roles (named by job, not by model)
- **Todd**: ideas, settling cards, UAT, approving retro lessons.
- **Planner agent**: works with Todd at the Idea step. Any frontier model can fill it (today Codex; could be Opus, Argon or another).
- **Machine**: runs one pstack session per Ready card (orchestrator + coder), then the steps after the PR.
- **Advisor** (Claude today): checks evidence against what Todd actually uses, helps Todd think, keeps retro notes. Instructions to the planner agent are fixed one-liners.

## Flow of a card
| Step | What happens | Who |
|---|---|---|
| Idea | Talk it through with `wayfinder` (big work), `grill-with-docs` (sharpen a plan; writes glossary/ADRs) or `triage` (writes the card and agent brief); `/recall` first to catch up on past attempts | Todd + planner agent |
| Settle | Todd reads the card and says "settled"; it moves to Ready | Todd |
| Build | Start runs one pstack session: build, review code (`/interrogate`), prove, open PR, inside the cap; live checklist on the dashboard | Machine |
| Evidence review | Independent check that the evidence proves each criterion | Machine (different-company model) |
| Staging | Regression suite and card checks on the preview | Machine |
| UAT | Only if the card changes something Todd uses directly | Todd |
| Merge | Automatic once every gate passes; live check after; card Complete | Machine |
| Retro | Machine runs `/correct` after merge, plus our own retros; one PR of fixes; merges after Todd approves the lessons | Machine + advisor + Todd |

## Pre-plan retired (11:17)
- Retired as a skill: its parts are covered by `wayfinder` / `grill-with-docs` / `triage` at the Idea step, by pstack at build (`how`, `architect`, prototype, prove-it-works, formal verification), and by learning tests in CI.
- Kept: `triage` writes cards; Start's admission check refuses a card that doesn't qualify (structure, not prose); Todd's "settled" gate.
- Two Todd rules lose their only text home and need a pyramid home: (1) no fake outside services in tests → CI check (built in the 24 Oct clean-up); (2) acceptance criteria describe what Todd needs → triage's "behavioral, not procedural" brief rule, enforced by `scripts/check-agent-brief.mjs` in the 24 Oct clean-up, rest judged at settle.
- If problems appear that pre-plan used to catch, the fix goes higher in the pyramid, not back into a procedure.

## Staging and smoke test (11:19–11:38)
- **Julia app cards:** on every PR, CI runs the regression suite against that PR's Vercel preview: every saved automated test, including the new card's. A failure sends the card back to the build. Todd never sees a broken preview.
- **Regression suite:** one automated test per feature, written by the builder as part of the build (pstack already writes tests for the acceptance criteria). Saved in the repo, so it joins every future run. One thing per feature, nothing else to keep in step.
- **`verify-julia`:** keeps pstack's verification-skill shape, but becomes generic: how to point the suite at a preview address, plus hand exploration when something can't be automated. Rewritten for Linux; its feature map loses the step-by-step driving recipes. Today's two features already have automated tests (`tests/home.spec.mjs`, `tests/release.spec.mjs`).
- **Machine cards:** staging is the proof itself, run on the server through Todd's Tailscale address (retro fix 1).

## Skill names (11:38–11:40)
- Installing pstack on 22 Oct overwrote Pocock's `tdd` and `teach` in `.agents/skills`; `.claude/skills` still has Pocock's, so the same name means different things per agent.
- Decided: retire Pocock's `tdd` and `teach`; pstack's versions everywhere. (pstack `teach` = explain a piece of work plainly; agents never start it themselves; it can explain an already-found root cause, while finding one is the debugging skills' job.) Pocock's `ask-matt` reference to `/teach` changes too.
- Structural fix: CI fails if two installed skills share a name. The separate pstack folder is cut (24 Oct).

## Card shape (Todd, 24 Oct)
- A card is a short Outcome of one or two sentences plus at most five acceptance criteria describing what Todd sees.
- Requirements, Contracts, Proof and Out of scope sections are retired. A constraint that matters to Todd, including how something must be proven, is written as a criterion.
- Start's admission check accepts that shape and refuses the retired sections. `scripts/check-agent-brief.mjs` refuses more than five criteria. Triage writes that shape.

## Evidence check (12:09–12:12, revised 24 Oct)
- **Is the evidence there:** **dropped** (Todd, 24 Oct). No evidence index. The reviewer reads the proof folder for the exact candidate commit; a missing or thin proof folder is a failed criterion, not a separate gate. The "evidence is there" card is dropped.
- **Is the evidence right** (does it prove each criterion where Todd uses it): **kept** (Todd, 12:12; inputs settled 24 Oct). Wrong-but-present evidence got past pstack and the builder's report twice on 23 Oct and was stopped only by the advisor's human review. The machine starts a review after each build, by a model from a different company than the builder; input is only the card's criteria and the proof folder; per-criterion verdict (proven / not proven / wrong thing tested), each verdict naming its proof file. A first failure moves the card to **Remediation** for one round of defect fixing, then a fresh review; a second failed review runs poteto's **Investigation** playbook for the root cause, then the card stops. At most two reviews. This is JUL-252's job.
- **Playbook adherence (Todd, 25 Oct):** every build and remediation run records the playbook it must follow (a build: the playbook named by its card label; first remediation: Bug fix; second: Investigation). The evidence review receives the required playbook's text with the run's checklist and candidate diff. A run whose checklist follows a different playbook, or whose work skips its steps, is marked unproven and takes the ordinary failed-review path. A step the host scoped out, such as publishing, is not skipped work. The evidence review reads the card's current text from Linear each round, not the copy saved at Start.
- **Checkpoint (Todd, 12:12):** after five cards have been through the review, look at what it actually caught (real catches vs noise, cost) and decide again whether to keep it. Todd's later decision over the saved review results; JUL-252 delivers no report. (Todd, 24 Oct)
- `/interrogate` stays inside the build as pstack's code review (it reviews the diff, not the evidence).

## UAT (11:40–12:13)
- A card gets UAT **only if it changes something Todd uses directly**. Julia app cards always do. Machine cards usually don't, and they merge once the staging proof passes. The card says whether it has household or control-page steps for Todd to try; none = no UAT.
- When staging and the smoke test pass, the machine moves the card to UAT and notifies Todd through Linear (reaches his phone) with: the preview link, the card's steps in household terms, a short plain explanation of what changed.
- Accept → the machine merges. Send back → Todd writes what's wrong; the card returns to the build with his note; two send-backs stop the card (existing stop rule).

## Merge (12:14)
- The machine merges on its own once every gate passes: CI green (GitHub merge protection), evidence review passed, staging and smoke test passed, UAT accepted when the card has UAT. Todd doesn't approve merges separately; the trial-era rulebook line "Todd decides the merge" goes.
- After merge: **Julia app cards** — Vercel deploys to live Julia; the machine runs the smoke test against the live site; on failure it reverts the merge and tells Todd. **Machine cards** — the machine updates itself from main and checks itself through Todd's Tailscale address; on failure it rolls back to the previous commit.
- The card moves to Complete only after that final check passes.

## Failures after Implementation and the board (12:15–12:16)
| Failure | What happens | Stop rule |
|---|---|---|
| Evidence review: a criterion not proven | 1st: card to Remediation for one round of defect fixing, then a fresh review. 2nd: Investigation playbook for the root cause, then stop | 2nd review failure stops the card |
| A checklist follows another playbook, or the work skips its steps | The evidence review marks every criterion unproven | Same as the evidence-review row above |
| Staging or smoke test fails | Back to the build with the failing tests | 2nd proof failure stops the card |
| UAT send-back | Back to the build with Todd's note | 2nd send-back stops the card |
| Live check after merge fails | Revert (Julia) / roll back (machine), then back to the build | Counts |
| Cap reached | Card stops where it is | Is the stop |
- Every send-back reruns everything after the build (evidence review, staging/smoke, UAT if any): changed code voids earlier passes.
- A stopped card stays in its column; Todd gets a Linear notification with a plain explanation, the root cause, and a restart plan for his OK (existing stop rule).
- **Board:** the Linear board flow stands as written: Triage, Backlog → Ready → Implementation → Evidence review → Staging/smoke test → (UAT) → Complete; Canceled, Duplicate. **Remediation** is kept for sent-back cards so retries show at a glance. The Code review column stays (its removal is cut, 24 Oct). The board-style dashboard view is parked (Todd, 24 Oct).

## Retro and learning (12:18–12:21)
- **Automatic retro:** after every merge the machine starts a retro run (same trigger as the verification upkeep). It runs pstack's `/correct` on the card's history: evidence-review findings, failed checks, UAT send-backs, and Todd's corrections from the advisor's retro notes. Output: a PR of checks and code fixes, each as high in the pyramid as it will go, each shown failing on the real past mistake.
- **Our own retro:** findings from Todd + advisor retros (like the 23 Oct JUL-231 retro) go into the same process and the same approval.
- **Approval (Todd, 12:18):** a retro PR waits for Todd's approval before it goes through. It changes the environment every future card runs in, which is where human review has the most leverage (poteto). The PR carries a plain-English list per fix: the mistake it came from, what the check does, what it would now block. The advisor checks the code side (each check really shown failing on the past mistake). Todd approves the lessons; the PR merges only after his yes.
- **Other learning pieces:** `/recall` at the start of the Idea step (planner agent catches up, including failed and reverted attempts); `/eval` when a skill changes (blind test that the change helps); `/reflect` not used routinely (produces mostly prose edits); pstack's decision log stays automatic.

## Models and money (12:23)
- Connect the **ChatGPT plan** and the **Claude subscription**, all models, through Mastra Code's stock sign-ins (alongside CommandCode). The Claude decision is recorded as an ADR citing Anthropic's 7 Oct help article and Mastra's configuration page; settled, not reopened.
- **Retire the $0 trial rule.** Every model is counted at its published API price (subscriptions included, though they aren't billed); every model needs a price and bounds or it's refused.
- **Cap: retired (Todd, 25 Oct).** Money never stops a card. Spend is recorded and reported per card from settled actual usage at published API prices; subscriptions are counted at the same prices. The earlier $10 cap, the $2 reservation gate, the per-card `cardCeilings` override and the priced-accounting block are gone. The JUL-252 rerun measured $1.223852 after eight Opus requests before its reservation gate stopped it, which is the measured floor this review used. A build stops only after 15 minutes with no activity, or pauses on a runaway or a provider that stays down; a pause keeps its work, posts a Linear note, and can be continued.
- **Model split:** Sol for the main session and hardest work; DeepSeek for everyday coding and swarm workers; panels one Sol + one DeepSeek; Beam for free machinery checks. The evidence review runs on a different company's model than the builder (Claude makes that possible on every card).

## Retro fixes from JUL-231
The agreed fixes from the JUL-231 retro are folded into the cards below.

## Order of work (agreed 12:24)
1. Models and money: both subscriptions, $10 actual-spend cap, Sol's price recorded, $0 rule retired, Claude ADR.
2. Live view: the dashboard shows the running build’s pstack checklist, ticking off steps as they finish.
3. Deployment safety: dropped (Todd, 24 Oct). The updater as sole service starter, its ownership of the Tailscale route, its test and its proofs are not built. Stale live-state descriptions are removed from the setup notes as part of the clean-up.
4. Clean-up: one pull request, no card (Todd, 24 Oct). Settled scope: the no-fakes CI check; the four writing-for-agents rules as one script, run by triage before showing Todd a brief; removal of live server-state descriptions from the setup notes; confirmation that Start's admission check accepts the current triage card shape by running it on JUL-263; this plan update. Cut: the pstack folder move, the framework-lint fix and the Code review column removal. GitHub merge protection moves to card 8.
5. Evidence review (JUL-252) with the five-card checkpoint. The "evidence there" card is dropped: no index, the reviewer reads the proof folder. (Todd, 24 Oct)
6. Per-task models: pstack's own role lines (main session, hardest tasks, everyday code, search, panels) replace the orchestrator/coder pair, set from JUL-252's actual spend by model and task. One pull request, no card.
7. Julia cards start (Todd, 25 Oct). The machine builds and the evidence review checks the proof; Todd tries the Vercel preview and says yes; the advisor merges.

Deferred until doing it by hand gets in the way (Todd, 25 Oct):
- Staging: regression suite against the Vercel preview; `verify-julia` rewritten for Linux and a given address.
- UAT and merge: notification, accept/send-back, automatic merge, GitHub merge protection, live check, revert/rollback.
- Automatic retro: `/correct` after merge, plain-English list, Todd approves. Waits for a history of real Julia cards.
The clean-up is built by the planner agent in a fresh session. From card 5 on, the machine builds the cards itself (Start's admission check accepts the current triage card shape, confirmed on JUL-263 on 24 Oct, and card 1 lets the machine use paid models); the planner agent shapes cards with Todd.

## 25 October evening decisions (Todd): fresh pstack and Mastra Code

- **Milestone 1 is a Julia card.** Before the machine runs any card, one setup and one practice Julia card are run by hand in Mastra Code on the server, with Todd watching.
- **Start fresh.** pstack is set up as its guide says. Nothing from the old machine's behaviour on top of pstack is carried over unless a real run shows it is needed. The old machine's code stays untouched until milestone 1 passes, then it is deleted.
- **Harness.** Mastra Code's stock coding agent and stock subagents. No custom agents.
- **pstack source.** pstack comes from the `backnotprop/pstack` mirror at commit `fad8d01` (version 0.15.32), not Cursor's copy, because the mirror's harness rewrites are what let pstack run outside Cursor.
- **Models for pstack.** The chat itself runs on Opus 5.5. These roles run on Sol 6.1: hardest tasks; judgment and prose; how explainer; why synthesizer; reflect judgment, divergent, synthesizer. These roles run on DeepSeek V4.1 Flash: feature and refactoring; bug-fix; perf-issue; hillclimb; how explorer; why investigators; reflect tooling; swarm workers. Panels (arena runners, arena cross-judge pool, architect runners, interrogate reviewers) are Sol 6.1 plus DeepSeek V4.1 Flash. Budget: medium. All of this is set by running `/setup-pstack` during the hand run, not written by hand.
- **At setup.** Accept the generated verification skill, which replaces `verify-julia`. Decline formal verification; JUL-271 owes it. Setup's changes reach `main` through a pull request using pstack's Opening a PR and Babysit; pstack's Shipping lands it. The proof is the generator's end-to-end proof plus a screenshot of the home page taken on the server.
- **JUL-252 is canceled as superseded.** The evidence-review instruction agreed earlier on 25 October is superseded and must not be sent.

## 26 October decisions (Todd)

- **Old machine removed.** Old machine removed from main on 26 Oct 2026, kept at tag `old-machine-final` (Todd, 26 Oct 2026), overriding the 25 Oct "untouched until milestone 1" line.
- **Coordinator chat moves to Sol 6.1.** The coordinator chat moves from Opus 5.5 to Sol 6.1 on 26 Oct 2026 because the Opus orchestrator used 34% of the weekly Claude quota (Todd, 26 Oct 2026). This overrides the 25 Oct "The chat itself runs on Opus 5.5" line. The pstack role lines are unchanged.
- **Plan and fast modes follow the chat to Sol 6.1.** Mastra Code's `plan` and `fast` mode defaults move from Opus 5.5 to Sol 6.1 for the same quota reason (JUL-274 run, 26 Oct 2026, under the coordinator decision above). See `docs/pstack-deviations.md` rows 7-9.
- **Success is judged against Todd's UAT yes.** A card succeeds when no stop began before Todd's UAT yes on the preview; the wait that ends in the yes is exempt unless it also asked for something else (Todd, 26 Oct 2026, ruling JUL-272 a failure with two stops). Stop pings reach Todd as a Linear reminder, because he will not set up app credentials (Todd, 26 Oct 2026). See ADR 0024.
- **The 15-minute stop and runaway pause leave AGENTS.md.** Both were enforced by the build machine removed in #354; nothing enforces them in Mastra Code, so AGENTS.md now names the scorecard instead (JUL-274 run, 26 Oct 2026).

## 27 October decisions (Todd)

- **Todd sees it work.** From now on every piece of work is started and watched from the dashboard, and its proof is something Todd can see working on a screen he uses, without reading code. Work with nothing for Todd to see happens only as an exception Todd approves (Todd, 27 Oct 2026).
