# Julia Mastra reviewer

This package contains the current Julia Mastra reviewer components. The normal
review command is disabled: `runReviewer` in `src/reviewer.mjs` always refuses
execution while the minimum reviewer route remains incomplete. The skipped-by-
default, explicitly opted-in provider probe is the only current path that can
make paid provider calls.

## JUL-196 round-one delivery workflow

`src/delivery-workflow.mjs` is the offline workflow skeleton for build, checks,
independent review, up to three build/review rounds, and Todd's technical
acceptance. Its step adapters receive durable file paths rather than file
contents, so the existing builder launcher and Mastra reviewer remain the
execution boundaries. `src/delivery-step-adapters.mjs` is the narrow production
glue: it imports the existing `productionLauncher`, uses its builder role, and
sets `mastraReviewOnly` for the launcher's existing `reviewer.mjs` route. A
file-backed local libSQL database holds Mastra's pause
snapshot. `support/offline-delivery-workflow-child.mjs` is the no-provider
restart demonstration used by the tests; it makes no model call.

This round does not switch `$init` or the delivery runner to the workflow, so
it does not replace a live orchestration path yet. Consequently there is no
old orchestration source to delete in round one; deletion belongs in the same
later change that performs the route cutover, never before the offline proof.

Framework map:

| Need | Mastra feature | Official documentation |
| --- | --- | --- |
| Typed build/check/review sequence | `createStep`, `createWorkflow`, `.then()`, `.commit()`, and workflow registration | [Workflows overview](https://mastra.ai/docs/workflows/overview) |
| At most three repair rounds | `.dountil()` | [Control flow](https://mastra.ai/docs/workflows/control-flow) and [`.dountil()` reference](https://mastra.ai/reference/workflows/workflow-methods/dountil) |
| Pause for and resume from Todd's answer | step `suspend()` and `Run.resume()` | [Suspend and resume](https://mastra.ai/docs/workflows/suspend-and-resume) and [`Run.resume()` reference](https://mastra.ai/reference/workflows/run-methods/resume) |
| Survive a process restart while paused | workflow snapshots in configured storage, loaded by run ID | [Snapshots](https://mastra.ai/docs/workflows/snapshots) |
| Default local durable database | file-backed `LibSQLStore` | [libSQL storage](https://mastra.ai/integrations/databases/libsql) |
| Query the persisted snapshot row | `@libsql/client` local `createClient()` and `execute()` | [libSQL TypeScript client local-query example](https://github.com/tursodatabase/libsql-client-ts/blob/main/examples/local/index.mjs) |
| Measure the stored JSONB snapshot | SQLite `length()` on the snapshot BLOB | [SQLite core `length()` function](https://www.sqlite.org/lang_corefunc.html#length) |
| Validate step and workflow records | Zod strings, numbers, objects, enums, and optionals | [Zod schema API](https://zod.dev/api) |
| Retained reviewer test/provider dependency | `@ai-sdk/openai-compatible` | [OpenAI Compatible provider](https://ai-sdk.dev/providers/openai-compatible-providers) |

Memory evidence is the highest orchestration-process RSS observed from start or
resume through that execution window, sampled every 10 ms and carried across
the pause in the run's metrics file. It excludes idle time while suspended.

## Architecture and components

The reviewer is built on `@mastra/core` and provides:

- **Immutable candidate access:** Read-only `git diff` and `git show` tools
  pointing to the pinned candidate commit.
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

## Package scripts

`npm test` runs the package test suite. `npm run review` invokes the disabled
normal entry point and exits with its reset-incomplete refusal. The ordinary
test suite does not make provider calls; the real CommandCode probe is skipped
unless an authorized operator explicitly opts in with
`JUL223_COMMANDCODE_REAL_PROOF=1` and supplies its required credentials and
retained-evidence paths.

```powershell
npm test
```
