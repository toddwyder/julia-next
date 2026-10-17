---
name: pre-plan
description: Shape a card before triage and confirm it after. Find unknowns, sort scope into keep, split or drop, and check the card can honestly be built. Use before any build card moves to Ready, or when work keeps failing.
---

# Pre-plan

Pre-plan keeps cards small and buildable. It runs twice per card: **Shape** on the draft brief before triage, and **Confirm** on the card after triage. In both it only subtracts, answers, or fills blanks. It never adds a requirement or an acceptance criterion. Every line of the card must trace to the brief's one-sentence outcome.

Use the vocabulary of the `codebase-design` skill exactly: module, interface, seam, adapter. Do not substitute component, service, API or boundary.

Change no code, settings or servers.

## Shape (before triage)

Input: the draft brief and its one-sentence outcome.

1. **Find the unknowns.** List every existing module and adapter the brief depends on, and every new module or seam it introduces. An unknown is one of two kinds:
   - **Fact unknown:** an existing module or adapter whose interface you can't cite. The interface includes its rules, ordering, error behavior, configuration and performance, not just its types. It is known only if you can cite a precedent in this repo (a path, found by searching the concept, not the brief's wording) or a primary source you opened (`package@version path:line`, or an official doc URL). No citation means unknown, however sure the brief sounds.
   - **Design unknown:** a new module, a new seam, or a state model nobody has built here. Sketch it twice, from two different model families: types and signatures with `not implemented` bodies. Wide disagreement means unknown. Anything that outlives the process (restart, recovery, duplicate-safety) is a design unknown until a sketch or prototype shows its rules.
2. **Answer the unknowns.** Write the question that settles each one. A fact unknown goes to the `research` skill, run in the background without asking. A design unknown about a state model or logic goes to the `prototype` skill: throwaway code, and only its verdict survives. Fold each verdict into the brief as one plain statement. Do not paste research or prototypes into the card.
3. **Sort the scope.** Give every line of the brief one outcome:
   - **Keep:** one real drive can't show the outcome without it, or something the brief names needs it. Record why, so no later reviewer reopens it.
   - **Split:** real work that this outcome doesn't need. Add one line to the Parking lot document in Linear: the date, why it came up, and optionally a "revisit at" milestone. Do not create a card.
   - **Drop:** nothing needs it now or later. Rejected enhancements go to `.out-of-scope` as triage describes.
   Apply the sort without waiting; Todd can reverse any of it. Then test the size: one card is one proof story. If proving what's left takes more than one real drive, split it into cards.

Output: the trimmed brief, the unknowns with their verdicts, and the splits and drops. End with two lines headed `For Todd:` giving the status and any decision that is truly his (product scope, not design).

## Confirm (after triage)

Run these on the card. Each finding is a blank to fill or a question. Fill a blank only inside an existing criterion, such as naming the entry point, naming a failure outcome, or linking the companion card. A finding that needs a new criterion is a split or a question for Todd, never an addition.

1. **Built the Mastra way.** Each job cites the stock feature in the installed packages (`package@version path:line`). A job with no citation is custom: list it with the reason. Flag any difference from the official docs and starter layout. Put citations in a separate Framework Map comment, not in the card.
2. **Contracts.** Draw a Mermaid diagram with a box per part and an arrow per handoff, labelled with its contract. A contract is the type-level part of an interface: one Zod schema, defined once and shared by provider and users. The interface also carries rules the schema can't, such as ordering, error behavior and restart behavior. Each offering and using part names a real check of its own side, covering those rules too. A changed contract lists every other user whose check must rerun.
3. **Finish conditions.** Each is a checkable outcome, not a process step. If removing it leaves the requirement complete, cut it.
4. **Real proof.** Each finish condition has a proof. A test counts only if it was seen failing before the change and passing after, and the reviewer reran it. It runs against the real thing, except a rule living entirely inside one module, which a unit test covering every case may prove. Mocks, stubs and fakes never count across a seam. Recipe cards use `verify-julia` and machine cards use `verify-machine`. If the feature isn't mapped, extending the skill with `maintain-verification-skill` is part of the card.
5. **Nothing that stops the run.** The card tells the agent to stop only for a spend or time cap, a failed production check, two rounds without closing (with the step-back prepared), or an account, money or product decision. Every tool, file and service it relies on exists, and the card says where.

Post one comment: findings by check ("None" if clear), the diagram, and the blanks filled. Confirm runs once, plus one rerun if it found blanks. The card moves to Ready only when Todd says "settled".
