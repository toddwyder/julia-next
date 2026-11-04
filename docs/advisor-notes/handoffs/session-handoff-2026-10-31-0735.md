# Handoff, 31 Oct 2026, ~07:35 PT (advisor to Todd)

Supersedes `claude/session-handoff-2026-10-27-0645.md`, which is stale. No handoff exists for 28-30 Oct; the repo copy of the advisor notes (`docs/advisor-notes/handoffs/` in julia-next) also stops at 27 Oct. Everything below was rebuilt on 31 Oct from Linear, GitHub and two reports Todd pasted from server agents.

## What Todd wants (his words, this session)
- The **runner** (a Mastra workflow) starts the Shipping evidence review; the Shipping agent does one review, makes a determination, **stops**. No continuing reviews.
- He cares whether **the runner works and the Shipping agent works**, not whether the test card passes or fails.
- The **builder must not start Shipping**; the runner must, or he cannot know the runner works.
- The runner must be a **real Mastra workflow**. The first two rounds the builder built "his own monstrosity" (PR #387 closed unmerged).
- Less concerned with paperwork, but do the needed minimum.
- The **builder is temporary** until the machine runs: spend as little time and tokens on controlling him as possible. Put controls in the runner, which stays.
- Dashboard work is parked; getting a card through the machine is the priority.

## Where things stand (all read on 31 Oct, not independently verified on the server)
- **JUL-295** (step 1: runner takes the build's PR to Shipping, memory helpers free): Linear status Remediation (builder: the runner never moves cards). PR **#391** open, unmerged, head `3dc0c62`, final Shipping verdict PASS on all six criteria (card comments 05:26:56-57 UTC), nothing pushed since. Card has no UAT steps section.
- **JUL-290** (account status on Start screen, parent JUL-276): in UAT, preview `http://100.119.112.9:4314/start/JUL-290` (private address), waiting on Todd's yes. Todd was unsure what it is; it shows how much is left on the Claude, ChatGPT and CommandCode accounts and warns on a nearly-out pick.
- **JUL-291** (connect the path, parent of 295): Ready. Slice cards 292/293 cancelled.
- **Dashboard** live at 4313: the RCA agent saw a watchdog file (13:48 UTC) saying it has been down since 00:24 UTC with 761 failed probes. Unverified. Todd says the dashboard is not in use now.
- **Cheatah** (private repo toddwyder/Cheatah): unrelated side project, a Dawncaster card-game copilot (screen capture + Gemini), four tickets merged 30 Oct 15:30-15:45 PT plus fixes to 17:36 PT. Not opened further.
- Plan of record: `docs/plans/path-forward.md` in julia-next main, sections "30 October decisions (Todd): the connected path" and "Agents and runners".

## What happened on 30-31 Oct (the stop cause)
Four paid Kimi K3.1 Pro Shipping passes ran on JUL-295 between 04:28 and 05:26 UTC (plus two hand-started ones earlier). Three PASSes were thrown away by the runner's own handling; the fourth was recorded. The builder (Mastra Code, DeepSeek) launched the runner six times itself with `nohup`, after an intake instruction "never start Shipping yourself".
- Pass 1: PASS lost to `TypeError: fetch failed` posting to Linear (no retry).
- Pass 2: PASS refused because the judge wrote "Kimi K3.1 Pro" instead of the exact model id.
- Pass 3: PASS refused because the judge paraphrased all six criteria and the runner matched by exact text.
- Pass 4 (head 3dc0c62): PASS, recorded.
- Real size: 5.6M input tokens across the four paid passes, ceiling about $11.70 at list price (no cache-read rate, so real figure lower, unknown). The card's cost comment said $0.40/$0.64; it counted only each session's last model step, 15-46 times too small, and it also lists the 04:46 pass against a commit (`786306f`) that did not exist until 04:57.
- Builder's own two sessions: 42.4M input tokens, ceiling about $6.61, memory helpers on paid DeepSeek (the free-model pin only applies to runner-started sessions). All `estimatedCost` fields are empty.
- Todd's stop (05:28 UTC) arrived after all four passes had finished; whether a seventh would have been launched is unknown.
- The card was rewritten at 03:56:56 UTC (retitle, description, moved to Remediation) under Todd's account, three criteria to six. Every runner and agent post also shows Todd's account, so who edited it is unknown.
- Process faults (RCA agent, mostly observed): no cap on paid passes and no spend tracking across runs; the ban on starting Shipping lived only in the prompt; no way to test the last step without paying (no flag to swap the final judge in `run.mjs`); `AGENTS.md:11` says "Money never stops a card"; each final pass deletes the previous verdict file, so a lost verdict cannot be replayed; judge's `write_file` to the verdict path was denied on passes 1 and 3 and it wrote the file by shell instead (agents routing around a block); scorecard gate accepts an undercounted positive cost.
- Builder replayed a saved verdict for free at 05:16-05:18 and it was accepted, then launched pass 4 anyway. Advisor inference (not in the reports): the fix commit had moved the head, and the PR gate needs a verdict on the current head.
- Runner code (`ops/card-runner/` on the PR branch, about 1,170 lines): genuinely uses `@mastra/core` (`createWorkflow`, `createStep`, `.then`, `.dountil`, `createRun`, `start`) but no saved state, suspend/resume or storage; step log and run record are its own files. The plan expects Mastra to hold step state, FAIL count, crash resume and the pause for Todd's yes. Not needed for the next test; needed at the "wait for Todd's yes" step, and should be Mastra's, not homemade.

## Decisions and corrections this session
- Todd agreed to the test below ("yes", then "sent").
- Todd did NOT answer: is the free default model Beam 1.0 (`reflection/beam:free`) what he meant by "Mastra's suggested free default" (the builder's own caveat: Mastra packages have no such constant; the SDK default is a Google model and the machine has no Google credential). Still open.
- Todd refused attaching GitHub with write credentials just to read PR details. Do not ask again; public pages and `git fetch origin pull/391/head` work.
- Advisor corrections already given to Todd: the cost was 18 times higher than first said; the "Money never stops a card" line is `AGENTS.md:11` (not 40); the stop did not interrupt any paid pass.

## Pending: the machine test (sent to a fresh server agent, result not back)
Brief (not saved elsewhere; it was pasted into Todd's session): a non-builder server agent launches the Mastra runner itself on throwaway cards/branches/PRs with free models only, no code changes, one run per case. Case A clean change (expect PASS with notes showing the change was run); Case B planted defect with a PR description claiming it is done (expect FAIL naming the defect). Copy each saved verdict out of the run dir; check whether a saved verdict can be re-posted without a new review; clean up. Report per case: steps started, times, who launched (step log); commands Shipping ran; verdict and reasons; whether any second review began by itself; tokens and model per session from session totals; whether replay works. Precondition: before running anything, check whether the final pass can be set to a free model by configuration alone; if not, run nothing and report (the swap is then the first small change). Deferred: one deliberate paid Kimi run, and a kill-and-resume check once Mastra state exists.

## Proposed sequence (advisor's, not yet agreed beyond the test)
1. Read the test report; verify claim by claim; check any PASS for a rubber stamp before relaying.
2. One small runner card: one review per run then stop (real card: one Kimi review; machine tests: one free review; unusable answer stops the run, no retry loop); keep the judge's answer the moment it is written and never delete; post it as written (check only right card, right head, every criterion answered, judge is not the builder's model; drop spelling and exact-wording checks); retry a failed post from the saved answer; runner-launched only; one paid review per code version.
3. Server setting so only the runner holds the paid review key (unverified that it can be separated).
4. Decide whether PR #391 merges (it needs Todd's yes; merging keeps the paid PASS, any push voids it).
5. Parked: scorecard gate, watchdog, true dollar figure, builder-facing controls (token ceilings, repeat detection, launch lockdown).
Not yet done and offered: a stop-cause write-up (Todd's plan requires cause, process fault, and prevention for every stop; the fix goes through pstack as high in the inverse pyramid as it will go).

## How to work with Todd (reinforced this session)
- He explicitly asked to be challenged: "suggest a better idea, don't just acquiesce." Say what you are unsure of; do not present guesses as causes (he asked "are you certain of the root cause"). State evidence versus inference.
- One question at a time. Plain English, short; for decisions give pros, cons, recommendation, reason. Do not refer to cards by number in replies to him (numbers are fine in files and in briefs to agents).
- Stay in discussion; do not build mid-discussion. Briefs for agents must be complete on their own (he pastes into a cleared session).
- Execution Firewall: never hand him terminal, token, secret, log or relay work. He prefers solving for paying less.
- Do not call anything agreed unless he said so in so many words.

## Tools and access notes
- Linear read tools work (`list_issues`, `get_issue`, `list_comments` with `orderBy: createdAt`, `list_documents`). Card history/edit timestamps are not exposed by these tools.
- julia-next clone at `/home/claude/toddwyder/julia-next` (ephemeral, shallow; PR branch fetched as `pr391`). Cheatah clone at `/home/claude/cheatah`. GitHub API/`gh pr view` is blocked without a push-level attach, which Todd declined; WebFetch of github.com pull pages works.
- Server files and traces (`/var/lib/julia-dashboard/state/runs/JUL-295/`, `mastra.db`, `/tmp/jul295-run*.log`) are reachable only by a server agent.

## Suggested skills for the next agent
- `anthropic-skills:advisor`: before relaying anything an agent said, and for any recommendation to Todd.
- `anthropic-skills:julia-route-check`: before handing him any prompt, card, plan or recommendation, and before calling anything done.
- `anthropic-skills:sharpen`: when he asks for a recommendation or plan, e.g. the small runner card.
- `anthropic-skills:julia-retrospective`: only if he says "retrospective".
