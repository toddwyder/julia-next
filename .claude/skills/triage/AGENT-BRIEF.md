# Writing a card

A card is the contract an agent builds from. It has two parts. A short Outcome, and at most five acceptance criteria that describe what Todd sees. Triage writes this shape, and Start refuses any other.

Run `node scripts/check-agent-brief.mjs <draft-file>` before showing Todd a draft. It refuses text copied from repository docs, criteria written as steps, implementation words, negations, and more than five criteria.

## Shape

```markdown
## Outcome

One or two sentences on the change Todd notices.

## Acceptance criteria

- What Todd sees when the card is done.
- Another thing Todd sees.
```

Those two sections are the whole card. Requirements, Contracts, Proof and Out of scope are retired. A constraint that matters to Todd, including how something must be proven, becomes a criterion.

## The Outcome

- One or two sentences. Name the change in Todd's terms.
- State the result, not the route.
- Name the surface Todd uses when the card changes one.

## The criteria

- Five at most. Every criterion earns its place.
- Each criterion describes something Todd can observe. If Todd cannot tell when it is true, rewrite it.
- Write the outcome. "The Linear card shows a verdict per criterion", not "Add a verdict field".
- Leave implementation words out. Name no files, functions, endpoints, schemas, or frameworks.
- State what happens. "The machine refuses a review from the builder's company" reads positive and stays.
- Each criterion stands alone. Its own evidence can settle it.
- Stay durable. Name types and behavior, not paths or line numbers.

## Writing the proof

Write the proof into the criterion when Todd cares about the proof itself. "A Beam practice card with an unprovable criterion fails its real review and stops the card" needs no separate proof section. For ordinary work, the observable result is the evidence.

## Example

A good card:

```markdown
## Outcome

The control page starts a saved card and shows its progress.

## Acceptance criteria

- The page lists every Ready card.
- Start begins one build for the chosen card.
```

## Bad card

```markdown
## Requirements

- Add a card list endpoint.
- Wire the Start button to the runner.

## Out of scope

- Delivery beyond initialization.
```

This fails because it has no Outcome, carries retired sections, and describes implementation steps instead of what Todd sees.
