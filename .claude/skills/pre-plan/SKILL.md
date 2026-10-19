---
name: pre-plan
description: Shape a brief, triage it into cards, confirm each card, and check launcher admission in one flow. Use before any build card moves to Ready, or when work keeps failing.
---

# Pre-plan

Pre-plan keeps cards small and buildable. One invocation runs **Shape**, **Triage**, **Confirm**, and **Admission** in that order, then gives Todd one consolidated settlement summary. It only subtracts, answers, or fills blanks. It never adds a requirement or an acceptance criterion. Every line of every card must trace to the brief's one-sentence outcome.

Use the vocabulary of the `codebase-design` skill exactly: module, interface, seam, adapter. Do not substitute component, service, API or boundary.

Change no code, settings or servers. Do not move a card to Ready before Todd settles it and its admission check passes.

## 1. Shape

Input: the draft brief and its one-sentence outcome.

1. **Find the unknowns.** List every existing module and adapter the brief depends on, and every new module or seam it introduces. An unknown is one of two kinds:
   - **Fact unknown:** an existing module or adapter whose interface you can't cite. The interface includes its rules, ordering, error behavior, configuration and performance, not just its types. It is known only if you can cite a precedent in this repo (a path, found by searching the concept, not the brief's wording) or a primary source you opened (`package@version path:line`, or an official doc URL). No citation means unknown, however sure the brief sounds.
   - **Design unknown:** a new module, a new seam, or a state model nobody has built here. Sketch it twice, from two different model families: types and signatures with `not implemented` bodies. Wide disagreement means unknown. Anything that outlives the process (restart, recovery, duplicate-safety) is a design unknown until a sketch or prototype shows its rules.
2. **Map the tools before choosing an approach.** For every third-party tool a card touches, open its full official, version-matched documentation index and list every feature relevant to the job, with a link to the official page for each feature. Do this research with cheap sub-agents, one per tool or settling question. Each sub-agent returns only a short answer and the official links. Do not choose an approach until all of those feature lists are complete.
3. **Model the words.** Run Pocock's installed `domain-modeling` skill on the key words in the card. A word defined by a third-party tool takes its meaning from that tool's official documentation. A word owned by Julia takes its meaning from `GLOSSARY.md`. Define every remaining undefined word before the card moves on.
4. **Answer the unknowns.** Write the question that settles each one. A fact unknown goes to the `research` skill, run in the background without asking. A design unknown about a state model or logic goes to the `prototype` skill: throwaway code, and only its verdict survives. Fold each verdict into the brief as one plain statement. Do not paste research or prototypes into the card.
5. **Sort the scope.** Give every line of the brief one outcome:
   - **Keep:** one real drive can't show the outcome without it, or something the brief names needs it. Record why, so no later reviewer reopens it.
   - **Split:** real work that this outcome doesn't need. Add one line to the Parking lot document in Linear: the date, why it came up, and optionally a "revisit at" milestone. Do not create a card.
   - **Drop:** nothing needs it now or later. Rejected enhancements go to `.out-of-scope` as triage describes.
   Apply the sort without waiting; Todd can reverse any of it. Then test the size: one card is one proof story. If proving what's left takes more than one real drive, split it into cards.

Output: the trimmed brief, the unknowns with their verdicts, and the splits and drops. Carry this output directly into Triage; do not stop with a separate `For Todd` summary.

## 2. Triage

Explicitly invoke Pocock's installed `triage` skill with the complete Shape output and have it write the cards. Its `disable-model-invocation` setting prevents automatic selection, not this required wrapped invocation. Pre-plan wraps triage; do not restate, copy, or modify triage's rules here. For new cards, the Shape output is the detailed triage brief required by the standing issue-work rule: return it to Todd for approval before triage creates anything, then resume this same pre-plan invocation after approval. Ask triage to turn each approved brief into the tracker card and agent brief even though its ordinary specific-item path starts from an existing item. Do not invent identifiers or dependency links before creation. Once triage has written the cards, continue immediately to Confirm.

## 3. Confirm and Admission

Run these on the card. Each finding is a blank to fill or a question. Fill a blank only inside an existing criterion, such as naming the entry point, naming a failure outcome, or linking the companion card. A finding that needs a new criterion is a split or a question for Todd, never an addition. Write every filled blank and Todd's answers into the card text itself, inside the existing criteria; never leave operative content only in a comment. Add this exact line to each card's text: `Read the Framework Map comment before building.`

1. **Built the Mastra way.** Each job cites the stock feature in the installed packages (`package@version path:line`). A job with no citation is custom: list it with the reason. Flag any difference from the official docs and starter layout. Put citations in a separate Framework Map comment, not in the card.
2. **Contracts.** Draw a Mermaid diagram with a box per part and an arrow per handoff, labelled with its contract. A contract is the type-level part of an interface: one Zod schema, defined once and shared by provider and users. The interface also carries rules the schema can't, such as ordering, error behavior and restart behavior. Each offering and using part names a real check of its own side, covering those rules too. A changed contract lists every other user whose check must rerun.
3. **Citations.** Open every cited link and check that it says what the card or Framework Map claims. A card that names a tool's private files instead of an official interface does not go to Ready.
4. **Acceptance criteria.** Each is a checkable outcome, not a process step. If removing it leaves the requirement complete, cut it. Each acceptance criterion lists every case Proof must cover. The reviewer checks the Evidence against that list; any missing case means the card is not done.
5. **Real Proof.** Each acceptance criterion has Proof. A test counts only if it was seen failing before the change and passing after, and the reviewer reran it. It runs against the real thing, except a rule living entirely inside one module, which a unit test covering every case may prove. Mocks, stubs and fakes never count across a seam. Recipe cards use `verify-julia` and machine cards use `verify-machine`. If the feature isn't mapped, extending the skill with `maintain-verification-skill` is part of the card.
6. **Mockups.** Give every mockup element a numbered callout. Each card lists the callout numbers it delivers. Confirm that every callout number belongs to exactly one card. The reviewer and Proof check the delivered result by callout number.
7. **Nothing that stops the run.** The card tells the agent to stop only for a spend or time cap, a failed production check, two rounds without closing (with the step-back prepared), or an account, money or product decision. Every tool, file and service it relies on exists, and the card says where.

Post one Confirm comment per card as a record of what changed in the card text, including the filled blanks and Todd's answers ("None" if nothing changed). The separate Framework Map comment remains the citation record. Confirm runs once, plus one rerun if it found blanks.

After Confirm, run the launcher's admission contract against every card from the repository root:

```powershell
.\scripts\julia-vault-windows.ps1 -SecretNames LINEAR_API_KEY -RunArguments @('node', '--experimental-strip-types', 'ops/mastra-agents/reviewer/src/mastra/card-admission-check.ts', 'JUL-nnn')
```

The script reads the current Linear card and checks its description as a prospective Ready card with the launcher's existing `CardAdmissionSchema` in `ops/mastra-agents/reviewer/src/mastra/contracts.ts`; it does not duplicate the admission rules or change the card's state. Run all cards from the triage in one command when there is more than one. Record each result in the final summary. If a card fails, fill only blanks within its existing criteria and rerun once. If passing would require a new requirement, a new criterion, or a product decision, or if the rerun still fails for any reason, report the exact question for Todd. A failing card never moves to Ready.

## 4. For Todd

End with one `For Todd:` summary covering every card. For each card give the Confirm result, admission result, any blanks filled, and any question Todd must settle. Ask Todd to say `settled` only for cards he accepts. When Todd replies, resume this same pre-plan invocation, move only the settled cards with passing admission results to Ready, and report the transitions. Never move a card before Todd says `settled`.
