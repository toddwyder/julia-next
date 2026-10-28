# Handoff — 24 Oct 2026, 08:30 PT

Read first: `plans/path-forward.md` in the repo (`docs/plans/path-forward.md` on main is the current copy; the project copy is older), `principles/inverse-pyramid.md`. Previous: `handoffs/handoff-2026-10-23-afternoon.md`. Retro facts: `retros/2026-10-22-hybrid-trial-notes.md` (last entries 23 Oct 15:33; this handoff's "For the retro" section is not yet copied there).

## Where things stand
- **Card 1 (JUL-253, models and money): Complete.** PR #322 merged as 76a8bf1, CI green. Advisor verified: main's AGENTS.md has the $2 rule (no $0 line); final proof JUL-262 finished through the Tailscale Start page with Claude Haiku 5.5 directing and DeepSeek coding, reviews one Claude + one DeepSeek, only the one-line marker changed, $0.38 of $2. Evidence: `docs/agents/jul-253/claude-start-proof/attempt-5/`.
  - Todd's decisions: Sol's 26 settled requests through Start (JUL-254, 23 Oct) count as the ChatGPT-connection proof. The split was proven with Claude in Sol's place; settings still have Claude there (Todd: "see how it goes", decide later).
  - Also done inside card 1: server leftovers removed (old `/home/ubuntu/julia-next` checkout, `/var/lib/julia-build`, old scripts, sudoers entries, unused 1Password token file, orphan processes; notifier points at julia-machine-main), GitHub cleaned (only `main`; PR #282 closed), CI checks: duplicate skill names, agent-read links to missing paths, branches without an open PR. Retired pre-plan, Pocock tdd/teach, laptop parts of the server runbook. Builder fences, Sol plan-first step, DeepSeek research roles.
- **Card 2 (JUL-263, live view): built and merged, not yet checked by the advisor.** Todd cut it to the dashboard only (no GitHub copy, no Linear comment). Brief settled 24 Oct with two criteria: the dashboard shows the running build's pstack checklist; each step shows finished as the build completes it. Linear still says **Ready** (agent didn't move it).
  - Merged: #325 checklist parser, #326 plan-only turn tool-free, #327 real build contained and kept out of publishing (no `request_access`, host owns git/GitHub), #328 proof record. `path-forward.md` item 2 updated on main.
  - Proof: Beam practice build JUL-266 through Start, $0, screenshots 2/8 → 3/8 running → 3/8 at end. Record: `docs/agents/jul-263/README.md`, `proof/final/`. Took six attempts.
  - **Advisor to check before Complete:** at the end the dashboard shows 3 of 8 with five steps "skipped and unticked". Does the dashboard tell skipped from not-done? A finished build reading 3/8 looks unfinished to Todd. Also Beam skipped mandatory playbook steps; that's Beam, not the dashboard, but say so.
- **Next:** card 3 (deployment safety), then card 4 (clean-up). Remaining card 4 pieces include the no-stand-ins CI check (a stand-in test hid a crash on 24 Oct) and Start's admission check accepting the short brief.

## Who does what now
- **The agent** (builds the machine; cards 1–4): Command Code CLI on DeepSeek V4.1 Flash, **on the server**. Todd opens it from the Windows Terminal profile "Julia builder" (`ssh -t ovh` → tmux session `julia-builder` → `/home/ubuntu/bin/julia-builder`, which pulls main in `/home/ubuntu/julia-builder` and starts `cmd --yolo --trust` with `op run --no-masking`). Instructions go there.
- **The machine's build** (what Start runs): practice cards use Beam (Todd, 24 Oct), except when a model connection is what's being proven.
- Antigravity (Gemini) runs on Todd's **laptop**. It was used for setup; its plan edit on 24 Oct never reached GitHub. Don't send project work there.
- Vocabulary agreed with Todd: "the agent" vs "the machine's build". No card numbers alone; name the work.

## Money
- ChatGPT plan (Sol, and Codex): weekly quota used up 23 Oct; resets **30 Oct** (short limit reset 24 Oct 01:03).
- CommandCode: $10/month GOAT plan giving up to $80 credit; refilled 22 Oct; **$4.30 left** at 23 Oct 23:00 (before the card 1 finish and card 2 runs); next refill **22 Nov**. Usage page: 300 DeepSeek V4.1 requests / 28M tokens this month; 24 Ornith 1.5 122B requests (~9%) from something outside the machine, source unknown. Credit isn't machine-readable (web sign-in only); Todd reads it before/after a card.
- Card cap $2 per card, every model at API price, subscriptions included. Todd: the agent's own DeepSeek work is capped at $1 per card; not enforced (agent bypasses the machine's ledger); accepted until the machine builds cards itself.

## Loose ends (each: fix when it blocks, else accepted)
- Laptop leftovers: `~/jul253-clean` project copy (origin unknown), Windows Terminal profile "Julia Codex" pointing at the deleted server checkout. Not cleaned.
- Command Code "taste" learned "act immediately, no plan mode" (from Antigravity's test) in its taste file. Accepted: doesn't affect the machine's build.
- Claude stands in for Sol in settings; Todd decides after the 30th.

## For the retro
- Card 1 failed proof four times. Root cause (Todd agreed): the first real run of new code was always the proof; checks ran pieces in isolation, once with a stand-in that hid a crash (breaks Todd's no-fakes rule). Plus advisor grew the card at every restart (cleanup, fences, plan step, research roles), and each untested addition broke the next proof.
- The proof bar (full build end to end) was nearly dropped by the advisor to close the card; Todd caught it. Shrink scope, never criteria.
- Stale copies again: builder read the retired verify-machine skill from the stale server checkout → false Windows blocker. Old "Julia Codex" profile ran Codex in that stale checkout all along.
- Advisor wrote "stop and report, don't fix" into an instruction against Todd's stop rule; turned a setup bug into a round-trip. Todd: never suggest stopping.
- Quotas: ChatGPT weekly gone in a day; CommandCode month's credit nearly gone in two days. The agent's own work is the big, unmetered spender.
- Advisor slips Todd corrected: led with spin ("the proof did its job") instead of "it failed"; walls of text; "raise the cap" as first instinct; card numbers; asserted Codex ran on the laptop (wrong); proposed signed-commit enforcement (dropped as needless machinery); kept stacking setup steps when switching models.

## Working rules (also in memory)
Short replies; failure first, plainly. Think through before proposing; no quickest-fix reflex. One question at a time. Verify before stating. Fixes as high in the pyramid as they go. Never suggest stopping; problems get fixed and work continues. Don't grow a card's scope. When Todd pastes a report, discuss first. Say so when Todd isn't right.

## Access
`gh api` REST works (repo attached with push access). Linear tools work. The server and dashboard aren't reachable from the cloud session; evidence lands on GitHub with each card. When the chat is linked to Todd's laptop, the device tools work (folder reads need his approval).
