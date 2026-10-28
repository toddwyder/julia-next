<!-- Exported from https://linear.app/julia-next/document/dashboard-glossary-323152c8cabe. Linear updated 2026-10-28T01:51:52.008Z. Exported 2026-10-28T18:30:04.157Z. -->

The dashboard's words, kept apart from Julia's `GLOSSARY.md`. Filled by the `grill-with-docs` interview during the dashboard pilot (started 27 Oct 2026). Moves into the repo once the dashboard's own glossary folder exists.

## Language

**Board**:
The inner-loop view with one column per status from Backlog to Complete and one tile per card; only cards the machine works on appear, and a running card's agents appear inside its tile.
*Avoid*: agent board, one tile per agent

**Stuck**:
A running card with no activity for 5 minutes.
*Avoid*: idle, hung

**Action item**:
A place where the machine waits for Todd: a card in UAT, a stopped card's restart plan, a shape in Backlog awaiting "settled", retro fixes awaiting approval, a one-click account approval, or a running build waiting for Todd's answer.
*Avoid*: to-do, task

**Project**:
A Linear project for one piece of work that finishes: a piece of Julia (recipes, shopping list) or one machine change. When it is Completed, its cards' Complete tiles leave the board.
*Avoid*: milestone

**Decision support**:
The outer-loop view, one tap from the board: history across cards, used between builds to improve the factory.
*Avoid*: history view, analytics

**Human intervention**:
Todd stepping into a card: a UAT send-back or a stop. Automatic rounds inside the machine (evidence review, staging, within two rounds) are not interventions.
*Avoid*: send-back (for automatic rounds)

**Success**:
A card that reaches Complete with no human intervention caused by the build. An intervention caused by requirements or design counts against that stage instead.
*Avoid*: pass rate

**Root-cause stage**:
Where an intervention's cause lies: requirements, design or build. Recorded as data by the machine's root-cause analysis; Todd can correct it when approving retro lessons.
*Avoid*: blame

**Round**:
One build attempt and its automatic checks. A send-back starts the next round; a card has at most two.
*Avoid*: retry, iteration

**Compaction**:
An agent's context being condensed so it can keep working. Mastra Code never truncates; its memory condenses older messages into notes and later rewrites the notes, and each of those counts as one compaction. Counted per agent on the board and per round, by role and model, in Decision support.
*Avoid*: summarization

**Handoff**:
A fresh chat picking up the same card. Counted per card next to compactions.
*Avoid*: restart