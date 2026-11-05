# The Ready card journey

The dashboard has two addresses. The Ready list at `/` shows the cards the household can start. The Start screen at `/start/<identifier>` opens one of them. Both read Linear on every request and neither changes a card.

## The Ready list at `/`

`dashboard/app/page.jsx` renders the list. It asks `listReady()` in `dashboard/lib/linear.js` for the Julia-next cards whose state is Ready, 100 at a time, newest first. Nothing is cached, so each request reads Linear again.

`listReady()` checks every card before it reaches the screen: an identifier of the form `JUL-<number>`, a non-empty title, a readable `createdAt`, the state Ready, and the team Julia-next. One card that fails the check fails the whole list with an error rather than dropping out of it unseen. A duplicate card does the same.

Each row shows the identifier, the title, and a **Start** link to `/start/<identifier>`. The page heading is "Ready cards", with the line "Choose a card to open its Start screen."

The list has four states.

- "Loading Ready cards from Linear…" while the read runs.
- One row per Ready card.
- "No Ready cards. Cards will appear here when they are Ready in Linear." when Linear returns none.
- The error, in a paragraph with `role="alert"`. A missing key reads "Linear configuration failure. LINEAR_API_KEY is missing." A Linear problem reads one of the "Linear connection failure" messages, and the detail goes to the server log under `julia-dashboard: Ready cards failed to load:`.

## The Start screen at `/start/<identifier>`

`dashboard/app/start/[card]/page.jsx` renders the screen. It reads the same Ready list and keeps the one card whose identifier matches the address, so a card that has left Ready has no Start screen. The address holds no other state, and a reload reads Linear again.

The heading shows the identifier and the card title, or "Card unavailable" when the card is gone. The screen then shows one of these.

- "This card is not in Julia-next Ready. Go Back to choose a Ready card." when the identifier is not in the Ready list.
- A read failure, in a paragraph with `role="alert"`.
- "No model sweep has run yet, so there are no models or prices to show. Go back to the list and open this card again after the weekly sweep." when `state/models.json` is missing or empty.
- "The sweep has saved no model with a price, so this screen has nothing to show. Go back to the list and open this card again after the next sweep." when no saved model has a price.
- The settings, when a sweep has saved a main session model and a shipping model.

The settings come in four parts.

**Settings** lists the main session model, the shipping model, and the effort, each with its price per million tokens.

**Effort** offers one button per level, with the chosen level marked `aria-pressed`. Each level has an information button that explains it. The line under the buttons is "How hard the models think. More brains is slower and costs more."

**Models** lists the groups from `dashboard/config/roles.json`: Building, Judgment, Investigating, Learning, Panels, and Workers. Tap a group name to open its roles. A group without a panel shows one model for the whole group, and a role that differs from its group is marked "set on its own". A panel group, which is Panels only, holds a list of models for the group and for each role, with **+ Add** and a remove button per model. The picker groups models by account and shows each price. The line under the list is "Saved on this machine. A reload, or another card, keeps this choice." The saved choice is `state/draft.json` under `DASHBOARD_STATE_DIR`, which defaults to `/var/lib/julia-dashboard`.

**Prices** shows one row per account with its model count. The line above it reads "Prices paid per million tokens. ↓ is what you are charged for what you send, ↑ for what the model writes. Read from each provider's pricing page on <date>." When the sweep is more than eight days old, a line above the settings says "The last sweep was on <date>. That is more than eight days ago. Run the weekly sweep to refresh these prices."

## Back

The link at the top of the Start screen, `← Back to Ready cards`, points at `/`. It is a plain link and a full page load. The Ready list then reads Linear again, so a card that left Ready while the screen was open is gone from the list. A change made on the Start screen is already in `state/draft.json` by then, and the next card opened on that machine starts from it.

## What stays unchanged

Neither page starts a build, moves a card, or writes to Linear. The only writes are the settings choice to `state/draft.json` on the dashboard machine.
