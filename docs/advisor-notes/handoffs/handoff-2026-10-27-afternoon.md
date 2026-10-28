# Handoff, 27 Oct 2026, ~14:25 PT (advisor, acting as requirements + design agent in the dashboard pilot)

Supersedes `handoffs/handoff-2026-10-27-midday.md` for the pilot. Read that one only for background (R1 input, research shown to Todd).

## The next session's job

Continue the **dashboard pilot** of the front-door process at **D2, step 2: draw the look-and-feel variants in Stitch**. Todd will create **one Stitch API key**, save it in the **"Julia agents" 1Password vault**, and paste the same key once in the new chat. It is **kept, not deleted** (Todd, 27 Oct 14:24: deleting a key every time is too much work; a Stitch key can only make designs; the agent will use the same key from the vault). Then D3 to D8, then R5 (`to-spec`), R6 (shape), R7 (save as a Linear issue in Backlog in a new **Dashboard** project). After each step: findings into the doc's "Pilot findings", and decide with Todd what becomes a script vs agent judgment.

Todd asked for a fresh context so the work doesn't stop or compact mid-step.

## Read first

- Linear doc **"Requirements process: the front door (27 Oct 2026)"**, id `3a6c5f9a-686e-4c3c-bf4e-8fd9c5d0acf1` (Framework project). Part 1 = the process (R1–R7, D1–D8). "Pilot findings" now has the R2–R3 findings and the script-vs-judgment list.
- Framework docs **"Dashboard glossary"** (`3aeefb45-e2b8-4f98-8674-ee2a88a3cab9`) and **"Dashboard decisions"** (`f83207ce-e7f2-4e35-9fb2-a141cd39fbc3`). Both were filled during the interview; read them in full.
- **Main's current state, not the handoffs.** The old build machine (Start, runner, spend ledger, 15-minute stop, evidence-review code) was **removed from main on 26 Oct (#354)**. Cards now run by hand in Mastra Code, scored by `scripts/scorecard.mjs` from Mastra Code's own records (`docs/adr/0024-run-scorecard-and-stop-ping.md`). Read AGENTS.md and the newest ADRs before stating any fact about the machine.
- Owl's `design-taste`: `skills/design-taste/SKILL.md` in `Owl-Listener/designpowers` (public; clone read-only). pstack `in-your-own-words`: `.agents/skills/in-your-own-words/SKILL.md`.

## Stitch connection

- Stitch is **not** in the claude.ai connector directory (searched 27 Oct).
- Third-party sources only (not Google's docs; confirm against Google's own Stitch MCP docs first): the key is made in Stitch settings → API keys and starts with `AQ.` (mindstudio.ai blog); a local MCP proxy runs as `npx @_davideast/stitch-mcp proxy` with env `STITCH_API_KEY` (metawhisp.pages.dev). The front-door doc's research note says the MCP endpoint is at stitch.googleapis.com.
- **Pilot:** run Stitch's MCP from the cloud workspace's shell with the pasted key in an environment variable (never written to a file in the repo or to memory), check it answers, then generate.
- **The real design agent** (agreed with Todd 27 Oct): gets the key from the vault like every other agent key. Agents on the server run commands as `node scripts/julia-agents.mjs -- <command>`, which injects the keys listed in `scripts/julia-agents.env` through `op run` with the agents' service-account pass. Adding Stitch = a `STITCH_API_KEY=op://…` line in `scripts/julia-agents.env` and `STITCH_API_KEY` in the `fields` set in `scripts/julia-agents.mjs` (builder work, part of the design agent's card). Todd's only step, ever: create the key and save it in the "Julia agents" vault. This answers the front-door doc's open item 1 ("who holds the key must not land on Todd") — write that into the doc when Todd agrees.
- Routes rejected today: Todd editing the desktop app's JSON (breaks his never-edit-config rule, key in plain text); driving Stitch's website in a browser (Todd: burns tokens fast); Todd pasting prompts himself; a pilot-only key deleted afterwards (too much work every time). This cloud chat can't reach the vault itself (the vault is reached only from the server).

## D2 where it stands

D2 = short look-and-feel probe, then Stitch variants of **one representative screen with real labels**, Todd picks, the pick becomes the project's `DESIGN.md`. Probe is **done**; Todd confirmed this taste profile:

- **Feel:** clean, light and colourful; information you see before you read it, with room to explore.
- **Do:** Trello (easy to see what's on each card, white space, colour that means something); Grit habit tracker (clean and colourful); NYT interactives and Tableau Viz of the Day (interesting ways of displaying information); flowcharts, blueprints, cards, interactivity, drill-down.
- **Don't:** dark / "techno dungeon" / terminal looks (engineer default and Mastra Factory's vibe); lots of text to read; hard to find things; lots of scrolling; information for agents not Todd; technical wording; no visual appeal or visual information displays.
- **Opposite he wants (confirmed):** glance, don't read; status as pictures and charts; most important thing where the eye lands first; each view fits a phone screen without scrolling; plain words; only what he needs, detail one tap away.
- **Borrowed from Mastra Factory:** the kanban layout and what's on each card, not its look.
- Taste profile file: save in the dashboard's `ui` folder next to `DESIGN.md` (doc rule) once a repo folder exists; no repo changes during the pilot, so keep it in Linear or chat for now.

Next: Stitch variants of the board screen (the representative screen), real card names, steps, stuck/waiting states, cost, at desktop and phone width. Save each prompt with its screen. Todd picks.

## Settled in the interview (R3, grill-with-docs), the input to design and to-spec

Users: Todd only uses the dashboard (one other person uses Julia, not the dashboard). Works on his phone through Tailscale (he has it).

