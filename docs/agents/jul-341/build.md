# JUL-341 build

## Goal

Build the locked Apothecary library and recipe pages on the preview so Todd and Claude can critique them on desktop and phone. Stop with the pull request current. Shipping is a separate step.

## Feature checklist

- [x] 1. `how` over the affected subsystem.
- [x] 2. `architect` for parallel design exploration.
- [x] 3. Write the throughput checkpoint as four todo items.
- [x] 4. Delegate code-writing to a subagent using your configured feature model with a specific scope.
- [ ] 5. Verify on the matching surface.
- [ ] 6. Rebase into small, ordered commits. Stack follow-ups.
- [ ] 7. If the design is contested, `interrogate` before shipping.
- [ ] 8. Run **Opening a PR**.

## Throughput checkpoint

- [x] **Blocking first steps.** Read the complete card, its empty comment thread, Todd's dated plan and both settled briefs. Move the card to Implementation. Inspect the locked sketches before code. Select a shared display model before implementation.
- [x] **Independent workstreams.** Compare two read-only architecture sketches in parallel. Implementation has one owner because both pages share their display model and navigation. Browser checks and finish review follow the integrated build.
- [x] **Shared mutable state.** Design workers write separate reports. Only the implementation owner edits application files. Synthetic recipes never enter Firestore or the browser migration queue.
- [x] **Smallest safe decomposition.** One product change in one pull request. No storage migration, real-recipe step linking, individual ingredient pictures, or Shipping work.

## Review boundaries

The builder verifies behavior and requests Impeccable's finish review. It does not issue Shipping verdicts, request UAT, merge, or deploy production. No new household product choices are needed because the card and locked briefs settle them.
