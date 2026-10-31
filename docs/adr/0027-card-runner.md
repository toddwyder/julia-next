# 0027. One command runs a card from build to Complete, and stops only for Todd

Date: 2026-10-30

Status: Proposed (JUL-292, JUL-293)

## Context

[path-forward.md](../plans/path-forward.md) describes a card as build, independent PASS, preview,
whole-suite regression on the preview, UAT, merge, live check, Complete, retro. Until now a person
carried the card between those steps: a chat started each session, someone read the verdict, someone
started the preview, someone merged. Every hand-off was a place to lose a card, and two of them (the
verdict and the preview) were the two JUL-252 found going missing.

The dashboard already owns the machine's records: run files under `<state>/state/runs/`, the board
reading Ready cards, the sweep over models, the update timer. Nothing wrote a run file. This adds the
writer, as `dashboard/scripts/run-card.mjs`, beside the readers.

## Decision

`node dashboard/scripts/run-card.mjs start <CARD>` runs the card. Every step writes a record and its
own log, and every session's prompt is written next to it.

| Step | What it does | Where the truth lives |
| --- | --- | --- |
| `build` | Fresh Mastra Code session in the card's own checkout on the card's branch, at the Start screen's Main session model and effort. It commits, pushes and opens the pull request. Session ends, nothing of it is reused. | the pull request |
| `shipping` | A second fresh session that never sees the builder's chat, on the Shipping slot (Kimi K3.1 Pro, deliberately not the builder's company and never Claude). One PASS/FAIL per acceptance criterion with evidence from the running app. It writes the per-criterion Linear comments and the fenced `juliaShippingVerdict` comment. | the verdict comment, via `scripts/check-shipping-verdict.mjs` |
| `remediation` | Only after a FAIL. Session with the Bug fix playbook and Shipping's reasons; then Shipping runs again from scratch. A second FAIL stops the card, and before it stops it runs one more fresh session on the Investigation playbook, which posts the cause in the work and the cause in the process on the card and fixes neither. A reminder is raised on the card and the review notes stay. The count is the card's life, not one process, so a run picked up after a FAIL is already on its second judge. | the card's comments |
| `preview` | A change touching `dashboard/**` gets a second dashboard copy on the first free port from 4314 up, with a state folder of its own, so live 4313 keeps serving main and a card waiting in UAT does not hold the port the next card needs. That folder starts clean and holds only the live models sweep, because a folder left from the last run hands the next one a screen someone has already clicked. Any other change gets the pull request's own Vercel deployment, polled until it answers for the head commit. | the address, recorded in the run file |
| `smoke` | The whole regression suite at that address, plus the Start-address probe for the page Todd is sent. A failure runs one build session with the failing lines verbatim, a fresh judge on the head that build pushes, and the suite again on a new preview; a second failure stops the card. | the step log |
| `uat` | Comment on the card with the address and the card's own UAT steps, an issue reminder so it reaches him, the card moved to UAT, the run `waiting`. | the card |
| `merge` | After his yes. Refuses unless a PASS covers the head about to merge; if the code moved, Shipping runs again first. `gh pr merge --squash --delete-branch`. | the merge commit |
| `live` | The live copy must serve the merge commit before anything else happens: the dashboard from `state/build.json`, the cookbook from its own `/api/health`. Then the whole suite at the live address. A failure stops the run and tells him; nothing rolls back by itself, because [path-forward.md](../plans/path-forward.md) leaves that to a person. | the live address |
| `complete` | Comment with the merge commit and the cost from the card's scorecard, card moved to Complete. | the card |
| `retro` | One session, one pull request on `retro/<card>`, carrying the retro and the refreshed scorecard. With `/correct` where the card hit Remediation, a stop, a rubber stamp or a correction from him. Unmerged: he reads it. | the retro pull request |

A run that is `waiting` holds the answer itself: the process polls the card every minute for up to
72 hours, so his yes continues the same run. `tick` is the recovery path for a run whose process is
gone (a reboot, a killed session): it answers every waiting card once, then exits.

Only a reply posted after the hand-off counts, and only if it starts with `yes` or `no`, so the
machine cannot read its own comments as his answer. A card moved to Complete counts as a yes; a card
moved anywhere else counts as a no and the run stops with his words on it.

`stop <CARD>` marks a run stopped on purpose, which is what a killed process needs before the card
can be started again. `--from <step>` picks a card up at a step, so an already-built card is not
rebuilt to prove the rest of the path. `remediation` is one of those steps: a card whose judge
already said FAIL is remediated without paying the judge to repeat itself, and a run that starts
anywhere after remediation trusts the verdict the judge left on the pull request.

The verdict comment, not the session's closing text, is what the judge is read from. A session that
posts its verdict and then breaks is a broken session; a session that ends with no verdict on the
current head has judged nothing.

## What stays a person's job

- Starting the run. Nothing on a timer starts builds; `tick` only answers waiting cards.
- Reading the retro pull request.
- The rollback of a live failure.
- Anything the session says it cannot do, which is now reported as a broken session rather than as a
  failed card: a headless session has nobody to approve a file outside its checkout, so the runner
  reads a suspended turn as an error and never as a verdict.

## Consequences

- A card's cost on its own card comes from `scripts/scorecard.mjs`. A headless session writes no
  token metric rows (measured: a `--output jsonl` session left its trace file with none), so the
  run prices each session from the log that session wrote: every model step logs its own
  `usage_update`, cache read included, and that survives a runner that dies or a last line that
  never finished. The scorecard prices those rows and stops listing a session the run has priced as
  a cost that goes missing. `run-card spend <CARD>` rebuilds the same numbers from the logs on disk,
  which is the repair for a record whose session lines were lost.
- The dashboard shows a machine run in the shape it already knows (`starting`, `running`, `waiting`,
  `finished`, `failed`, `stopped`) without a reader change, because the record keeps the fields
  `/api/health` and the update gate read.
- A `waiting` run is not an active build, so the update timer may still move main while a card waits
  for him.
