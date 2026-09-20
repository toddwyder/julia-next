# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## `ready-for-agent` requires a passed readiness review

Since JUL-71, `ready-for-agent` is not a plain triage judgment call. Apply it to a ticket only
after a readiness review (`docs/agents/readiness-review.md`) has been posted and passed for that
ticket, either individually or as part of a batch that covered it. A ticket whose services and
decisions aren't all proven reachable or don't have a named, one-time Todd action stays
unlabeled, no matter how well-specified its description otherwise looks. This applies to every
other label in the table above unchanged -- only `ready-for-agent` carries the extra gate.

## The Ready queue no longer requires `ready-for-agent`

The label keeps its triage meaning: it still marks a ticket whose services and decisions were
proven by a readiness review. It is **no longer the queue gate**: `evaluateEligibility` in
`scripts/ready-queue.mjs` no longer consults it (`ready-for-agent` is still exported and still
means what triage means by it).

Under `evaluateEligibility`, a card in the `Ready` state is refused for any of three reasons:

- it carries the `Decision` or the `Parent` label -- both are coordinate-only, not agent work;
- it has an open blocker;
- its model choice does not validate -- `validateFamilyChoice(resolveSeatChoices(issue.labels))`
  does not return `ok: true`.

No open blockers is necessary but not sufficient: a `Decision` card at the top of Ready with no
blockers is still ineligible, and so is a card with no valid model choice. `evaluateEligibility`
is the place to look. The readiness review is the run's first step, and a review that fails parks
the card with the reason on it. (Instruction on JUL-97, 2026-09-19; the code is in
`scripts/ready-queue.mjs`.)
