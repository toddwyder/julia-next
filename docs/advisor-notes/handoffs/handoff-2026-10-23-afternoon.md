# Handoff — 23 Oct 2026, 15:15 PT

Read first: `plans/path-forward.md` (also in the repo as `docs/plans/path-forward.md`; both copies match as of PR #321), `principles/inverse-pyramid.md`. The earlier `handoffs/handoff-2026-10-23-midday.md` covers the morning (JUL-231 done, retro, plan agreed).

## In flight: JUL-253 (card 1, Models and money)
- **Card:** "Connect subscriptions and enforce the $2 card cap". Three criteria: the machine builds with Todd's ChatGPT and Claude subscriptions as well as CommandCode; no card spends more than $2 with every model counted at its API price; builds use the agreed model split. Settled 13:30. Built by the planner agent (Codex) in a fresh session.
- **Status:** Linear says Implementation. **PR #322** (`build/jul-253`) is open, still being worked, and not approved for merge. Head a25dcbd (15:11 PT); CI was running on it at handoff (web and Vercel green, package and server tests running).
- **What its commits report (not yet checked by the advisor):** both stock sign-ins saved; Claude **Pro** passed a real request; a real DeepSeek request settled a charge; 59 runner tests and 47 mutation probes pass. Sol was refused because OpenAI's token-count endpoint rejected the subscription token (HTTP 401). The latest commit replaces that with a free local token *estimate* (padded 2x plus 4096 tokens) to size reservations. Settlement still uses actual usage at API prices; "no cost" in the commit title means the estimate costs nothing, not that subscription use is free. It also lowers DeepSeek's max output from 8192 to 4096.
- **Check with Todd:** the commit says "Todd's 23 October decision authorizes a free local tokenizer or estimate instead of another credential." The advisor never saw Todd make that decision. Confirm it with him before accepting it.
- **When the PR reports done, the advisor verifies from raw evidence:** real Sol and Claude requests in the ledger, each counted at API price; a request refused when it would pass $2; the split in effect; "Spending is $0" gone from AGENTS.md (the docs test `scripts/agent-docs.test.mjs` currently asserts it, so the PR must change that test too); green CI on the final head. Then Todd decides the merge (UAT doesn't apply; it's a machine card with nothing for Todd to try).
- The early park (13:43) came from the stale CLAUDE.md "park" rule contradicting AGENTS.md. Fixed: see below.

## Merged today after the midday handoff
- **#318** plan and inverse-pyramid rule in the repo; AGENTS.md points to them.
- **#319** plan updates: card 2's live checklist also appears as one updated comment on the Linear card; card 4 updates Start's admission check to the short brief and runs four writing-for-agents rules as one script (no text copied from repo docs, criteria in outcome form, no implementation words in criteria, no negations in criteria), which the planner agent also runs before showing Todd a brief; **cards 1–4 are built by the planner agent, and the machine builds from card 5** (Start's admission check still requires pre-plan-era fields until card 4; the $0 rule blocks paid models until card 1).
- **#320** CLAUDE.md now just imports AGENTS.md (one rulebook); a test fails if it stops importing it or gains its own rules (seen red on the old file).
- **#321** plan notes CLAUDE.md is done (out of card 3).

## Decisions this afternoon (all in the plan)
- Verbose cards are a repeat. Brief length is not the measure; deterministic checks of the kinds of verbosity seen are (card 4's script above). The writing-for-agents skill keeps only the judgment parts.
- Claude is connected in card 1 but has no job until the evidence review (card 6). Todd is fine with that.
- Card 1 couldn't be started with the Start button: Start's admission check would refuse the short brief, and only Beam is usable under the $0 rule.

## Retro notes added (`retros/2026-10-22-hybrid-trial-notes.md`)
- Verbose cards repeat; admission schema still pre-plan era (goes into card 4).
- Stale CLAUDE.md caused a real park; fixed in #320.

## Working rules (unchanged from midday; also in memory)
Roles by job (planner agent, machine, advisor, Todd). Fixes as high in the pyramid as they go. One-line instructions to the planner agent; decisions live in cards and the repo. Say so plainly when Todd isn't right. No new work without an agreed plan. One question at a time. Verify before stating, including UI directions. When Todd pastes from the planner agent, discuss first.

## Access
`gh api` (REST) works; GraphQL doesn't. CI logs are blocked, so read failures from check annotations. The server isn't reachable; get raw readbacks pushed to GitHub by the planner agent (card 2 adds a status record). A merge loop that waits on a specific head SHA fails harmlessly if a new commit lands; rerun it on the new head.
