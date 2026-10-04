---
name: pre-plan
description: Check a card before planning against spec, stock Mastra, YAGNI, finish condition, keep constraints, and real evidence. Use before planning a card or when work keeps failing review.
---

# Pre-plan

Read one card. Run six checks, find every gap, and report them in one comment on the card. Read only: change no code, settings, cards, or servers.

Run this check repeatedly until a pass finds no gaps.

## Six checks

1. **Spec story.** Identify which user story in `docs/specs/` the card serves (cite file and story number). If none serves it, FLAG it; do not remove the card.
2. **Stock Mastra.** For each job the card requires, check how Mastra does it:
   - Read pinned versions in `ops/factory/app/package.json` (or `package-lock.json`). Fetch latest versions with `npm view <pkg> version`. Download and unpack both into a scratch folder (`npm pack <pkg>@<ver>`). Packages include `@mastra/factory`, `@mastra/core`, `@mastra/code-sdk`, and any `@mastra/*` package the card touches.
   - Cite `package@version path:line` actually opened in both pinned and latest versions, or cite a listed exception in `ops/factory/README.md`. A claim without an opened `path:line` or an exception row is a gap.
3. **YAGNI.** Identify anything proposed or implied that no requirement needs, and mark it to cut.
4. **Finish condition.** Formulate a checkable "done means..." condition that cleanly separates done from not done.
5. **Keep constraints.** List what must not change: existing invariants, preserved behavior, interfaces, and architecture boundaries.
6. **Evidence.** State the real-job proof that verifies the finish condition. Mocks, stubs, and fakes do not count.

## Output

Post one comment on the card listing gaps per check:
- Group findings by check (1 through 6). Mark passing checks as "None".
- End with two lines headed `For Todd:` summarizing the status and flagging any decision that needs him.

Done when the comment is posted. The card passes pre-plan when all six checks find zero gaps.
