export const completeCardDescription = `## Outcome

One outcome.

## Requirements

One requirement.

## Contracts

One contract.

## Acceptance criteria

One acceptance criterion.

## Proof

One proof.
`

export const legacyFinishConditionsCardDescription = completeCardDescription
  .replace('## Acceptance criteria', '## Finish conditions')
  .replace('One acceptance criterion.', 'One finish condition.')
