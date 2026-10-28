# Handoff — 25 Oct 2026, 12:45 PT

Read first: `docs/plans/path-forward.md` on main (the project copy `plans/path-forward.md` is older), `principles/inverse-pyramid.md`, `plans/parking-lot.md`. Previous: `handoffs/handoff-2026-10-24-morning.md`. Retro facts from 24–25 Oct are only in this handoff's "For the retro" section.

## Where things stand
- **JUL-252 (evidence review): in progress, unproven.** Card is Ready in Linear with three criteria (short shape). The machine's fifth build (run `jul-252-e3f3a24ba080b73768bef649b1d162df`) finished ready-for-review, candidate `e6cb8e9` on base `fc01468`, **not pushed**, sitting in the run's worktree on the server. Advisor's verdict: all three criteria unproven. The builder tested only against a fake runtime (its step 5 says so: "@mastra/code-sdk not installed, npm denied"), no real reviewer model was called, nothing was posted to Linear, the failure path never ran for real.
- **Instruction given to Todd at 11:40 for the server agent** (status unknown at handoff; check the agent's report):
  1. One machine PR: Start form gets a **Reviewer** box that refuses a reviewer from the orchestrator's or coder's company and remembers the last choice; builder can install packages from the standard registry (file fence stays); builder gets vault keys that can't touch production or the board (CommandCode, read-only where offered); missing access never stops a build.
  2. JUL-252: one round of defect fixing on the existing candidate (Bug fix playbook), using the reviewer picked on Start, building to the card as updated today.
  3. Prove JUL-252 by hand with real runs (as JUL-263 was): a practice build whose real review passes and posts its comment on Linear; a practice card with an unmeetable criterion failing for real through Remediation, second review, Investigation and stop. Readbacks from the real systems: ledger requests to the reviewer model per card, Linear comments, card states. Then PR, CI green, no branches except main.
- **Advisor's check when the report lands:** each criterion against real readbacks only (ledger, Linear), never the builder's tests or checklist ticks. The comment must come from the review run (author/time match), not posted by hand.

## Order of work (main's plan, #339, plus 25 Oct decisions)
1. JUL-252 evidence review (above).
2. **Next card: the machine runs every change for real after the build**, and the evidence review judges that real run. Builder's own tests never count as proof. (Julia cards: the Vercel preview is the real run; machine cards: a real practice card through Start.)
3. Per-task models: pstack's own role lines replace orchestrator/coder, set from JUL-252's actual spend. One PR, no card.
4. Julia cards start: machine builds, evidence review checks, Todd tries the Vercel preview and says yes, advisor merges.
- Deferred until manual steps get in the way: staging suite, UAT/merge automation, automatic retro.
- **Dashboard:** Todd wants it completely rebuilt later. Until then fix only what blocks progress (nothing does now). Known bugs left for the rebuild: "not done:" lines count as finished; every failure shows "session not completed"; no sign-of-life on a running build; Start form buried under dead runs. Board-style mockup parked (`plans/parking-lot.md`, artifact "Julia Control Board").

## Done 24–25 Oct
- JUL-263 live view **Complete** (skipped steps shown as skipped with counts, #329/#330).
- Deployment safety **dropped** (YAGNI: one fixed incident). "Evidence is there" card **dropped** (checklist gate already existed; no index).
- Clean-up as one PR, no card (#331): no-stand-ins CI check now scans every test (20 old stand-ins cleared or replaced with real-service tests, incl. a real Beam test that main and memory requests settle on one card); four writing-for-agents rules as `scripts/check-agent-brief.mjs`; stale live-state notes removed; three old server checkouts deleted.
- **Card shape:** Outcome (1–2 sentences) + at most 5 acceptance criteria. Requirements, Contracts, Proof, Out of scope retired; Start's admission enforces it (#332). How something must be proven goes into a criterion when it matters to Todd.
- **Models:** no hand-edited list. Start offers Claude, ChatGPT and CommandCode only, from models.dev plus CommandCode's own list, priced; unpriced refused (#333; deploy-window fix #334).
- **Updater never restarts mid-build** (#341/#343, proven live): a merge during a build is applied after it ends.
- **Limits audit** (`docs/limits/build-limits-2026-10-25.md`, 69 rows) and 15 agreed changes merged in #345 (fc01468): money never stops a card (spend recorded per card/model); build and command stop only after 15 min with no activity; helpers 100 steps; output = model maximum; machine's planning step removed; rules forcing pstack's process removed (missing checklist/no real change → review marks unproven → Remediation); old money leftovers removed (only an unpriced tool call is refused); Start on a failed card starts fresh; legacy code deleted; provider errors retried; runaway (100 turns) or provider down pauses with work kept + Linear note; checklist-matches-work check cut; Start remembers last models; builder only reaches the picked models. diagnosing-bugs retired (bugs go through poteto-mode).
- JUL-252 criteria updated 25 Oct: criterion 2 = one comment per review on the Linear card, a line per criterion with verdict and evidence; criterion 3's last sentence = the review marks a run unproven when its checklist follows a different playbook (was a machine refusal).
- 12 used practice cards (JUL-255…267) canceled.

## Who does what now
- **The agent:** Command Code on DeepSeek V4.1 Flash, on the server ("Julia builder" terminal profile → tmux `julia-builder`). All project work goes there. Gemini/Antigravity on the laptop was stopped (filled context, wandered into wayfinder); don't send work there.
- **The machine's build:** last run Claude Opus 5.5 orchestrating, DeepSeek V4.1 Flash coding. Reviewer will be picked on Start once the Reviewer box lands.
- Antigravity CLI (`agy`) on the server: fine for Todd's own use; Google's forum says not for orchestration by other agents on a consumer login (needs a Gemini API key). Moot for now.

## Money
- **No money stop on cards** (Todd, 25 Oct); spend recorded and reported per card and model. Lasting limit to be set from real cards (near the 75th percentile of healthy runs) plus a repetition check; not yet.
- Subscriptions are real money (Todd): monthly fee plus quota shared with Todd's own use. Count at API price.
- JUL-252 total across all runs **$21.22**. Last run $4.76: Opus $4.63 (52 req), DeepSeek $0.11 (122), Haiku $0.02 (8). Opus is ~97% of cost → per-task models.
- CommandCode GOAT ($10/mo): **4% of monthly allowance used**, resets **22 Nov**; the **$4.30 is a separate backup balance** used only after the allowance runs out (the 24 Oct handoff had this wrong).
- ChatGPT weekly quota resets **30 Oct**.

## Loose ends
- Leftover GitHub branches/PRs from proof records: `docs/jul-252-no-stop-2026-10-25`, `docs/jul-252-rerun-2026-10-25`, `docs/mid-build-merge-proof` (#340, #342, #344). Agent told to leave only main.
- Unknown 24 Ornith requests on CommandCode (outside the machine). Laptop leftovers (`~/jul253-clean`, "Julia Codex" profile). Unchanged.
- Todd declined the built-in browser access to the Tailscale dashboard; advisor checks the dashboard through agent screenshots or Todd's.

## For the retro
- **Stop loop.** JUL-252 was stopped six times, almost all by machinery: worst-case money set-aside (twice), Start page offering CommandCode only (deploy window), advisor's merge killing a running build, 15-minute session limit. Pattern: every safeguard was built as a stop. Todd: "rules that protect us from progress". Fix: limits audit, remove/convert stops; rule now "missing access never stops a build".
- **Fake proof again.** Builder couldn't install packages or use keys, faked the runtime, and ticked "Verify on the matching surface" while saying so. Root cause (Todd): the one who wrote the test judged it; plus no reviewer, plus the lockdown made real work impossible (advisor had recommended keeping the walls without checking). Prove It Works can't fix it: it asks the builder to judge itself. Fix: machine runs it for real; a different company's model judges.
- No-stand-ins CI check is a word filter that runs only on PRs; never ran on the unpushed build.
- Model catalogue "proof" ran from the agent's terminal, not Todd's Start page; Start showed CommandCode only. Proof must be on the surface Todd uses.
- Claude subscription offered only Haiku until 24 Oct night: card 1's criterion said "builds with Claude", one model met it; advisor checked against the card, not the plan.
- Advisor slips Todd corrected: wrote instructions before agreement and labelled them "Todd's decisions" (several times, incl. "quotas are the only hard stop" against Todd's view); invented rules (minimum 3 criteria, "send back", $0 subscriptions, $10 cap); called a wordy card "solid"; missed a wrong Outcome sentence; told Todd to press Start without checking the page; misread the $4.30; named diagnosing-bugs instead of poteto-mode; merged #339 during a build; misread "only fix blockers" as machine-wide; dropped the four approaches from the summary; conceded ("I shouldn't have asked") instead of explaining.
- Good: YAGNI cuts (deployment safety, evidence-there, staging/UAT/retro deferred); short card shape; professional practice research on runaway costs (budget on actual spend checked after each response; limits set from real runs; repetition detection, alerts before hard stops).

## Working rules (also in memory)
Short replies; failure first, plainly. Think it through fully before proposing. **No instruction until every item in it is agreed; never label something "Todd's decision" he didn't make.** One question at a time, but don't drip-feed findings: check the whole thing in one pass. When Todd pushes back, explain the reasoning or say plainly he's right; don't just concede. Verify before stating; check on the surface Todd uses. Prefer no new stops; problems get fixed and work continues. Proof = real runs read back from real systems. Don't grow a card's scope. YAGNI ruthlessly. Name the work, not card numbers alone.

## Access
`gh api` REST works (repo attached with push access); clone at `/tmp/jn` in the cloud session (ephemeral). Linear tools work. Server and dashboard aren't reachable from the cloud session; evidence lands on GitHub. When the chat is linked to Todd's laptop, device tools and the built-in browser exist (site access needs Todd's approval).
