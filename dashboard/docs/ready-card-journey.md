# The Ready card journey

The dashboard has two pages, joined by a Back link.

| Address | Page | Code |
| --- | --- | --- |
| `/` | Ready list | `dashboard/app/page.jsx` |
| `/start/<identifier>` | Start screen for one card | `dashboard/app/start/[card]/page.jsx` |

## The Ready list

The list reads every Julia-next card in the Ready state from Linear on each request. `dashboard/lib/linear.js` sets `cache: 'no-store'` and gives the request 10 seconds.

A card reaches the page only if it passes validation: it has an id, its identifier matches `JUL-<number>`, its title is not empty, its createdAt parses, its state is Ready, and its team is Julia-next. A duplicate Linear id, or a page cursor that loops, fails the whole read.

The list shows newest first, with the identifier as the tie-break. Each row has the identifier, the title, and one **Start \<title\>** link to `/start/<identifier>`.

- Empty: "No Ready cards. Cards will appear here when they are Ready in Linear."
- Linear unreachable or malformed: the message in a `role="alert"` paragraph, and `julia-dashboard: Ready cards failed to load:` in the server log.

The list writes nothing to Linear.

## The Start screen

The address carries the card identifier, not the Linear id. The page reads the Ready list and finds the card with that identifier, so a card that leaves Ready stops opening. The heading falls back to "Card unavailable", and the page says "This card is not in Julia-next Ready. Go Back to choose a Ready card."

Below the heading the page shows Settings (Main session, Shipping, Effort), Effort, Models and Prices. The Models section lists groups and their roles. Tapping a model name opens a picker filled from the weekly sweep. Tapping a group name opens its roles. The Prices section names the date of the sweep and lists each account with the number of models it offers.

A choice is saved to this machine as `draft.json` in the dashboard state folder, which defaults to `/var/lib/julia-dashboard/state/draft.json`. The browser sends the whole draft, so the page checks every group, role and model against `config/roles.json` and the latest sweep before it writes the file.

The screen shows a message instead of the controls in three cases.

- No sweep file, or an empty one: "No model sweep has run yet, so there are no models or prices to show. Go back to the list and open this card again after the weekly sweep."
- The sweep has no priced model, or no main session or shipping model can be chosen from it: "The sweep has saved no model with a price, so this screen has nothing to show. Go back to the list and open this card again after the next sweep."
- The sweep cannot be read: the error in a `role="alert"` paragraph.

A sweep older than eight days does not replace the controls. They show, with a status line above them: "The last sweep was on <date>. That is more than eight days ago. Run the weekly sweep to refresh these prices."

Nothing on this screen starts a build or changes the card in Linear. The only write is the draft file.

## Back

**← Back to Ready cards** is a plain link to `/`. The Ready list runs again from Linear, exactly as it does on first load.

The journey therefore leaves Linear alone. Opening a card and going Back does not remove the card from Ready, and it does not edit the card. When `DASHBOARD_URL` is set, `dashboard/tests/dashboard.spec.mjs` repeats the journey twice against real Linear and compares the list with a fresh read before and after.
