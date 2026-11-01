# Preview and smoke test

The step after Shipping, before Todd's UAT. It takes the exact commit Shipping
passed, puts it on a preview where the change needs one, runs the proofs that
fit, and records **one PASS or FAIL** that names every check and every proof.

A skipped check counts as a failure. So does a proof that could not run, because
a proof nobody ran is the same to a reader as a proof that passed.

## What it does

1. **gather** reads the card from Linear, checks the pull request out at the
   commit GitHub reports, and reads which files the change touched. If the
   pull request moved between the two reads, the run stops: CI check runs belong
   to a commit, and judging the wrong one is worse than not judging.
2. **preview** builds that exact checkout and starts a second copy of the
   dashboard at its own address, with its own records folder. Only for a change
   that touches `dashboard/`.
3. **checks** reads the pull request's check runs for that commit.
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
- Its records folder is seeded from a **copy** of the live dashboard's
  `models.json` and nothing else, so clicks in the preview never reach the live
  records. The live folder is hashed before and after the run and the record
  says whether it stayed identical.
- It starts through `scripts/julia-agents.mjs`, the same vault launcher the live
  service uses, so it gets Linear access without a key on disk. Only whether a
  key was present is ever reported, never its value.
- It binds a free port from 4400 upward on the Tailscale address, so the live
  dashboard on 4313 keeps serving `main` the whole time.
- It runs as the server's own user. Nothing is needed from Todd.

## One PASS or FAIL

The record lists every line with its result: the preview address and how long
the build took, each check, each proof, and the live records comparison. On a
FAIL the card goes back to the build with the failing lines. The second FAIL on
the same pull request stops the card and pings Todd instead of sending it back a
third time. Remediation is not involved: the fix is the builder's own next
change.

## Running it

```
node scripts/julia-agents.mjs -- node machine/preview/run.mjs --pr 412 --card JUL-308
```

Flags: `--no-post` writes the record into `.artifacts/preview/pr-<n>/` without
posting it, `--force` reruns a commit that already has a record, `--card-file
<path>` reads the card from a file instead of Linear.

The run folder holds `worktree/`, `state.db`, `record.json`, `record.md` and a
trace file per run. A crashed run leaves the record of the steps that finished,
and the failure count carries over from the previous record for that pull
request.

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
