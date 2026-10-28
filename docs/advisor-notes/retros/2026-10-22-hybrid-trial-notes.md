# Hybrid trial — running notes (started 22 Oct 2026, 14:52 PT)

Facts for the retro. What happened, and why it matters.

## Why the trial
- Todd, 12:58: the current process is "a total slog to do the simplest of things". Test a narrow, looser version of the hybrid (Pocock upstream + pstack downstream) on a fork.
- Task: guardrail item 1 only (model connection core), ahead of the Build card. Rest of the guardrails card stays parked.

## Setup decisions (Todd, 13:20–14:50)
- Requirements live in Linear only. Cards are written by pre-plan/triage, never by Claude.
- Loose pre-plan: approved Shape → triage → quick confirm. No full re-research, Framework Map comment, contract diagram, admission check or automatic formal verification.
- Fork `hybrid/pstack-trial` with a ~20-line rulebook. Todd: "the rules protect not making progress more than doing the wrong thing."
- pstack from the backnotprop mirror (Codex support; 0.15.28 vs official 0.15.30). `/poteto-mode` picks its own playbook; let it roll. pstack reviews its own way (`/interrogate`); retro decides what to keep.
- Learning tests on main stay (one rulebook line); nothing enforces them.
- `/setup-pstack` run properly: every role on the parent model; panels two helpers; no formal-verification skill (core code doesn't exist yet). Stale `verify-machine` removed on the branch.
- Card JUL-251 made model-neutral: Mastra stock routing, model and price per role are settings, one $1/card ceiling from tokens × API price (subscriptions at API rates, free = $0, unpriced refused, missing usage on priced models refused). Criteria about what Todd needs, not QA.
- "Done means" proof list added after Todd spotted the handoff lacked exit criteria.

## Process observations so far
- Upstream took ~1h45 of discussion; most of it surfaced real design changes (model-neutral core, token-based ceiling) the original guardrails card didn't have.
- Narrow Shape (3 SDK questions) took Codex ~10 min at $0 and changed the card (custom providers don't request usage by default).
- Claude slips: answered from memory instead of docs twice; wrote card text directly once; stacked several questions per reply; asked Todd an architecture question (Windows route) that was Claude's to decide; split one change into two instructions for Todd to send; first merge advice glossed over "merging = adopting pstack". Todd corrected each.
- Codex: fast and accurate on fork, install, Shape, triage. Ran step 3 before Claude's "skip it" note arrived (paste timing, not Codex fault).

## Build (from 14:52)
- 14:53: fresh session wrote pstack's "start" row in the existing log — followed show-me-your-work as written.
- 14:53: poteto-mode routed to **figure-it-out**, not Feature (judged the work cross-cutting).
- 14:56: two design sketches (design-a, design-b) plus a verdict — the two-helper panel in use. Chose to count cost at the network-request layer, because Mastra builds models internally for main and memory and a wrapper would miss memory calls.
- 15:00: first feature commit 93c6d99 — durable per-card ledger (SQLite) and request admission, with tests. ~8 min after start.
- Landlock file restrictions for builder commands ended up in the build (command-boundary.py) — beyond the card's "functional isolation"; review in retro.
- Moved git metadata to `.julia/git` because the tool sandbox made the worktree's git pointer read-only — workaround; pushing still worked.
- ~15:20: build done in ~30 min: 5 commits, 36 local tests, 17 framework tests green, 43 deliberately broken guards all caught. Same-model reviewer found 4 real defects, fixed with regression tests. Proof = scripts in ops/build-runner/proof/ driving the real adapter; no verification skill used (no user surface; verify-machine was removed and stale anyway).
- Proof caveat (proof.md): paid-cost cases used a local HTTP stand-in for the provider — conflicts with Todd's no-fakes rule? Still open for Todd.
- Stopped at PR: pstack's opening-a-pr rule says use the built-in PR tool, never the CLI; Codex's GitHub connector needs an approval click; server policy never asks → refused; Codex treated `gh` as a bypass and stopped. Cause: Claude's trial rulebook dropped main's "use ordinary signed-in GitHub access" line. Todd 15:27: use `gh`. PR #314 opened.
- CI on #314 failed: (1) Windows check runs every test unless on a hand-kept exclusion list; new trial tests weren't listed and the check never installs the runner's packages; (2) orphan verify-machine test after the skill was removed. Todd 20:00: no manual fix — permanent structural fix. Claude's call (20:03): retire the laptop-era Windows gate; tests run where their owner's dependencies are, by structure; skill tests live in the skill folder; via pstack `/correct`.
- Verification maintenance: no pstack playbook runs `/maintain-verification-skill`; its guide assumes Cursor scheduled automations. That's why verify-machine went stale. Todd 20:06: run maintenance automatically on every merge to main (server-triggered Codex session). Bundled with the CI fix in one instruction.
- 20:54: follow-up done, PR #314 CI green at a22a340, $0. Test location decided by nearest package/lockfile; a `server` folder routes key/live-provider tests to the server; skill tests inside skills; Windows gate retired; no lists. Learning tests moved under ops/build-runner/framework/. Server worker polls PRs/main, runs server tests on exact SHAs, publishes receipts as git notes; CI's server-tests job reads them. Maintenance: user systemd timer polls main each minute; a true merge launches one fresh Codex session in a Bubblewrap sandbox (product files read-only); blocked → one line on the card.
- Observation: the "fix two failing tests" follow-up grew to ~107 files and two new server services. Structural as asked, but heavy. New coupling: PR checks depend on the server worker; Todd accepted (server down = nothing builds anyway; checks go red after 30 min, rerun when back).

## Retro and merge
- 21:08: Codex retro (separate branch) ranked: concurrency proof not deterministic; CI ownership fixed — keep; stale handoff records; maintenance correction path untested; publication route hard to find. Missed the upstream half and the experiment question.
- 21:11: Codex on "was it easier?": yes, ~28 min unattended build; pstack gets partial credit — cleaner environment, settled facts, narrower scope and short rulebook mattered too. "Keep pstack; not yet proven lower total effort or fewer defects."
- Claude: trial changed three things at once (short rulebook, better handoff, pstack); can't separate their effects from one card.
- 21:16: Todd adopted the hybrid on main **on probation**; the Build card runs the same way and its retro decides keep/adjust/revert. Rulebook gained "Publish with gh…". Concurrency gap and maintenance correction path accepted with reasons.
- 21:21: Todd closed the guardrails card (JUL-249): items 2/6 covered by structural CI, 3/4/recheck closed until a problem happens, review control (runner-only, two rounds) moves to the Review card.
- 21:57: PR #314 merged (7c37c63). First real maintenance run on merge: clean, verify-julia's two features covered. JUL-251 Complete. $0 throughout.
- 22:01–22:53: JUL-249 canceled; review control landed in a new Review card (JUL-252) because JUL-233 had been dropped 18 Oct but never canceled (now canceled). Rulebook learning-test path fixed (PR #315). Claude first named JUL-233 as the home — wrong; Codex caught it.

## Rethink: the machine runs pstack (23 Oct)
- 22 Oct 23:00: Todd realised the machine and pstack overlap (both build, review, prove). Agreed: machine = start one pstack session per card, hold keys and cap, show the checklist, save the result; then staging/smoke, UAT, merge/Complete, possibly retro. Todd is rethinking the whole process.
- 06:06–06:15: Init keeps only orchestrator and coder. Model split: Sol for the main session and hardest tasks; DeepSeek for everyday coding and swarm workers; panels one Sol + one DeepSeek; Beam only for free machinery checks. Live checklist on the dashboard waits until after JUL-231.
- 06:22: Codex's helper tool only offers OpenAI models, so the split can't run inside Codex. Todd: Codex (Sol only) builds JUL-231; the split goes into the machine. Todd found the "same recipe, different kitchen" explanation only partly clear — the host-vs-pstack distinction is hard to see from outside.
- 06:55: Claude's instruction offered Codex a choice of host (Mastra Code, OpenCode, Pi) instead of fixing Mastra Code, which Todd had already chosen. Codex picked OpenCode after one inconclusive Mastra probe. Claude reviewed the report for a spending gap but didn't question the host switch; Todd caught it ("I thought Mastra Code was our harness"). Lesson: write decided things into instructions as fixed, not as options; question a report's main decision, not just its details.
- 07:13: real Mastra Code run at $0 proved per-helper models: Beam helper answered, DeepSeek helper refused by the core's cap before sending, ledger $0, 59 pstack skills loaded. The earlier probe only read a setting back without running a helper. Card JUL-231 now: Mastra Code host, every call through the core, cap refusal in Proof.
- 07:15: Todd settled JUL-231.

## JUL-231 build (23 Oct)
- 07:29: Claude's instruction said "builder and proof run use Beam only"; Codex read it as "do your own design work on Beam" and delegated design comparisons to Beam helpers through the machine core. Corrected: Beam only inside the machine's proof run. Lesson: say whose model a rule governs.
- 08:43: PR #316 opened; Codex reported all proof passed. Claude's evidence check found (a) the machine scripted the session ("coder then reviewer"), so pstack's process never ran and the model split was decorative (fixed coder/reviewer helpers on one model, display names not IDs); (b) services ran from Codex's working checkout, not main; (c) CI red — Codex's "done" never required green CI (gap in Claude's instruction and the rulebook).
- Access: this session couldn't use the GitHub API until Todd linked GitHub (08:54). CI logs still blocked (served from Azure storage outside the session allowlist). Claude sent Todd to UI locations for the network setting twice without verifying; the docs describe a different Projects screen than Todd's. Dropped; instead CI now writes each failing test as a GitHub annotation Claude can read.
- 10:20: fixed PR — CI green; real pstack run: Feature playbook, 8-step checklist with skip reasons, Beam helper wrote the file, DeepSeek review helper refused by the cap and recorded as "not a completed review"; JUL-234–238 canceled; rulebook Finish now requires green CI.
- Observation: the builder session wandered outside its worktree before working (read Codex's checkout, checked sudo and gh auth, read earlier runs' checklists). Nothing changed; within Todd's accepted admin risk; fence only if it causes a problem.
- 10:21: Todd approved; Claude merged PR #316 (2a7b101). Pending: services switched to main with readback.

## For the path-forward discussion (Todd, 23 Oct 10:54)
- Examine how/if pstack's learning pieces could be used: principle "encode lessons in structure"; `/correct` (repeat mistakes → checks, rule-to-enforcer table); `/reflect` (session → approved skill edits); `/recall` (catch-up incl. reverted fixes); `/eval` (blind test of skill changes); automatic decision log and orchestrate's retro watcher. Facts: none run automatically except the decision log; `/reflect` and `/recall` don't know where Mastra Code transcripts live (machine saves events.jsonl); overlaps with Claude's hand-kept retro notes and Todd's corrections.
- Order of remaining work (live checklist on dashboard; subscriptions + $1 cap; staging/smoke, UAT, merge steps; retro).
- Whether JUL-252 (Review) still has a purpose now that pstack reviews inside the build.
- Todd's wider rethink of how everything should work.
- Decided but unscheduled (23 Oct): connect ChatGPT plan and Claude subscription (Claude via Mastra Code sign-in, per Anthropic's 7 Oct help article; record as ADR); retire the $0 rule for the $1-per-card cap.

## Repeat for the next retro (23 Oct 13:03)
- Verbose cards again: the card-1 brief had seven criteria, including steps (Todd's sign-in, price sources, ADR) rather than outcomes; Claude recommended settling it before Todd caught it. Same complaint as Wednesday, so it's a repeat. Pyramid fix candidate: Start's admission check (or the card template) limits brief length and criteria count, instead of a reminder.
- Related finding: Start's admission check (`CardAdmissionSchema` in `ops/mastra-agents/reviewer/src/mastra/contracts.ts`) still requires the pre-plan era fields (Agent Brief: Category, Summary, Current behavior, Desired behavior, Key interfaces, Acceptance criteria, Out of scope; or Outcome/Requirements/Contracts/Acceptance criteria/Proof). A short brief like card 1's would be refused. Belongs in card 4 (retire pre-plan).

## Card 1 (JUL-253), 23 Oct afternoon
- 15:26: builder reported done except "Windows Proof unavailable" and stopped short of merge. Advisor check: verify-machine was removed 22 Oct and is on neither main nor the branch; the builder read it from the stale `/home/ubuntu/julia-next` checkout. The plan says a machine card's proof is a real Start run through Todd's Tailscale address. A stale copy produced a false blocker: same family as the stale CLAUDE.md park earlier today.
- The builder also called the free local estimate "Todd's decision". Todd only refused a separate API key; the estimate was the builder's own (sound) technical choice.
- Card ledger: $1.77 of $2 booked; ~$0.38 real usage, ~$1.39 worst-case charges for requests whose usage couldn't be read (mostly a since-fixed parser bug). Rule working as designed, but one unreadable request can eat a big share of a card's budget. Watch on the next card.
- 15:33: Todd asked to look for other distractions. GitHub: 17 old branches besides main and the card's, plus an old open PR (#282, laptop-era verification). Instruction sent: builder lists every leftover on the server (checkouts, services, timers, scripts, skill copies, laptop-era pointers) with a readback, removes nothing yet; then runs the real Start proof. Structural candidates: auto-delete merged branches, builds always from a fresh copy of main, status record reports leftovers.
