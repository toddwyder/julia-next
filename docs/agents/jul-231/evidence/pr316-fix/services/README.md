# Main service transition preparation

The current JUL-231 control and runner services remain active on the PR candidate,
as Todd instructed during this fix. The generic services are installed but disabled.
Only `julia-machine-main.timer` is enabled. Its real poll returns `awaitingMerge: 316`.

The prepared checkout is `/home/ubuntu/julia-machine-main`, a clean standalone clone
on branch `main`, tracking `origin/main`, currently at
`a451f738873d8cedcf84d43a7fa359f3d27269db`. Locked dependencies were installed for root,
`ops/build-runner` and `ops/mastra-agents/reviewer`.

After GitHub reports PR #316 merged, the observer moves this checkout to that exact
merge commit before considering later merges. It installs locked runtime dependencies,
disables and removes both old JUL-231 units, starts and enables the generic units,
and reads back their HTTP health, actual entrypoint process arguments and working
directories, main commit/upstream/clean status, and old units' `not-found` state.
The automatic readback is retained under
`/home/ubuntu/.local/state/julia-machine/deployments/<merge-commit>.json`.
No postmerge readback exists yet because the PR remains open. This is preparation,
not evidence that the service transition has happened.

`red.txt` records the missing updater on the initial CLI test. `green.txt` records
three passing integration tests over real local Git repositories. The GitHub metadata
and systemctl responses in the latter two tests are external boundary fixtures.
The tests prove direct-push exclusion, merge updates, idempotent repeat, premerge
activation refusal, exact activation squash commit despite a later merge, and retry
after a failed service restart once the checkout has already moved. They do not
substitute for the live postmerge readback.

Version-matched documentation read for this change was the installed Git 2.43.0
manual, installed gh 2.45.0 `gh api --help`, installed systemd 255
`systemd.service(5)` and `systemd.timer(5)`, installed Linux `proc_pid_cmdline(5)`
and `proc_pid_task(5)`, and installed curl 8.5.0 `curl --manual` retry documentation.
`systemd-analyze --user verify` accepted all four unit definitions.
