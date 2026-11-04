# The machine runs as one Mastra workflow that Todd can watch

## Outcome
Todd opens one page and sees what the machine is doing for a card, which stage is running, finished, stopped or stalled, and what each stage cost. The build, remediation and landing stages are steps of one stock Mastra workflow run.

## What we know
- The build runs as a headless Mastra Code session. The review and landing stages run as stock Mastra workflows. A glue program joins them with its own state. A build that ended after about 27 seconds went unnoticed for 34 minutes.
- Stock Mastra holds the parts needed: workflow runs with step status, Studio, and a list of active runs by id. The earlier proof showed a stock workflow step runs the build agent and returns its answer. It also showed three gaps: the agent's spans form a separate root trace, per-run trace files carry a null thread id, and run status lives only in the stored snapshot.
- Three large reviews returned no verdict because they reached the stock default step limit for subagents. Reading the installed package points to a stock `maxSteps` setting on the subagent definition as the fix. Unverified in running form.
- A stop ping exists today. It fires on Mastra Code notification events and not on process exit. Unverified: whether a dead process leaves its run marked running.
- `createInitialThread: false` followed by `session.thread.switch({ threadId })` may replace the direct thread-table edit in `machine/remediation/builder.mjs`. Unverified in running form.
- The pstack upgrade is on main. Unverified: main CI and the Linear card for it.

## Acceptance criteria
- Todd opens one page and sees the most recent card runs, each with a status of running, succeeded, failed or stalled.
- Todd opens a run and sees build, remediation and landing as its steps, each with status, start time and end time.
- A run started after the page went live appears on the page within one minute.
- A card started through the machine's entry point runs as one parent workflow with build, remediation and landing as its steps.
- The parent workflow requires the card identity as input, and every step records it.
- A run whose build exits early shows a failed step and pings Todd within one minute.
- A run whose process disappears shows as stalled within the machine's idle limit and pings Todd.
- A stopped run pings Todd one time, shown by a formal model made with the repository's formal-verification skill.
- A review of a change that needs more than the stock default number of model steps ends with a verdict.
- A test fails when the reviewer's definition lacks an explicit step limit.
- A finished run shows tokens, cost and elapsed time for each stage.
- Cost reads as a dollar amount for priced models and as "free model" for free models.
- Every agent record of a run belongs to that run's trace tree and carries the thread identifier.
- The scorecard of a finished card is produced from its run alone and passes the pull request check.
- A session with model activity and an empty trace shows a flag on the page.
- The installed Mastra and pstack match their published versions, apart from the retry patch.
- The deviations list has a row for the retry patch with its reason and the condition for removing it.
- The wanted thread is selected on boot by the stock thread switch, shown by a test. When the test shows the stock switch fails, the direct edit stays and the deviations list names it.
- The repository has one machine entry point, one run page and one store for runs.
- The checklist viewer and the stop-comment stopgap are gone.
- The upstream request to Mastra about the retry behavior and the per-call timeout setting exists, and its link appears in the deviations list.
- The server runbook and the harness doc describe the one workflow.
- After every landed slice, a card started through the entry point finishes with a merged pull request, a green main and a completed Linear card.
- A findings note on main answers each unverified item above with the evidence that settled it.
- The card carries a morning summary in plain English: slices finished, slices parked with the cause and what each needs from Todd, and the cost per slice.

## Overnight run
Todd starts the card and goes to sleep. The run goes as far as it can.
- pstack decides the slices, their order and which run side by side. A slice with no unfinished dependency starts as soon as it is planned.
- A slice that stops leaves independent slices running. A dependent slice waits, and the run records the slice it waits for and why.
- A slice that needs an edit to installed Mastra or pstack files beyond the retry patch records the edit and the reason as its result, and the run moves on. Todd decides in the morning whether it becomes a second listed exception.
- A slice that needs an account-owner approval posts it as one atomic step and parks until it arrives.
- A failed live check after a landing slice rolls the slice back and parks it.
- A slice that removes machinery lands in the same pull request as its replacement.
- Each slice's pull request names only its own card.

## Outside check
The Shipping reviewer posts a verdict on every slice's pull request. After the last slice, a fresh agent session reads only the runbook, starts a small card and finds its run on the page.
