# Handoff, 27 Oct 2026, ~12:00 PT (advisor)

This thread was only the requirements process. The recipe library card and its retro were handled in other chats and are done; don't reopen them. Earlier handoffs today (`session-handoff-2026-10-27-0645.md`, uploaded) are superseded on the requirements process by this file.

## The next session's job

Take the **dashboard** through the front-door process by hand, **with Claude acting as the requirements agent (and later the design agent)**. After each step, Todd and Claude decide what to change in the process and which parts become scripts versus agent judgment. Todd's words: "then it's battle tested."

Start at **R2** (R1 is done: Todd's input is below). Follow the doc literally. Read each skill before using it. Note where the step is unclear or where you depart from it.

## Read first

- Linear doc **"Requirements process: the front door (27 Oct 2026)"**, id `3a6c5f9a-686e-4c3c-bf4e-8fd9c5d0acf1`, now in the **Framework** project. Part 1 is the process (R1–R7, D1–D8). It has an empty **"Pilot findings"** section before Part 3; findings go there.
- `ask-matt` from the repo: `.claude/skills/ask-matt/SKILL.md` in `toddwyder/julia-next` (read this session). For a raw idea in a working directory it routes to `/grill-with-docs`; it's manual-only (`disable-model-invocation: true`). Its UI detour uses `/prototype` + `/handoff`, which our design agent replaces.
- Then read `grill-with-docs`, `grilling` and `domain-modeling` in `.claude/skills/` before interviewing.

## R1 input (Todd's words, 27 Oct 11:46 — use as given, not with Claude's additions)

> Dashboard
> * Inner Loop - Running the factory/Control plane
>    * Model picker
>    * Kanban board - Every running agent in one view, across tools
>       * Steps
>       * Wall clock time
>       * Link to issues
>    * Action Items
> * Outer Loop - Improving the factory/Decision Support
>    * Model
>       * Cost
>       * Tokens - Cached, Input, Output
>       * Success rate
>       * Human interventions
>       * Root cause by stage (requirements or build)

Earlier he said: "the dashboard is inner loop, which is running the software factory, and outer loop, which is improving the software factory."

**Gaps Claude pointed out in chat (not added to the input on purpose).** The interview should find these itself; if it doesn't, that's a pilot finding:
- Start/stop.
- "Doing now" + time since last activity (stuck), not just wall clock.
- Cost so far per running card.
- Link to the run record (trace).
- Waiting-on-you ping vs on-screen action items.
- Cost per card, not only per model (the lasting per-card limit is set from ~75th percentile of real cards).
- Send-backs and evidence-review verdicts (the factory's rework rate; "success rate" is undefined).
- Stops and their causes.
- Retro fixes awaiting Todd's approval.
- Time from "settled" to merged.
- Design as a root-cause stage.

Data fact: stop reasons, review verdicts and send-backs may exist only as prose in Linear comments, not as data.

**Research shown to Todd** (vendor sources, treat as what the industry tracks, not proof):
- AWS CloudWatch Coding Agent Insights: tokens by model/type, per-turn latency, tool calls, API requests, approvals; sliced by user/team.
- Braintrust: cost/tokens over time; by user, model (cost per M, cache share), tool, branch.
- Faros: DORA's five (deploy frequency, lead time, recovery time, change failure rate, rework rate); AI raised review time 91%, PR size 154%, bugs 9%.
- Warp: one view of all running agents; per-run traces; cost per change; cycle time per stage; review/eval outcomes.

Per-run traces in Julia = the machine's saved event log + Mastra Code thread. For the dashboard: a one-line "doing now" and a link, not raw traces; full traces feed the advisor, root cause on stops, and the retro (`/correct`, `/recall`).

## Where the pilot's outputs go (Todd, 27 Oct)

- **Linear project "Framework"** (P-JUL-9), created this session.
- Interview glossary → Framework doc **"Dashboard glossary"** (id `3aeefb45-e2b8-4f98-8674-ee2a88a3cab9`). Kept apart from Julia's `GLOSSARY.md`.
- Interview decision records → Framework doc **"Dashboard decisions"** (id `f83207ce-e7f2-4e35-9fb2-a141cd39fbc3`).
- Both docs get moved into the repo once the builder sets up the dashboard's own glossary/ADR folder. No repo changes during the pilot.
- Step findings → "Pilot findings" in the front-door doc.
- At R7 the shape is saved as a Linear issue in Backlog in the **Framework** project.

## Settled this session (all written into the front-door doc)

- **What the design agent receives:** the `grill-with-docs` output if it ran first, otherwise what Todd submitted (on the triage route, the raw issue), plus any existing design R4 found. No separate hand-off document. It looks up facts itself; it asks Todd decisions, one at a time.
- **R7** now reads: save the shape as a Linear issue in Backlog and stop; Todd's "settled" moves it to Ready; ignore `ask-matt` if it points to `to-tickets` or `implement`.
- Open item "what starts work after Ready" **removed**: not the front door's concern. Todd's view: no plan line needed. pstack's plan playbook already waits for the operator's go; he gives it, and may have a big plan saved as several cards.
- Open item "screen check after build" **closed**: the evidence review judges the "matches the design" done-means line; no separate comparison agent.
- Open item "Stitch costs" **closed**: the dashboard is too small to hit free limits; the figures moved to the Stitch research note.
- Builder clean-up item now also says: remove Pocock's `implement` and `to-tickets` from `.claude/skills` (both confirmed still installed on 27 Oct).

**GPT's review of the doc:** Claude rejected the "done" readiness gate and the hard look/behaviour rule. Claude took the design-agent input gap (now settled above). Claude partly took the "required screen gate" (resolved as above). Todd didn't contest.

## Still open in the doc (all work, not decisions)

1. Connecting the design agent to Stitch: a builder question. Claude has no Stitch connection, so the pilot hits this at D2 (look and feel). Fallback in the doc: stock `prototype`'s UI branch.
2. Builder clean-up items.
3. The two agents' shapes, by hand. The pilot feeds these.

## Limits to keep in mind during the pilot

- It tests the process, not the agent. Claude is a different model and setup from the eventual agent. Where Claude succeeds by judgment, ask whether the real agent would; that's where "script vs agent" gets decided.
- `grilling` asks rounds of questions. The doc's wrapper says one question at a time, with a recommended answer worded so "yes" accepts it. Facts are the agent's job; decisions are Todd's.

## How to work with Todd (reinforced this session)

- He caught Claude treating settled things as open ("we already decided much of that"). Read the doc fully and say what's settled before calling anything open.
- He questioned whether things belong in a doc at all ("why do we need a plan for those"). Default to not recording what a tool already does; prefer removing a thing over writing a rule about it.
- One question at a time, with a recommendation. Explain plainly when asked. Edit docs only after he says "settled"/"closed".
- No card numbers in replies to Todd.
- Don't start the pilot until he says so in the new session.

## Access

- `gh api` REST works on `toddwyder/julia-next` (attached this session with push).
- Linear tools work: read/write docs, create projects.
- Vercel addresses are blocked from this cloud session.
