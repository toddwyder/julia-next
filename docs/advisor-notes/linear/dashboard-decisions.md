<!-- Snapshot of the Linear doc "Dashboard decisions" (https://linear.app/julia-next/document/dashboard-decisions-fd4decbbe469), last updated 2026-10-28T02:42:37.938Z. Linear holds the live version. -->

Decision records from the `grill-with-docs` interview during the dashboard pilot (started 27 Oct 2026), one per hard-to-reverse decision Todd makes. Moves into the repo as ADRs once the dashboard's own decision folder exists.

## 0001 The board shows only the machine's work

Todd's list said "every running agent in one view, across tools". Decided (27 Oct 2026): the board shows only cards the machine is working on, whatever models and providers it uses. All card work is meant to go through the machine; agents opened by hand (Command Code, Codex) were used only because Start wasn't built yet, and they leave no run record the dashboard could read.

## 0002 Every card belongs to a project that finishes

Complete tiles stay on the board until the card's project is Completed, then leave together (Todd, 27 Oct 2026). Each piece of Julia is its own project (recipes now, shopping list and others later), and each machine change gets its own project too, so nothing sits in a never-ending project like machine-setup or Maintenance. Rejected: a 7-day window, and Linear milestones.

## 0003 Compare any model in any role

Decision support compares models per role, not per card or per single "builder" model (Todd, 27 Oct 2026): pick any role (main session, any pstack role, the evidence reviewer) and see the models that filled it ranked by success rate, interventions and root-cause stage, with cost and tokens by role and model too. A card counts only for roles that actually ran on it. Rejected: one builder model per card (main session, or the playbook's coding role), and comparing whole lineups only.

## 0004 A card's trace is deleted when its retro is complete

The old factory's traces reached 10–15 GB per round and stopped the factory when the drive filled (Todd, 27 Oct 2026). So a card's trace is kept only until that card's retro is complete, then deleted with its dashboard link; the committed scorecard keeps the numbers. The retro is the last thing that reads the trace. Rejected: Mastra Code's 14-day pruning (fills the drive), a permanent copy (no later use), deleting at Complete (the retro still needs it).

## 0005 Mint & Iris look; the phone board is a folding list of stages

Picked by Todd from Stitch pictures (27 Oct 2026). Look: "Mint & Iris" (Stitch project "Julia dashboard pilot", desktop screen titled "Todd's Factory Board - Mint & Iris"; design system `assets/17575707340211662328`). Phone layout, Todd's own idea: stages stacked top to bottom, each folding to one line with its card count; on load only stages with a running, stuck or waiting card are open, Backlog, Ready and Complete start folded; inside an open stage each card shows its top row (title and status) and expands in place when tapped; "Needs you" stays on top. Screens: `1bf5cf3ba518483691ae0afd71855b85` (as loaded), `c4c69ed3a37d42afb18d4bf2d15d5d68` (running card open). Rejected: the other looks (fonts), columns scrolling sideways, and one column at a time by tabs (30 Backlog cards means too much scrolling).

## 0006 Decision support has three views, the map first

Todd, 27 Oct 2026, from three Stitch options: each shows a different aspect, so all three stay, behind a Map / Ranked / Cards switch with Map open by default. Map: pick a role; each model is a bubble (across = cost per card, up = success rate, size = cards run), a "cheap and reliable" zone, and a tapped bubble opens times stepped in, second-round rate and where trouble came from (requirements / design / build). Ranked: the same role's models best first with small bars. Cards: finished cards sortable by cost, time, rounds and times stepped in, filtered by role and model. A model with fewer than 10 cards is marked "too few cards to trust yet" (dashed bubble). A "Suggestion" box stays, because it may point Todd at something he didn't think of. Rejected: picking only one of the three views.

## 0007 The Start screen

Todd, 27 Oct 2026, mixed from three Stitch options. One-tap "Start with last settings" at the top, then a summary (main session, evidence reviewer, effort). "Effort" picker with brain icons, one to four (Small, Medium, Large, Unlimited); the word is effort, not budget or thinking. Models are set per group with a down-arrow that opens the group's roles: Building, Judgment, Investigating, Learning, Panels, Workers, holding pstack's 17 role lines by their real names, each with an ⓘ that explains it in plain words. $ to $$$$ shows each model's price; brains show effort, never dollars. Ping line: "Ping when it finishes: Linear notification to Todd". Start button fixed at the bottom. Rejected: every role on one long screen, and invented role names.

## 0008 What the pictures count for

Todd, 27 Oct 2026, at the end of design. Each drawn screen counts only for the part it was drawn to show; headers, icons and menus Stitch added around it (profile icon, bell, "Factory Board" header, a bottom menu with Board/Inbox/Pipelines/Insights, a second "Needs you" bar) are not built. Phone screens drawn: board (0005), Start (0007), Decision support (0006), a card's own page, "Needs you" opened, a stopped card on the board, a running card opened with its checklist (each playbook step done / working / to go / skipped with "why?", with its time; added after Todd spotted the board showed only "Step 4 of 8"). On desktop the board follows the picked desktop screen for its look and column layout only (its top bar, "lanes online", "Telemetry", "AI Co-pilot", "Dispatch Agent", "Nudge", Figma match, LIN numbers and footer are Stitch inventions); the other screens widen the phone layout and are judged on content and look, not an exact match. Written into the spec, not drawn: labels and values are never cut off; button colour carries no meaning; every action item sends a Linear notification (not shown on each row); empty, loading and failed screens; the run-record link and compactions on a running card; tokens split cached / input / output; on the running card, one line per agent with its context fill, compactions and handoffs; on the Decision support Cards view, the spread of cost per card with the 75th percentile marked, so the per-card limit can be read off; in Decision support, compactions per round, tokens split three ways and typical step times; where Todd's "Answer" to a build's question goes so the running build receives it (a technical fact for the build to settle). Rejected: drawing desktop versions of every screen. The design can be reopened by a later card.

## 0009 The dashboard includes the part that starts, watches and stops builds

The old build machine was removed from main on 26 Oct 2026; today every card is run by hand in a Mastra Code chat on the server, so nothing exists for Start or Stop to act on. Decided (Todd, 27 Oct 2026): the dashboard's requirements include that part, because the dashboard can only be proven by Todd pressing Start and watching a card run. pstack splits the work when it builds. Rejected: a separate piece of work that comes first.
