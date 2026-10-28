# Approved dashboard screens (27 Oct 2026)

These pictures are the approved design for the dashboard: Todd's control panel for the software factory. Todd approved them in the dashboard pilot and said the design is "done". Build the screens to match them.

- **Look:** Mint & Iris (`12`). Light, mint and iris accents, amber for "waiting on you", rose for "stuck", Public Sans. Status always has a word or icon as well as a colour.
- **Rules:** "Dashboard decisions" in Linear (Framework project), decisions 0005–0008. 0008 lists what each picture counts for and every requirement written into the spec instead of drawn.
- **Words:** "Dashboard glossary" in Linear (Framework project).
- **Phone first.** Every screen except `01` is a phone screen. Desktop versions are the phone layout, widened; the desktop board is `01`.

## How to read a picture

Each picture counts only for what it was drawn to show, listed under its "Shows" line. Stitch drew a frame around most screens; the frame is decoration, so build only what the "Shows" line names. The frame includes: a "Factory Board" or "Todd's Factory" header, logo, bell, profile icon, "Live sync", a second "Needs you" bar with "4 blocking release", and a bottom menu (Board / Inbox / Pipelines / Insights). Card names, numbers, times and LIN numbers are examples.

## How the screens connect

```
Board (02, desktop 01)
├── tap a card ............... card opens in place (03; running card with checklist 04; stopped card 05)
├── "Needs you" .............. Needs you list (06)
├── Start on a Ready card .... Start screen (08)
└── "Decision support" ....... Map (09) ⇄ Ranked (10) ⇄ Cards (11)
                                └── tap a card ... card page (07)
```

## The screens

### Board

**`01-desktop-board.jpg` — Desktop board**
- Shows: the Mint & Iris look and the eight columns left to right: Backlog, Ready, Implementation, Evidence review, Remediation, Staging/smoke test, UAT, Complete.
- Everything else on it is Stitch's invention: top bar, "lanes online", daily spend, Telemetry, AI Co-pilot, Dispatch Agent, Nudge, Figma match, footer.

**`02-phone-board-as-loaded.jpg` — Phone board, as it opens**
- Shows: stages stacked top to bottom, each folding to one line with its card count; on load, only stages holding a running, stuck or waiting card are open; inside an open stage each card shows its top row (title and status pill); "Needs you" strip on top; a "Decision support" link (0005).

**`03-phone-board-running-card-open.jpg` — Running card tapped open**
- Shows: the card expanding in place with doing now, time since last activity, time elapsed, cost so far, context fill, the agents inside, a Linear link and Stop.
- The "Step 4 of 8" bar is superseded by the checklist in `04`. The "PULSE" label is jargon; use plain words.

**`04-phone-running-card-checklist.png` — Running card with its checklist**
- Shows: the build's playbook checklist, each step done / working / to go / skipped (with "why?"), each with its time; links to the Linear issue and the run record; Stop.

**`05-phone-stopped-card.png` — Stopped card open on the board**
- Shows: the stopped card only: "Stopped" pill, why it stopped, the stage that caused it (requirements / design / build), the restart plan, cost and rounds, "Read full plan", "Open in Linear".

### Needs you

**`06-phone-needs-you.png` — "Needs you" opened**
- Shows: the six kinds of action item (card in UAT; a stopped card's restart plan; a shape awaiting "settled"; retro fixes to approve; an account approval; a running build waiting for Todd's answer), each with what it is, how long it has waited and one action button.
- The title reads "Needs you (6)". Button colours carry no meaning. Every item also sends a Linear notification; the "Linear notification sent" line on each row stays out of the build.

### Start

**`08-phone-start-screen.png` — Start screen for a Ready card**
- Shows: "Start with last settings" at the top; a summary (main session, evidence reviewer, effort); the "Effort" picker with one to four brain icons (Small, Medium, Large, Unlimited) and an ⓘ; models set per group, each group with a down-arrow that opens its roles: Building, Judgment, Investigating, Learning, Panels, Workers. The groups hold pstack's 17 role lines by their real names, each with an ⓘ that explains the role in plain words (hillclimb's shown open). "Ping when it finishes: Linear notification to Todd". Start fixed at the bottom (0007).
- $ to $$$$ is the model's price; brains are effort. Judgment's "$$$$" for GPT-6 Sol is a drawing error (the summary shows Sol as $$$).

### Decision support

**`09-phone-decision-support-map.png` — Map (the default view)**
- Shows: the Map / Ranked / Cards switch with Map selected; role chips; each model as a bubble (across = cost per card, up = success rate, size = cards run); a "cheap and reliable" zone; a model with fewer than 10 cards drawn with a dashed bubble and marked "too few cards to trust yet"; a tapped bubble's panel with times stepped in, second-round rate and where trouble came from (requirements / design / build); a "Suggestion" box (0006).
- The stray "RK" before the zone label and the overlapping Sol/Opus bubbles are drawing flaws.

**`10-phone-decision-support-ranked.png` — Ranked**
- Shows: the selected role's models, best first, with success rate, cost per card, cards run, times stepped in and second-round rate as small bars; tapping a model shows its cards (0006).
- Drawn before the switch existed: build it behind the same Map / Ranked / Cards switch as `09`, with the top banner removed.

**`11-phone-decision-support-cards.png` — Cards**
- Shows: summary numbers; Role and Model filters; finished cards sortable by Cost, Time, Rounds and Stepped in; tapping a card opens its page (`07`) (0006).
- Drawn before the switch existed: same switch as `09`. The one-line note on each card is Stitch's invention.

**`07-phone-card-page.png` — A card's own page**
- Shows: a summary (cost, Start to merge, rounds, times stepped in) and folding sections: evidence review per criterion and round, cost by role and model, time per stage, times stepped in with cause, compactions; links to Linear and the run record.
- Labels show in full.

### Look

**`12-design-system-mint-iris.png` — The Mint & Iris design system**
- Shows: the colours and fonts: mint primary #10B981, iris secondary #6366F1, amber tertiary #F59E0B, slate neutral #64748B, light mode, Public Sans for headline, body and label.
- This card is the reference. A later copy in Stitch's newer project drifted to darker shades.

## Written into the spec, not drawn

Full list in decision 0008: empty, loading and failed screens; one line per agent on the running card with context fill, compactions and handoffs; cost-per-card spread with the 75th percentile on the Cards view; compactions per round, tokens split cached / input / output, typical step times in Decision support; desktop versions of every screen except the board (phone layout, widened).
