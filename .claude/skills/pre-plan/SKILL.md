---
name: pre-plan
description: Check a build card before Ready — trim it to the minimum, draw its contracts, and confirm it can honestly be built. Use before any build card moves to Ready, or when work keeps failing.
---

# Pre-plan

Read one card. Run six checks, then post one comment on the card with the findings, a proposed
trimmed card, and a Mermaid diagram. Change no code, settings or servers. Don't edit the card
itself: Todd approves the trimmed version, and the card moves to Ready only when he says "settled".

Rerun until a pass finds no gaps.

## Six checks

1. **Trim (YAGNI).** Propose a version of the card with only what is needed to meet its stated
   outcome. Cut anything nothing requires today: features, options, settings, "for later" items.
   Mark every line you would cut and why. Add nothing.
2. **Built the Mastra way.**
   - For each job, find the stock feature in the installed Mastra packages
     (`ops/mastra-agents/reviewer/package.json` and its lockfile). Cite the
     `package@version path:line` you opened. A job with no citation is custom: list it with the reason.
   - Compare how the card would build it against Mastra's official docs and starter template
     (language, typed workflow steps, step schemas). Flag any difference.
3. **Contracts.** Draw a Mermaid diagram: a box for each part the card touches, one arrow per
   handoff, each arrow labelled with the contract it uses. A part used by several others has one
   contract, shown once with all its users.
   - Every contract is a Zod schema (which also gives the TypeScript type), defined once and shared
     by the provider and every user. Flag any contract the card touches that isn't.
   - For every contract the card's parts offer or use, the card names a real check of its own side.
     Offering: the part keeps the whole contract for every user. Using: the part relies only on what
     the contract promises.
   - If the card changes a contract, it lists every other user whose check must rerun.
4. **Finish conditions.** Each is a checkable outcome, not a process step. Test each: if it were
   removed, would the requirement still be complete? If yes, cut it.
5. **Real proof.** The proof for each finish condition. A test counts only if it was seen failing
   before the change and passing after, and the reviewer reran it. It must run against the real
   thing, except that a rule living entirely inside one part may be proven by a unit test covering
   every case. Mocks, stubs and fakes never count for anything that crosses a boundary.
   - Recipe cards: proof uses `verify-julia`, extended for this feature with `maintain-verification-skill`.
   - Machine cards: proof uses `verify-machine`, extended the same way.
6. **Nothing that stops the run.** The card tells the agent to stop only for a spend or time cap, a
   failed production check, two rounds without closing (with the step-back prepared), or an
   account, money or product decision. Every tool, file and service the card relies on exists, and
   the card says where.

## Output

One comment on the card: findings grouped by check ("None" if it passes), the proposed trimmed
card, the diagram, then two lines headed `For Todd:` with the status and any decision he needs to make.

Done when the comment is posted. The card is ready for Todd when all six checks find no gaps.
