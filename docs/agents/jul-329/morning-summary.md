# JUL-329, the morning after

Written 3 November 2026. The card was one page showing what the machine is doing per card,
with build, remediation and landing as steps of one workflow. It was too big for one session,
so it was sliced into three sub-issues. This is what each one has, what is still open, and what
it cost.

## Slice 1, JUL-330, one workflow and one page of runs

Finished. `machine/run.mjs` starts a card as one stock Mastra workflow with the steps build,
remediation and landing. Each run writes one record to `/var/lib/julia-dashboard/state/machine-runs/`,
and the dashboard lists the runs at `/runs` and shows one at `/runs/<id>`. The old entry point
`scripts/start-machine.mjs` is deleted, so there is one way to start the machine.

The card is at Evidence review. Its pull request is #433.

## Slice 2, JUL-331, the page says when a run stalls or dies, once

Built in the same pull request. A run writes a heartbeat every thirty seconds, and a reader
calls a run stalled when the heartbeat is older than the run's own idle limit. `machine/watch.mjs`
runs from a systemd timer once a minute, marks the run, and tells Todd once; the record carries
`pingedAt` so a second pass says nothing. `formal/machine/Machine.tla`, checked by TLC, proves
that promise and catches both ways of breaking it.

## Slice 3, JUL-332, the run alone produces the record, the scorecard and the docs

Partly finished, and this is the part that changes what Todd sees.

- Each stage now has its own trace folder. The parent reads what the stage spent after it exits,
  so the run page shows elapsed time, tokens in and out, and the cost of every stage. Free models
  read "free model"; an unpriced paid model reads "cost unknown" rather than claiming to be free.
- A stage that succeeded and left no model rows is flagged on the record and on the page. A stage
  that failed before its first model call is not, because that is normal.
- Agent records now sit in the stage's own trace tree. A spike proved it: one trace holding the
  workflow run, the step, the agent run and the model call nested under each other.
- The runbook and the harness doc describe the one workflow instead of the old tools.

What is still open in this slice: the scorecard is not yet built from the run alone, and a fresh
subagent's model rows carry no thread id, because the stock controller starts a non-forked subagent
with no thread at all. The run's join key is the stage's trace file and its span ids, and the reason
is written in the decision log rather than hidden.

## What waits on Todd

Nothing yet. The fix round for the Shipping determination is on the pull request, and the runner
checks it again. The card moves to UAT only when a living person has driven the pages, and that is
the next thing that needs him.

## Cost per slice

The card's scorecard is the record, at `docs/scorecards/JUL-329.md`. At this morning's run it stood
at **$0.48** at published API prices, with one session that recorded no trace rows and so has no
price; the scorecard says so on its `Cost incomplete` line. The cost is not split per slice, because
one session carried all three and the scorecard prices a session, not a paragraph of one.
