# Preview and smoke test

The step after Shipping, before Todd's UAT. It takes the exact commit Shipping
passed, puts it on a preview where the change needs one, runs the proofs that
fit, and records **one PASS or FAIL** that names every check and every proof.

A skipped check counts as a failure. So does a proof that could not run, because
a proof nobody ran is the same to a reader as a proof that passed. A command
that exits 0 having collected nothing proves nothing either: a test suite must
print a summary with tests in it, a lane run must report every lane the checkout
declares, and skipping where a skip means the engine was missing is a failure.

## What it does

1. **gather** reads the card from Linear, checks the pull request out at the
   commit GitHub reports, and reads which files the change touched. If the
   pull request moved between the two reads, the run stops: CI check runs belong
   to a commit, and judging the wrong one is worse than not judging.
2. **preview** builds that exact checkout and starts a second copy of the
   dashboard at its own address, with its own records folder. Only for a change
   that touches `dashboard/`.
3. **checks** reads the pull request's check runs for that commit, and the jobs
   its workflow runs defined. A job that never reported is a failing line: green
   on three jobs out of four is not green.
4. **proofs** runs the commands whose exit codes it can read.
5. **settle** stops the preview copy, compares the live dashboard's records with
   the ones it hashed before the run, and posts the record.

## What a change gets

| The change touches | Preview | Proofs |
| --- | --- | --- |
| `dashboard/` | second copy on its own Tailscale port | server tests, local tests, dashboard proofs against that address |
| anything else | none, and the record says so | server tests |

The local tests run in the pull request's CI. What CI cannot run is the server
suite, so that is the proof a machine change owes. A change that touches the
dashboard is also driven, in a real browser, at its own address
(`dashboard/scripts/lanes.mjs --url`).

## The preview copy

- It builds in the pull request's own worktree, so the code it serves is the
  commit under review, and it refuses to run when the build is older than the
  checkout.
- Its records folder starts empty and is seeded from a **copy** of the live
  dashboard's `models.json` and nothing else, so clicks in the preview never
  reach the live records. Kept from the last run, those clicks make the same
  change pass once and fail twice, which is how that was found. The live folder
  is hashed before and after the run and the record says whether any record the
  machine could move changed. The live service rewrites its own watchdog, build,
  sweep and model files on timers, so those four are not blamed on the preview;
  the model file is refreshed from the account by the weekly sweep, and a good
  preview must not fail for it. Everything else is compared file by file, and a
  difference is a failing line naming the file.
- It starts through `scripts/julia-agents.mjs`, the same vault launcher the live
  service uses, so it gets Linear access without a key on disk. Only whether a
  key was present is ever reported, never its value.
- It binds a free port from 4400 upward on the Tailscale address, so the live
  dashboard on 4313 keeps serving `main` the whole time.
- It runs as the server's own user. Nothing is needed from Todd.

## One PASS or FAIL

The record lists every line with its result: the preview address and how long
the build took, each check, each proof, and the live records comparison. A proof
line carries its counts, and a proof that exits 0 without collecting a test is a
failure rather than a pass. A failed proof names the lines that failed, and the
whole output of every proof is kept under `proofs/` beside the record, because
the person reading the record was not at the terminal. On a
FAIL the card goes back to the build with the failing lines. The second FAIL on
the same pull request stops the card and pings Todd instead of sending it back a
third time. Remediation is not involved: the fix is the builder's own next
change. A run of a commit it has already judged does nothing unless it is forced,
so a stop comes from two different commits or from someone asking twice. The ping
to Todd is sent before the pull request comment, so a post that GitHub refuses
cannot swallow the one message that has to arrive.

## Running it

```
node scripts/julia-agents.mjs -- node machine/preview/run.mjs --pr 412 --card JUL-308
```

Flags: `--no-post` writes the record into `.artifacts/preview/pr-<n>/` without
posting it, `--force` reruns a commit that already has a record, `--card-file
<path>` reads the card from a file instead of Linear.

The run folder holds `worktree/`, `state.db`, `record.json`, `record.md`,
`proofs/` and a trace file per run. A crashed run leaves the record of the steps that finished,
and the failure count carries over from the previous record for that pull
request: a crash before the verdict does not wipe the first failure, so the
second one still stops the card.

## Where the pieces come from

The workflow itself comes from the installed Mastra Code program, the same way
Shipping's does, so `workflow.test.mjs` needs that program. It runs on the
server; a runner without the program reports those rounds as skipped and names
the packages that are missing. The decisions are plain functions over injected
dependencies (`steps.mjs`), so the parts that decide pass or fail are tested
everywhere.

## Practice pull requests

Proving the machine needs real pull requests with nothing at stake. Each carries
`No card: practice change for the preview machine` in its body and names no card,
so repository hygiene asks no scorecard of it. Four are needed: a dashboard
change that works, a dashboard change that is deliberately broken, a machine
change that works, and a machine change that is deliberately broken. They are
listed for cleanup under JUL-310.
