# Writing a card

A card is the contract an agent builds from. It has three parts: a short Outcome, the acceptance criteria that describe what Todd sees, and the UAT steps Todd will follow. There is no limit on how many; pstack slices a large card when it plans the build. Triage writes this shape.

Run `node scripts/check-agent-brief.mjs <draft-file>` before showing Todd a draft. It refuses text copied from repository docs, criteria written as steps, implementation words and negations.

## Shape

```markdown
## Outcome

One or two sentences on the change Todd notices.

## Acceptance criteria

- What Todd sees when the card is done.
- Another thing Todd sees.

## UAT steps

1. Open this. You see that.
2. Tap this. You see that.
```

Those three sections are the whole card. Requirements, Contracts, Proof and Out of scope are retired. A constraint that matters to Todd, including how something must be proven, becomes a criterion.

## The Outcome

- One or two sentences. Name the change in Todd's terms.
- State the result, not the route.
- Name the surface Todd uses when the card changes one.

## The criteria

- Every criterion earns its place. A card needs as many as it takes to leave nothing for the builder to guess.
- Each criterion describes something Todd can observe. If Todd cannot tell when it is true, rewrite it.
- Write the outcome. "The Linear card shows a verdict per criterion", not "Add a verdict field".
- Leave implementation words out. Name no files, functions, endpoints, schemas, or frameworks.
- State what happens. "The machine refuses a review from the builder's company" reads positive and stays.
- Each criterion stands alone. Its own evidence can settle it.
- Stay durable. Name types and behavior, not paths or line numbers.

## The UAT steps

- Numbered, in the order Todd does them, each one action and what he sees.
- Only what a household member does: open, tap, type, read. Todd gets the preview address at UAT, so a step says "Open the preview".
- Cover every criterion Todd can try. A card that changes nothing Todd uses has no UAT steps section.
- Settle them with Todd at "settled": the builder and Prove It Works aim at exactly these.

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

## UAT steps

1. Open the preview. You see every Ready card.
2. Tap Start on one card. Its build begins.
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
