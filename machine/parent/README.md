# The machine

One run for one card. It takes a card, builds it, sends the pull request through
review and remediation until Shipping passes it, and lands it. Build, review and
landing are the three stages, and each stage is the program that already owns it:
`mastracode` for the build, `machine/remediation/run.mjs` for review, and
`machine/merge/run.mjs` for landing.

```sh
node scripts/julia-agents.mjs -- node machine/run.mjs JUL-330
node scripts/julia-agents.mjs -- node machine/run.mjs JUL-330 --pr 431
```

`--pr <n>` starts at review for a pull request that already exists, and the
build is recorded as skipped. `--model <id>` passes a model to review and
landing. `--dry-run` prints the three stage commands and runs none of them.
`--help` prints the usage. Exit `0` means every stage passed, `1` means the run
stopped and the last line names the stage and the reason, `2` means the
arguments were wrong.

## What happens, in order

1. `run.mjs` makes a run id, a run folder at `.artifacts/machine/<id>`, and
   points `MASTRA_OBSERVABILITY_DB_PATH` at its own trace file and
   `MASTRA_DB_PATH` at a state database in the run folder. It writes the run
   record before the first stage starts, so the page shows the run as it begins.
2. `workflow.mjs` builds the stock Mastra workflow `machine` with three steps,
   `build`, `remediation` and `landing`.
3. `stages.mjs` runs each stage as its own process. A stage's own Mastra store
   lives in that process, so the three never fight over the observability
   database's single writer.
4. A stage that fails ends the run: the later stages stay `pending`, the record
   says `failed`, and the process exits `1`.

Every run is a new record. A rerun of the same card is a new run and the old one
stays on the page.

## Where the record lives

`/var/lib/julia-dashboard/state/machine-runs/<run-id>.json`, overridable with
`MACHINE_RUNS_DIR`. The dashboard reads that folder directly, so a run shows on
`/runs` within one minute of opening the page. One file holds the whole run:

```
{ id, card, pr, status, idleLimitMs, startedAt, updatedAt, heartbeatAt,
  endedAt, detail, steps: [{ id, status, startedAt, endedAt, detail }] }
```

A run has `status` of `running`, `succeeded` or `failed`. `stalled` is not
stored: the run writes `heartbeatAt` every thirty seconds, and a reader shows
`stalled` when a `running` record has been silent for longer than its own
`idleLimitMs` (default ten minutes, `MACHINE_IDLE_LIMIT_MIN`). A live process
beats, so a slow build reads as running and a vanished process reads as stalled,
without either side guessing at the other's timeout.

Writes are atomic: the JSON goes to a temporary file and is renamed into place,
so a reader never sees half a record.
