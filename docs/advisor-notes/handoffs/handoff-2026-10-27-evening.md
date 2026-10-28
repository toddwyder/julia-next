# Handoff, 27 Oct 2026, ~18:30 PT (advisor, acting as requirements + design agent in the dashboard pilot)

Supersedes `handoff-2026-10-27-late-afternoon.md`. For the interview results (R3), the taste profile and the facts still owed, read `handoff-2026-10-27-afternoon.md`; they still stand.

## The next session's job

Continue the dashboard pilot at **D6 (coverage check)**: draw three more phone screens with Todd in Stitch, then D7 (Todd says "done"), D8 (hand back), R5 (`to-spec`), R6 (five-part shape), R7 (Linear issue in Backlog in a new **Dashboard** project). After each step, write findings to the front-door doc's "Pilot findings" and ask Todd what becomes a script vs judgment.

Screens still to draw (Todd: "I'll trust you" on the split):
1. **A card's own page** (where "tap a card" leads in Decision support): cost and tokens by role and model, rounds, evidence-review verdicts per criterion (proven / not proven / wrong thing tested), interventions with stage (requirements / design / build), compactions, time per column from Start to merge, links to Linear issue and trace.
2. **"Needs you" opened**: the six action items: card in UAT; stopped card's restart plan; shape in Backlog awaiting "settled"; retro fixes awaiting approval; one-click account approval; a running build waiting for Todd's answer. Each links to where he acts.
3. **A stopped card on the board**: stop reason and restart plan.

Written into the spec, not drawn: empty / loading / failed states (no cards running; dashboard can't reach the machine); trace link and compactions on the running card; tokens split cached / input / output. Desktop versions come after the phone screens are settled.

## Read first

- Linear doc **"Requirements process: the front door (27 Oct 2026)"** (`3a6c5f9a-686e-4c3c-bf4e-8fd9c5d0acf1`, Framework project). "Pilot findings" now has R2–R3, R4/D1/D2 (findings 1–9) and D3–D5 (10–17). Script-or-judgment proposals there are **not yet agreed**.
- **"Dashboard decisions"** (`f83207ce-e7f2-4e35-9fb2-a141cd39fbc3`): 0001–0004 from the interview; added this session: **0005** Mint & Iris look + folding phone board, **0006** Decision support (Map / Ranked / Cards, map first), **0007** Start screen.
- **"Dashboard glossary"** (`3aeefb45-e2b8-4f98-8674-ee2a88a3cab9`).
- Main's AGENTS.md and newest ADRs before stating machine facts.

## Decided this session (all in the decisions doc)

- **Look: Mint & Iris.** Mint #059669/#10B981, iris #6366F1, amber #F59E0B (waiting on you), rose (stuck), slate neutral #64748B, light, Public Sans everywhere (JetBrains Mono only for numbers), 12px rounded cards, pill badges.
- **Phone board (Todd's own idea):** stages stacked top to bottom, each folding to one line with its card count; on load only stages with a running, stuck or waiting card are open (Backlog, Ready, Complete folded); inside, each card shows its top row (title + status) and expands in place on tap; "Needs you" on top. Rejected: sideways columns, tabs (30 Backlog cards = too much scrolling).
- **Decision support:** Map / Ranked / Cards switch, Map default; fewer than 10 cards → "too few cards to trust yet" (dashed bubble); keep a "Suggestion" box (Todd: it may steer him to something he didn't think of).
- **Start screen:** "Start with last settings" on top, summary (main session, evidence reviewer, effort); **"Effort"** picker with 1–4 brain icons (Todd's word: effort, not budget or thinking); models set per group with a down-arrow opening the roles; groups Building, Judgment, Investigating, Learning, Panels, Workers holding pstack's 17 role lines by real names, each with an ⓘ plain explanation (taken from pstack's own skill files: `poteto-mode`, `how`, `why`, `reflect`, `arena`, `architect`, `interrogate`, `swarm`, `setup-pstack`); $ to $$$$ = model price, never effort; ping line "Ping when it finishes: Linear notification to Todd" (not Slack); Start fixed at the bottom.

## Stitch: how it works now

- **Todd works in Stitch's website directly; the advisor writes prompts; Todd sends screenshots back.** ~4 min a round vs ~20 through the server agent (finding 9–10). The server-agent route stays for scripted work.
- **Projects:** old "Julia dashboard pilot" (`12943705270951129641`) is worn out (crowded canvas). **New App project** created ~18:08 with the Mint & Iris DESIGN.md; its design-system card drifted to darker shades (#006C49, #4648D4, navy neutral) but screens read as Mint & Iris; left alone. The final Start screen is in the new project.
- **Method that works:** describe each new screen fully in text (not a screenshot to recreate), end with "Use only these names. Add nothing else."; one or two changes per edit, naming the screen and element; check every result for inventions (LIN numbers, estimates, Slack, caps); judge from screenshots, not Stitch's text replies; if a result misses, word it narrower rather than repeating it.
- Taste rules: Todd judges looks from pictures only; never describe looks in words for him to pick.

## Loose ends

- **Draft PR #365** (`pilot/dashboard-d2`, last commit 41cfd64) is open and unmerged. It holds the server agent's screens. Close it and get the branch deleted once the pilot no longer needs it (only main may remain).
- Gallery artifact "Julia Dashboard Looks" (https://claude.ai/artifact/QS5hQnsbT1cFpNZFT2NWFV): desktop pick + two phone screens.
- Small known flaws, not worth rounds: Judgment shows $$$$ for Sol (summary says $$$); "PULSE" label on the expanded running card is jargon; stray "RK" on the map's zone label; Sol/Opus bubbles overlap.
- Facts owed before `to-spec` (from the afternoon handoff, still open): whether Mastra Code records context size, compactions and each request's role; where "retro complete" gets recorded; where stop causes / root-cause stage get recorded as data.

## How to work with Todd (this session's lessons)

- An instruction for an agent says what the work is for, how to do it, and what done looks like; a bare step list is lazy.
- Check a capability before offering it: computer use gives terminals click-only (no typing), so the advisor can't drive Windows Terminal.
- Files on GitHub don't work for Todd; give him a page or Stitch.
- One question at a time; short replies; failure first; read before stating.
- Todd caught that Stitch tires with a crowded canvas; fresh project fixed it.

## Access

- julia-next: `add_repo` (owner `toddwyder`, repo `julia-next`, access push) first; REST only.
- Linear tools work. Server not reachable. `stitch.googleapis.com` refused from the cloud chat (re-checked 16:49).
- Command Code: `/clear` starts a fresh session when one is stuck.
