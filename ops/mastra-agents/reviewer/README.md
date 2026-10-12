# Julia Mastra reviewer

The Julia Mastra reviewer performs automated, read-only adversarial review of
candidate changes against approved Linear card criteria and repository coding
standards.

## Architecture and components

The reviewer is built on `@mastra/core` and provides:

- **Immutable candidate access:** Read-only Git tools (`git show`, `git diff`,
  `git log`, `git ls-tree`) pointing to the pinned candidate commit.
- **Incremental report recording:** A small-piece tool recording engine
  (`recording-engine.mjs`) allowing the model to submit individual review
  elements (`record_piece`, `replace_piece`, `remove_piece`, `show_missing`,
  `submit_report`). Each accepted piece is fsynced and atomically renamed into
  the run folder.
- **Deterministic verification:** Assembly and validation in repository code
  (`reviewer-report.mjs`), checking exact changed-file coverage
  (`requireCompleteFileReview`) and verbatim quote verification
  (`verifyEvidenceQuote`).
- **Raw response capture:** Durable capture of exact raw provider responses
  before parsing (`rawAnswerPathFor`), preserving unparsed model responses.
- **Interruption safety:** An atomic run-file writer (`run-file.mjs`) that
  maintains a technical failure sidecar during execution, ensuring progress is
  preserved if execution is interrupted before a verdict is reached.

## Runtime and execution budgets

Reviewer execution is coordinated through `createReviewerRuntime` with explicit
resource budgets defined in `src/contract.mjs`:

- **Spending ledger:** Pre-dispatch cost reservations (`review-budget.mjs`)
  evaluated against published provider rates. Execution enforces the approved
  $0.50 per-review ceiling and $1.00 cumulative card limit.
- **Timeouts and step budgets:** A configured 20-minute total timeout
  (`REVIEW_TOTAL_MS = 1200000`), a configured 15-second per-step timeout
  (`REVIEW_STEP_MS = 15000`), and a derived `maxSteps` calculation based on the
  inventory of changed files and criteria (`reviewStepBudget`).
- **Memory and disk limits:** A 2 GiB free-disk preflight check, a 768 MiB
  sampled RSS ceiling with 10 ms transient sampling, and a 128 MiB disk-growth
  budget (`resource-budget.mjs`). Budget violations record `SYSTEM_ERROR` with
  retained progress.
- **Model events journal:** One bounded provider-boundary journal
  (`model-events.json`) recording requests, raw replies, and validated token
  usage without external database dependencies.

## Running tests

Run the reviewer package test suite:

```powershell
npm test
```
