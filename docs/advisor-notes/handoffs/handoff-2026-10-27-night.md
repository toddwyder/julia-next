# Handoff, 27 Oct 2026, ~19:00 PT (advisor, acting as requirements + design agent in the dashboard pilot)

Supersedes `handoff-2026-10-27-evening.md`. Design is **done** (Todd, 18:42; reopened once for the running-card checklist, then closed with "no more screens", 18:55).

## The next session's job

**R5 → R6 → R7** of the front-door process, by hand:
1. **R5:** read `.claude/skills/to-spec/SKILL.md` (and the wrapper overrides in the front-door doc, "How Pocock's skills are wrapped" → `to-spec`), then synthesise.
2. **R6:** write the five-part shape: goal, done means, proof wanted, what we know, constraints. Anything that must be true goes under done means with a proof. Because a design is attached: a done-means line that built screens match the approved design, proof = side-by-side screenshots; and in what-we-know: "Follows the attached design, approved by Todd on 27 Oct 2026."
3. **R7:** create a new Linear project **Dashboard**, save the shape as one issue in **Backlog** there, attach the approved pictures. Stop. Todd's "settled" moves it to Ready. Don't apply `ready-for-agent`.
4. After each step: findings into the front-door doc's "Pilot findings" and ask Todd script vs judgment. One question at a time.

Before saving, run `node scripts/check-agent-brief.mjs` from the repo on the shape (four writing-for-agents rules) if it applies to this format; say if it doesn't.

## Read first

- Linear doc **"Requirements process: the front door (27 Oct 2026)"** (`3a6c5f9a-686e-4c3c-bf4e-8fd9c5d0acf1`). Part 1 = process. Pilot findings now run to **23**.
- **"Dashboard decisions"** (`f83207ce-e7f2-4e35-9fb2-a141cd39fbc3`): 0001–0008. **0008 is the list of what the pictures count for and every item written into the spec instead of drawn.** It is the spec's checklist of non-drawn requirements.
- **"Dashboard glossary"** (`3aeefb45-e2b8-4f98-8674-ee2a88a3cab9`): Compaction redefined tonight, Handoff added.
- `handoff-2026-10-27-afternoon.md`: the interview results (board, action items, decision support, success, root-cause stage, D1 read-back, taste profile). Still the source for requirements.
- Repo (`add_repo` toddwyder/julia-next push first; clone REST only): AGENTS.md, `docs/adr/0024-run-scorecard-and-stop-ping.md`, `scripts/scorecard.mjs`, `scripts/stop-ping.mjs`, `docs/harness/mastra-code.md`. The old build machine is gone from main (#354); cards run by hand in Mastra Code.

## Screens (all phone, Mint & Iris)

**Approved pictures are in one folder with an index for agents:** `docs/pilot/dashboard-d2/approved/` on branch `pilot/dashboard-d2` (draft PR #365, commit db615ef). `index.md` lists each file, what it counts for, and what is missing. Seven pictures: desktop board; phone board as loaded; phone board with running card open; running card with checklist; stopped card; "Needs you" opened; a card's own page.

- **Missing from the folder:** the Start screen (0007) and Decision support Map/Ranked/Cards (0006). They are only in Todd's Stitch "App" project; ask Todd to export them (from Stitch, not GitHub).
- Each picture counts only for what it was drawn to show (0008). Stitch invents the frame on every screen (profile icon, bell, "Factory Board" header, bottom menu Board/Inbox/Pipelines/Insights, "Live sync", a second Needs-you bar with "4 blocking release"). None of it is built. The desktop board counts for look and column layout only.
- Also: gallery artifact "Julia Dashboard Looks" (https://claude.ai/artifact/QS5hQnsbT1cFpNZFT2NWFV) holds the first three.

## Facts found tonight (for "what we know" / constraints)

- **Context size:** recorded; `scorecard.mjs` already computes average context re-read per step.
- **Compactions:** Mastra Code never compacts; observational memory condenses messages into notes (~30k tokens of history) and rewrites the notes (~40k). Each counts as one compaction (glossary). Whether those events are stored where the dashboard can read them is **unverified** (server not reachable; Mastra docs name `data-om-observation-end` stream chunks and onObservation/onReflection hooks). Sources: https://mastra.ai/blog/announcing-mastra-code, https://mastra.ai/docs/memory/observational-memory.
- **Handoffs:** a fresh chat on the same card; the scorecard already lists each thread per card, so countable.
- **Role:** only partly recorded. Subagent calls save `agentType` (explore/plan/execute) and `modelId`, not pstack's role name. Decision 0003 (compare any model in any role) needs the build to record the role per call.
- **Retro complete:** recorded nowhere. Trace deletion (0004) needs the build to add a record.
- **Stop cause / root-cause stage:** `stop-ping.mjs` appends each stop (time, question) to `~/.local/state/julia/stops.jsonl` and pings via Linear; no cause or stage. Build must add.
- **"Answer" on a build's question:** where Todd answers so the running build receives it is not settled; technical, for the build.
- npm registry is unreachable from this cloud session (DNS); package facts came from repo docs and Mastra's site.

## Pilot findings written tonight (18–23) and agreed script/judgment

18 Stitch invents the frame; 19 Todd skipped polish ("the only real way I will know is when we start using it"); 20 coverage check earned its place; 21 D7 worked; 22 D8 folder can't exist in the pilot; 23 coverage check missed the checklist, Todd caught it.
Agreed: **script** = the coverage check's list of interview functions against drawn screens (Todd: "you or cheap agents should go through the requirements and screens"); **judgment** = what to do about each gap.
Note on 22: Todd then asked for the approved pictures in a folder with an index for agents; it now exists on the pilot branch (above), which is D8's hand-back folder in practice.
Still unwritten from earlier and **still not applied**: the approved doc fix removing the Part 1 line that pre-routes the dashboard to the raw-idea case. Ask Todd once more before editing.
Still not agreed: D3–D5 "script or judgment" proposals (download/type-check/save a Stitch screen; build the side-by-side page).

## Loose ends

- Draft PR #365 (`pilot/dashboard-d2`) open; it now also holds the approved folder. Close it and get the branch deleted only after the approved pictures are attached to the Linear issue (or moved to the dashboard's `ui` folder on main). Only main may remain; CI checks branches without a PR.
- Stitch key in the "Julia agents" vault (`Stitch`/`credential`), wired via #364; unproven on the server.
- Un-deferring staging goes through the front door after the dashboard.

## How to work with Todd (tonight)

- Short replies, failure first, one question at a time.
- Check every Stitch result for inventions before calling it right; judge from the picture.
- When Todd says something is missing, verify against the source (tonight: the gallery image confirmed the checklist was missing) and say plainly he's right.
- Write decisions and glossary entries as he states them; ask before editing process docs.
- No card numbers in replies.
- He asked for a fresh context before the long spec step.

## Access

- julia-next: `add_repo` first; REST only (`gh api`); clone with a long timeout.
- Linear tools work. Server not reachable. Stitch not reachable from the cloud chat. npm registry not reachable.
- Laptop link may be present (file access only).
