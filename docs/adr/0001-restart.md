# 0001. Restart Julia from scratch

Date: 2026-09-15

## Decision

Restart Julia from scratch in this repo (`toddwyder/julia-next`). The prior codebase
(`toddwyder/Julia`) is frozen: no new work there.

## Why

- Broken foundation: sign-in, the save path, and data ownership were never solid.
- A backlog that had largely rotted — items no longer matched the code or the current shape
  of the problem.
- Repeated remediation rounds found more problems than they fixed, without closing the gap.
- The verification machinery was bypassed rather than fixed, which meant Todd stayed pulled
  into relay and QA work instead of the agents verifying their own output.

## What is different this time

Every session reads this before writing code:

1. **Pocock's front part runs before any code.** Wayfinding, grilling, spec, and tickets
   (`wayfinder`, `grilling`, `implement-spec`, `to-tickets` and friends from
   `mattpocock/skills`) come first for any nontrivial piece of work — not code first, process
   retrofitted after.
2. **Orca on the OVH server is the only route for work**, enforced before any code exists in
   this repo. No ad hoc local pushes standing in for the real delivery path.
3. **Observability (Sentry, Axiom) and the new architecture are in from the first line**, not
   bolted on after something breaks in production.
4. **Small, complete user journeys, each accepted by Todd on evidence.** Todd is never the
   tester, the log reader, or the troubleshooter — an agent brings verified evidence, not a
   claim to be checked by hand.
5. **No legacy backlog inherited.** If a behavior from the old app is still required, it goes
   back through the new spec process, not copied over as a ticket.
6. **Metrics from the first step**: context use, tokens/quota, attempts per item, working vs.
   idle time, and Todd-interruptions are tracked from day one, not added retroactively once
   something looks slow.

## Required behavior (v1)

- Recipe import: URL and pasted text
- Web clipper (Chrome extension)
- Recipe viewing
- Manual entry
- Editing and deletion
- Menu planning
- Shopping lists and pantry staples, including add-to-shopping-list by voice
- Kitchen prep
- Full-screen cooking mode
- Co-cook sync
- Sign-in and sessions
- Offline / PWA
- Vintage interface

## Out of scope (v2)

- Cookbook import
- The Lab

## Data

The safety export of production Firestore data (recipes, menus, shopping, pantry, users) from
the old app is kept, read-only, outside of any git repository. Web recipes are to be
re-scraped into the new app as they're needed; there is no bulk migration of the old data into
`julia-next`.