**Board** (first screen)
- Only the machine's cards (decision 0001). One tile per card, its agents inside.
- Columns (copy Linear, minus unused): Backlog, Ready, Implementation, Evidence review, Remediation, Staging/smoke test, UAT, Complete. Code review left off (no code moves cards there; removal was cut 24 Oct, not decided). Triage, Canceled, Duplicate left off.
- Complete tiles stay until the card's **project** is Completed (decision 0002). Every piece of work gets its own project (pieces of Julia like recipes and shopping list; each machine change, incl. the dashboard).
- Ready tile has **Start** → picker: main session, all 17 pstack roles (panels take a list; length = fan-out), the evidence reviewer, and pstack's **budget** (one choice per build: small/medium/large/unlimited; in Mastra Code effort is per session). Filled with last choices. Every model has its real price (Beam is the only free one, $0); a missing price is a lookup the agent does.
- Running tile: pstack checklist (done / working / to go / skipped with reason on tap) with elapsed time per step; "doing now" line + time since last activity; cost so far against the per-card limit once set; context fill and compactions per agent; links to Linear issue and trace; **Stop** (ends build, keeps work on its branch, card stays in its column; Start again starts fresh).
- **Stuck** after 5 min no activity, easy to see at a glance; "waiting on you" looks different from stuck.

**Action items**: six — card in UAT; stopped card's restart plan; shape in Backlog awaiting "settled"; retro fixes awaiting approval; one-click account approval; a running build waiting for Todd's answer. Each links to where he acts and sends a Linear notification (ADR 0024's issueReminder route exists).

**Decision support** (one tap away)
- Compare any model in any role (decision 0003): success rate, interventions, root-cause stage, cost and tokens (cached/input/output), compactions per round, second-round rate, typical step times.
- **Success** = Complete with no human intervention caused by the build; automatic rounds within two are fine; an intervention caused by requirements/design counts against that stage.
- **Root-cause stage** = requirements, design or build; recorded as data by the root-cause analysis; Todd can correct it when approving retro lessons.
- Evidence review verdicts per criterion (proven / not proven / wrong thing tested).
- List of all cards (sort by cost, time, rounds, interventions); each card's page: cost/tokens by role and model, rounds, verdicts, interventions with stage, compactions, time per column from Start to merge, links to issue and trace.
- Per-card spending limit: set later from real cards (~75th percentile); Decision support shows the spread so it can be read off.
- **Trace deleted when the card's retro is complete** (decision 0004): old factory traces were 10–15 GB per round and filled the drive.

**D1 read-back** (confirmed with corrections): assumed live updates without refresh, several cards can run at once, Start only on Ready, no date/project filter in Decision support, phone and desktop equally important. Kept out: old dashboard, its mockup, Julia's `DESIGN.md`; editing card text (stays in Linear); Triage/Canceled/Duplicate; raw traces on screen.

## Facts still owed before to-spec (agent's job, not Todd's)

- Whether Mastra Code records context size, compactions and each request's **role** somewhere the dashboard can read (ADR 0024: tracing gives cost per model and agent; traces pruned after 14 days; DeepSeek unpriced in Mastra's table).
- Where "retro complete" will be recorded so trace deletion can key on it.
- Where stop causes / root-cause stage get recorded as data (today prose in Linear comments).

## Constraints / side work the interview created (carry into the shape or route separately)

- Un-deferring **staging**: Todd said it shouldn't be deferred (main's plan lines 110–111 say deferred, Todd 25 Oct). Goes through the front door as its own work after the dashboard (finding 9).
- Every new piece of work needs its own Linear project; create **Dashboard** project at R7 (Framework keeps process docs, glossary, decisions).
- Retro must complete before a card's trace is deleted.
- The design agent's card includes adding Stitch to the agents' vault route (see Stitch connection).

## Pilot findings not yet written to the doc (write after Todd says so)

- **R4:** asking "does it have a UI?" was a formality after the interview; the doc says ask anyway.
- **D1:** read-back caught two wrong assumptions (one user — there are two people but only Todd uses the dashboard; "no spending caps" — there will be a per-card limit). Worth keeping.
- **D2 probe:** one open question at a time, no recommendation for taste questions (departs from the wrapper's "recommended answer" rule on purpose: a recommended taste would be Claude's taste). Worked in 5 questions.
- **D2 Stitch:** the doc gives a fallback only for D3, none for D2; the key-holder problem blocked the step for ~30 min. Resolved: one key in the "Julia agents" vault, used by the agent through `scripts/julia-agents.mjs`; Todd's only step is creating and saving the key once.
- **Doc fix approved but not applied:** remove the line in Part 1 that pre-routes the dashboard to the raw-idea case (finding 1). Ask Todd before editing.

## How to work with Todd (this session's lessons)

- Read main before stating facts; this session stated old-machine facts from handoffs and Linear statuses from memory, both wrong.
- One question at a time; recommend where it's a factual/technical default, ask open where it's his term or his taste. He corrected three recommendations that were guesses (milestone→project, builder model→any role, trace retention).
- Write glossary and decision entries as answers land (he accepted that as the interview's paper trail).
- Push back plainly when he proposes something against his own rules (he offered to edit JSON; Claude declined and he accepted).
- He dislikes repeated manual steps (a key to delete every time): prefer the route that needs him once.
- Short replies; no card numbers.

## Access

- julia-next: call `add_repo` (owner `toddwyder`, repo `julia-next`, access push) before `gh api` or cloning — without it the API returns 403. GraphQL never works; use REST.
- Linear tools work (read/write docs and issues).
- Web search/fetch work. The laptop link gives a sandboxed Linux shell, not his apps, 1Password or SSH keys.
