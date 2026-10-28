# Approved dashboard screens (27 Oct 2026)

Todd approved these in the dashboard pilot and said the design is "done". Look: Mint & Iris. Rules for reading them: "Dashboard decisions" in Linear (Framework project), decisions 0005–0008. Words: "Dashboard glossary".

**Each picture counts only for what it was drawn to show (decision 0008).** Stitch added a frame to most screens: a "Factory Board" or "Todd's Factory" header, logo, bell, profile icon, "Live sync", a second "Needs you" bar with "4 blocking release", and a bottom menu (Board / Inbox / Pipelines / Insights). None of that is built. Card names, numbers and times are examples.

| File | Screen | Counts for |
| --- | --- | --- |
| `01-desktop-board.jpg` | Desktop board | The look and the eight-column layout only. Everything else on it is invented (top bar, "lanes online", daily spend, Telemetry, AI Co-pilot, Dispatch Agent, Nudge, Figma match, LIN numbers, footer). |
| `02-phone-board-as-loaded.jpg` | Phone board, as it opens | Folding stages with card counts; only stages with a running, stuck or waiting card open; "Needs you" on top; a "Decision support" link (0005). |
| `03-phone-board-running-card-open.jpg` | Phone board, running card tapped open | Card expands in place; doing now, time since activity, elapsed, cost, context, agents inside, Linear link, Stop. Its "Step 4 of 8" bar is replaced by the checklist in `04`. "PULSE" is jargon. |
| `04-phone-running-card-checklist.png` | Running card with its checklist | Each playbook step done / working / to go / skipped with "why?", each with its time; Linear issue and Run record links; Stop. |
| `05-phone-stopped-card.png` | Board with a stopped card open | The stopped card only: "Stopped" pill, why it stopped, cause stage, restart plan, cost and rounds, "Read full plan", "Open in Linear". |
| `06-phone-needs-you.png` | "Needs you" opened | The six kinds of action item, each with what it is, how long it waited and one action button. Title should read "Needs you (6)". Button colours carry no meaning. "Linear notification sent" on every row is not shown in the build (every item sends one). |
| `07-phone-card-page.png` | A card's own page (from Decision support) | Summary (cost, Start to merge, rounds, times stepped in) and folding sections: evidence review per criterion and round, cost by role and model, time per stage, times stepped in with cause, compactions; Linear and run-record links. Labels must not be cut off. |

## Not in this folder

- **Start screen** (decision 0007) and **Decision support, Map / Ranked / Cards** (decision 0006). They are in Todd's Stitch "App" project; export them from there.
- Things written into the spec instead of drawn (full list in decision 0008): empty, loading and failed screens; one line per agent on the running card with context fill, compactions and handoffs; cost-per-card spread with the 75th percentile on the Cards view; compactions per round, tokens split cached / input / output, typical step times in Decision support; desktop versions of every screen except the board (phone layout, widened).
