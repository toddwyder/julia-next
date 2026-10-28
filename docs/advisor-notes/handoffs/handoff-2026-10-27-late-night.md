# Handoff, 27 Oct 2026, ~23:00 PT (advisor, acting as requirements + design agent in the dashboard pilot)

## What we are doing
Taking the dashboard through the front door by hand. After design was approved, Todd rejected a thin five-part shape. His process now: (a) user stories from all documents, each traced to a source; (b) one screen at a time, number every control on the picture and say what it is, where it comes from and which story it serves; (c) review the controls together; (d) close the screen's gaps one at a time; (e) reverse check that every source item is linked; (f) one spec per screen (seven; Codex writes them from per-screen source maps). Procedure written down: Linear Framework doc "Reconciling requirements to screens (pilot procedure, 27 Oct 2026)". After all seven screens: **suggest a better way to do this next time** (Todd's words), and the procedure doc has a "Next" section for it.

**Todd's rule: never start the next screen without his permission. Ask first.**

## Where everything is
- Repo branch `docs/dashboard-walkthroughs` (open PR, not merged; ask Todd before merging): `docs/advisor-notes/walkthroughs/` has the three pages, data JSON, README. Handoffs in `docs/advisor-notes/handoffs/`.
- Published pages (artifacts): Start https://claude.ai/artifact/5dMf3M6P8b2YGvfzMEdtQv ; Board https://claude.ai/artifact/7dnbrDVM1V4qGuJJ7S5taN ; Running card https://claude.ai/artifact/CwysXmXGKLRWPDJijTuGxS .
- Linear (Framework): "Requirements process: the front door" (3a6c5f9a-686e-4c3c-bf4e-8fd9c5d0acf1), "Dashboard decisions" (f83207ce-e7f2-4e35-9fb2-a141cd39fbc3), "Dashboard glossary" (3aeefb45-e2b8-4f98-8674-ee2a88a3cab9), the procedure doc. Dashboard project: issue JUL-275 (thin shape, to be replaced or become the overview) and "Approved design (27 Oct 2026)".
- Approved pictures: `docs/pilot/dashboard-d2/approved/` on branch `pilot/dashboard-d2` (draft PR #365); copies in the scratchpad were lost with the session, so read them from there.

## Status by screen
- **Start (08):** done and reviewed by Todd. 24 controls; gaps closed by decisions 0011–0016.
- **Board (02):** done. 19 controls, G1–G8 closed: Decision support link top right on its own line with the plain title "Factory"; row opens its item's action, "Needs you" title opens the list; strip shows up to three rows, same colour, then "See all (n)"; a stage lists most recently moved first, five at a time, "Show more" (start there, change if it doesn't work); open Ready card shows Start; no pill on cards not running (pills: Running, Stuck, Waiting on you, Stopped); Stuck pulses (pill, icon and the stage line, folded or open; reduced-motion setting gives a static bolder rose header), Waiting on you is a steady amber mark; every tapped card shows title, status, Linear link; Ready adds Start, UAT adds a link to try it, Complete adds a link to its card page.
- **Running card (04):** controls reviewed? Todd read the page and asked about statuses; the two open questions are closed (back arrow not built, card expands in place, same title row folds it; context and compactions come from the runner). Gaps G1 and G2 closed. **G3 to G8 not yet taken** (proposals are on the page): G3 "Doing now" = the working checklist step plus time since last activity (was being asked when we stopped); G4 per-agent lines with fill, compactions, handoffs per card; G5 Stuck and Waiting on you states on the card (Waiting shows the question and an Answer box); G6 "why?" opens the reason under the step; G7 Stop neutral colour plus a confirm "Stop this build? The work is kept."; G8 step names: playbook's own text, plain-word label where jargon.
- **Stopped card (05), Needs you (06), Decision support (09, 10, 11), card page (07):** not started. Todd named the running card as most needed because Start can only be proven by watching a card run.

## Decisions made tonight (already recorded in Linear "Dashboard decisions" as 0017 and 0018)
- 0017 Board: the gap answers above.
- 0018 Running card and runner: the card expands in place (no back arrow, no header); the statuses are now only Exists, Build must make it work, Open question, Drawn by Stitch not built (the amber "exists for hand-run cards" status is gone, because the dashboard's own Start is built first and hand-run cards will not be shown); the runner that starts, watches and stops builds is a **Mastra workflow** and also monitors each agent's context fill and compactions; the per-card limit **asks Todd** when passed (notification plus a Needs you item, keep going or stop; the build keeps running until he answers; money never stops a card by itself): seventh kind of Needs you item next to picture 06's six. Limit's value is set later from real cards (about the 75th percentile, plus a check for repeating without progress); until then no limit.

## Stories, rules, build work (current)
59 stories (S-57 time per stage across cards, S-58 which kinds of criteria keep failing, S-59 asked when over the limit, added tonight), 14 rules (R-12 several cards at once, R-13 Decision support covers all cards, R-14 out of scope), 13 build items (B-13 per-card limit). The reverse traceability check is done (it found 7 unlinked items, all added); repeat it per screen as stories change.

## Open items
- Take running-card gaps G3–G8; then ask Todd which screen next (suggested order: stopped card, Needs you, Decision support, card page).
- Update Needs you's six kinds to seven (glossary "Action item", S-32, picture 06 note).
- Per-screen specs (seven), made after all screens; one in Backlog each in the Dashboard project; JUL-275 becomes overview or is replaced (decision 0010). Codex writes them from source maps.
- Save final stories/rules/build items to Linear for Codex; decide where rules and build work live.
- Add pilot findings for later steps to the front-door doc (ask Todd): to-spec in full; one spec per screen; stories/rules/build split; thin-spec failure; check-agent-brief heading; the reconciliation procedure; "ask before the next screen".
- Brief-checker question: five-criteria limit vs screen specs with more than five conditions (unresolved).
- Close draft PR #365 and delete its branch only after the pictures are on the Linear issue or in main's ui folder; staging un-deferral is separate front-door work (B-12).
- Open build facts F-01…F-07 (see `walkthroughs/data/stories-original-and-comments.md`).

## Working style Todd has asked for
Plain words, not numbers and letters as if he knew them; one question at a time with a proposed answer; post notes in full, nothing summarised; every piece of work started and proven on a screen (exceptions only with his approval).
