# 0008. The smallest working route first: Todd accepts from a rehearsal copy, and extras wait

Date: 2026-09-24

Status: accepted. Partly supersedes ADR 0004 (see Consequences). The Linear parts (stuck
alerts via Linear, models chosen on a Linear Settings card) are superseded by ADR 0009.

> **Superseded in part, 2026-10-01 (ADR 0009).** Pre-merge rehearsal acceptance ("Todd follows
> the card's steps on that copy") is retired: Factory's review merges the PR and Todd tests the
> live app after merge. Kept as the historical smallest-route decision.

Julia features start once the smallest working route carries a real change. A card moves from
Ready through build, tests, and an independent review by a different model maker. The robot then
runs the builder's end-to-end test on a rehearsal copy. Todd follows the card's steps on that
copy, then says "accepted" or sends it back in one sentence. Accepted work merges and goes to
Real Julia. Every rehearsal copy uses one permanent set of test data rather than throwaway data.

Visibility is part of the smallest route, not an extra. If the graph dies it cannot report it,
so a check that runs separately from the graph watches every card in progress. When a card stops
moving, that check comments on the card and assigns it to Todd. The Linear app then notifies his
phone.

We chose Todd clicking through a rehearsal copy over watching a recording. The recording route
needed a recorder, a structural checker, and a second evidence reviewer before any feature
could ship. Vercel gives a rehearsal copy almost for free. The cost is a few minutes of Todd's
clicking per card. We chose shared test data over a fresh copy per card because only one card
is ever tested at a time. We chose starting over after a crash over resuming every step. Resume
logic already built for build and tests stays; new steps start over.

## Consequences

- ADR 0004's recording, structural evidence check, and evidence reviewer are deferred. "Todd is
  never the tester" is relaxed to guided steps on a rehearsal copy. The one-word "accepted" or
  one-sentence send-back still stands.
- Deferred until a real problem calls for one: the AI repair worker, a public webhook for
  instant starts (the graph checks the board about once a minute), cost reconciliation and the
  Monday note, per-card throwaway data, and the full fault-injection proof.
- Models are chosen in Linear, never in a file. A Settings card holds the defaults and ordered
  backup lists, and a label on a card overrides the default. On a quota wall the next backup is
  used, and the builder and reviewer never come from the same maker.
