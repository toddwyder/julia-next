# Path forward — plan (agreed with Todd, 23 Oct 2026)

Working document. Each line is a decision Todd agreed in conversation.

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
- Two Todd rules lose their only text home and need a pyramid home: (1) no fake outside services in tests → CI check; (2) acceptance criteria describe what Todd needs → mostly triage's "behavioral, not procedural" brief rule, rest judged at settle.
- If problems appear that pre-plan used to catch, the fix goes higher in the pyramid, not back into a procedure.

## Staging and smoke test (11:19–11:38)
- **Julia app cards:** on every PR, CI runs the regression suite against that PR's Vercel preview: every saved automated test, including the new card's. A failure sends the card back to the build. Todd never sees a broken preview.
- **Regression suite:** one automated test per feature, written by the builder as part of the build (pstack already writes tests for the acceptance criteria). Saved in the repo, so it joins every future run. One thing per feature, nothing else to keep in step.
- **`verify-julia`:** keeps pstack's verification-skill shape, but becomes generic: how to point the suite at a preview address, plus hand exploration when something can't be automated. Rewritten for Linux; its feature map loses the step-by-step driving recipes. Today's two features already have automated tests (`tests/home.spec.mjs`, `tests/release.spec.mjs`).
- **Machine cards:** staging is the proof itself, run on the server through Todd's Tailscale address (retro fix 1).

## Skill names (11:38–11:40)
- Installing pstack on 22 Oct overwrote Pocock's `tdd` and `teach` in `.agents/skills`; `.claude/skills` still has Pocock's, so the same name means different things per agent.
- Decided: retire Pocock's `tdd` and `teach`; pstack's versions everywhere. (pstack `teach` = explain a piece of work plainly; agents never start it themselves; it can explain an already-found root cause, while finding one is the debugging skills' job.) Pocock's `ask-matt` reference to `/teach` changes too.
- Structural fix: pstack lives in its own folder, so updating pstack is one replacement; CI fails if two installed skills share a name.

## Evidence check (12:09–12:12)
- **Is the evidence there:** structural, via retro fix 1 (build result can't be saved without pstack's checklist, regression results and the generated evidence index; the machine won't advance a card with pieces missing).
- **Is the evidence right** (does it prove each criterion where Todd uses it): **kept** (Todd, 12:12). The hold was reversed: wrong-but-present evidence got past pstack and the builder's report twice today and was stopped only by the advisor's human review. The machine starts a review after each build, by a model from a different company than the builder; input is only the card's criteria, the evidence index and the raw files; per-criterion verdict (proven / not proven / wrong thing tested); a failure returns the card to the build; at most two rounds. This is JUL-252's job.
- **Checkpoint (Todd, 12:12):** after five cards have been through the review, look at what it actually caught (real catches vs noise, cost) and decide again whether to keep it. Goes into JUL-252 as Todd's decision when it's triaged.
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
| Evidence review: a criterion not proven | Back to the build with the findings | 2nd review failure stops the card |
| Staging or smoke test fails | Back to the build with the failing tests | 2nd proof failure stops the card |
| UAT send-back | Back to the build with Todd's note | 2nd send-back stops the card |
| Live check after merge fails | Revert (Julia) / roll back (machine), then back to the build | Counts |
| Cap reached | Card stops where it is | Is the stop |
- Every send-back reruns everything after the build (evidence review, staging/smoke, UAT if any): changed code voids earlier passes.
- A stopped card stays in its column; Todd gets a Linear notification with a plain explanation, the root cause, and a restart plan for his OK (existing stop rule).
- **Board:** Triage, Backlog → Ready → Implementation → Evidence review → Staging/smoke test → (UAT) → Complete; Canceled, Duplicate. **Remediation** is kept for sent-back cards so retries show at a glance. **Code review** is removed (pstack reviews code inside the build).

## Retro and learning (12:18–12:21)
- **Automatic retro:** after every merge the machine starts a retro run (same trigger as the verification upkeep). It runs pstack's `/correct` on the card's history: evidence-review findings, failed checks, UAT send-backs, and Todd's corrections from the advisor's retro notes. Output: a PR of checks and code fixes, each as high in the pyramid as it will go, each shown failing on the real past mistake.
- **Our own retro:** findings from Todd + advisor retros (like the 23 Oct JUL-231 retro) go into the same process and the same approval.
- **Approval (Todd, 12:18):** a retro PR waits for Todd's approval before it goes through. It changes the environment every future card runs in, which is where human review has the most leverage (poteto). The PR carries a plain-English list per fix: the mistake it came from, what the check does, what it would now block. The advisor checks the code side (each check really shown failing on the past mistake). Todd approves the lessons; the PR merges only after his yes.
- **Other learning pieces:** `/recall` at the start of the Idea step (planner agent catches up, including failed and reverted attempts); `/eval` when a skill changes (blind test that the change helps); `/reflect` not used routinely (produces mostly prose edits); pstack's decision log stays automatic.

## Models and money (12:23)
- Connect the **ChatGPT plan** and the **Claude subscription**, all models, through Mastra Code's stock sign-ins (alongside CommandCode). The Claude decision is recorded as an ADR citing Anthropic's 7 Oct help article and Mastra's configuration page; settled, not reopened.
- **Retire the $0 trial rule.** Every model is counted at its published API price (subscriptions included, though they aren't billed); every model needs a price and bounds or it's refused.
- **Cap: $2 per card** (Todd, 12:23), raised from $1 to avoid stopping the first real cards. Measured floor: the one-line practice card took 54 requests (~130k fresh input, 13k output, 1.8M cache reads), about $0.06 at DeepSeek prices. Sol's API price isn't recorded yet. **Review the cap after the next real card** with its actual numbers.
- **Model split:** Sol for the main session and hardest work; DeepSeek for everyday coding and swarm workers; panels one Sol + one DeepSeek; Beam for free machinery checks. The evidence review runs on a different company's model than the builder (Claude makes that possible on every card).

## Retro fixes from JUL-231
The agreed fixes from the JUL-231 retro are folded into the cards below.

## Order of work (agreed 12:24)
1. Models and money: both subscriptions, $2 cap, Sol's price recorded, $0 rule retired, Claude ADR.
2. Live view: one status record (dashboard with live pstack checklist for Todd; pushed to GitHub for the advisor; kept as one updated comment on the card's Linear card, Todd 12:59).
3. Deployment safety: updater as sole service starter from main, owns the Tailscale route, its test, proofs through Todd's address; remove stale live-state docs and laptop-era `CLAUDE.md` parts.
4. Clean-up: GitHub merge protection (drop the AGENTS CI line), pstack in its own folder + duplicate-skill-name CI check + retire Pocock `tdd`/`teach` (and the `ask-matt` reference), retire pre-plan (including updating Start's admission check to the short brief: it still requires pre-plan-era fields), empty-lint fix, no-fakes CI check, remove Code review column.
5. Evidence there: build result requires checklist and evidence index.
6. Evidence review (JUL-252) with the five-card checkpoint.
7. Staging: regression suite against the Vercel preview; `verify-julia` rewritten for Linux and a given address.
8. UAT and merge: notification, accept/send-back, automatic merge, live check, revert/rollback.
9. Automatic retro: `/correct` after merge, plain-English list, Todd approves.
From card 2 on, the machine builds the cards itself; the planner agent shapes cards with Todd.
