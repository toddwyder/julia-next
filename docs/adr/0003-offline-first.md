# 0003. Offline-first: everything on every device, later change wins

Date: 2026-09-15

Every device holds the whole household collection and works fully offline, reads and writes.
Only features that reach outside the house (URL import, the Chrome clipper, the Lab's
suggestions, sharing, first sign-in) need a connection. Changes sync silently when the
connection returns; there is no conflict screen and no prompt.

Conflicts resolve by **later change wins, per line** (per ingredient line, per step, per list
item), never per whole recipe. Deleting beats editing. The shopping list, the one place two
people really work at once, adds: every added item is kept, checked stays checked, removing
an item beats editing it.

Julia has **no photos**. It's vintage, and the reference recipe page has none. That is what
makes "all of it on every device" cheap: the per-device copy is text only.

We chose this over read-only offline (you can't add "milk" at the store), over keep-both-
versions (adds a screen and a chore), and over ask-on-reconnect (stops you at the wrong
moment). For a household of two, a true clash is rare and the lost edit is small.

## Consequences

- No offline banner or marker. A button that needs the internet says so when tapped.
- The technical foundation (ADR to follow) must make full replication and per-line
  last-write-wins cheap.
- The recipe model has no photo field.

Decided in [Offline: what must work with no internet, and what can wait?](https://linear.app/julia-next/issue/JUL-8).
