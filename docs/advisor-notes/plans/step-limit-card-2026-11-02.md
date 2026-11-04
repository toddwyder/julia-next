# The Shipping reviewer finishes large reviews with a verdict

## Goal
When a pull request needs more than 50 model steps to review, the Shipping reviewer still ends with a verdict, so a large change is judged instead of reported as "NO VERDICT". Pull request #430 (the pstack upgrade, JUL-324) receives a verdict.

## Steps
1. Give the Shipping reviewer's subagent definition an explicit step limit through the stock `maxSteps` field, set where `machine/shipping/harness.mjs` builds the stock definitions. Use the limit the machine's own interactive runs use today, and say in the pull request where that number came from.
2. Add a test beside the other `.test.mjs` files that fails when the Shipping reviewer's definition carries no explicit step limit.
3. Ask the runner for a Shipping review of pull request #430 and read its record. The review's verdict appears as a comment on #430.

## Acceptance criteria
- The Shipping review of #430 ends with PASS, PASS+NOTES or FAIL, posted as a comment on #430.
- A test fails when the Shipping reviewer's definition is missing a step limit.
- The pull request for this card touches only the harness and its test.
- The review of #430 finishes within the machine's existing review time limit.

## Outside check
The Shipping reviewer reviews this card's own pull request and posts a verdict on it.

## Out of scope
Merging #430, the retry loops, the retry patch, the cost or trace work, and pstack.

## Pull request
Name only this card in the pull request title and description.
