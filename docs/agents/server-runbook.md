# Julia server runbook

Linear holds cards and requirements. GitHub holds code, pull requests, and CI. Mastra Factory is retired; do not use it as a server route.

## Authority

Todd's latest card decision controls server changes. Ask Todd only for an indispensable account action, spending beyond the card cap, or a household product decision.

Do not restore `julia-agent`, the old learning helper, the retired build service, the former root control deployment, or the old machine kept at tag `old-machine-final`. Do not repeat the completed one-time vault bootstrap.

## Agent commands

Run commands that need Julia credentials through this wrapper from the repository root:

```sh
node scripts/julia-agents.mjs -- <command> [args...]
```

The wrapper reads `/home/ubuntu/.config/julia-agents/service-account-token`, clears inherited 1Password authentication overrides, and invokes `op run --env-file=scripts/julia-agents.env`. Never print credentials, OAuth links or codes, pairing material, or raw credential-bearing subprocess output.

## The dashboard service

The dashboard runs here as `julia-dashboard.service` from `/home/ubuntu/julia-dashboard`, a
worktree of `main` and never the operator checkout. Its settings are in `/etc/julia-dashboard.env`
(`root:root` 0600, no secret), its state that must outlive a checkout reset is in
`/var/lib/julia-dashboard`, and two timers keep it current (update every 5 minutes) and watch it
(health every minute).

```sh
systemctl status julia-dashboard
systemctl restart julia-dashboard
journalctl -u julia-dashboard -n 100 --no-pager
sudo node dashboard/scripts/install-service.mjs --host 100.119.112.9
```

Install from the checkout the units should copy from. The installer refuses to run off this server
or from the operator checkout or a lane worktree, and running it twice is safe. When the watchdog
gives up three probes in a row it tells Todd through JUL-276 rather than creating a service issue.
Read `dashboard/docs/service.md` for the unit list, the run-file format, and what each log line
means.

## Merging a dashboard pull request

Merging is the whole step: `gh pr merge <number> --squash --delete-branch`. Nothing on the server
needs a hand afterwards.

The unit follows `origin/main`, and the updater moves the deploy checkout onto `origin/main`
itself before it installs, builds and restarts. That includes a squash merge, where the new
`main` commit is not a descendant of the branch tip the checkout was serving: the updater detaches
onto the ref instead of comparing ancestry, so there is no fast-forward to arrange and no ref to
put back. A branch ref given to the installer is used for one sync run and is never written to
`/etc/julia-dashboard.env`.

Within five minutes the update timer runs; `cat /var/lib/julia-dashboard/state/build.json` then
names the merge commit and `/api/health` reports `ok`. The update service writes `code: idle` when
it is free to update, and `code: active-run` with the run it waited for when a build is in flight,
in which case the next timer run does the work.

## Mastra Code's trace store

Mastra Code writes every span and token metric to `~/.local/share/mastracode/observability.duckdb`.
By 29 October it reached 22.6 GB, and full prompt payloads in `span_events` were most of it.
`scripts/trace-store.mjs` mines the numbers out of a session, and its `sweep` is the one command
that deletes payloads and compacts the file.

```sh
node scripts/trace-store.mjs status
node scripts/trace-store.mjs ledger
node scripts/trace-store.mjs mine <thread>
node scripts/trace-store.mjs sweep --dry-run
node scripts/trace-store.mjs sweep --wait-for-lock --minutes 180
```

`mine` writes that session's tokens, cost per model, which model each call asked for and which
answered, time per stage, tool-call counts and stops into `~/.local/state/julia/trace-costs.json`,
which is the file `scripts/scorecard.mjs` reads when it cannot copy the store. The store does not
record compactions or handoffs, and `mine` says so in `notHeld` rather than inventing them. A
session's card comes from the census doc and nowhere else: there is no flag that tells a session
which card it was on, and a card left in the ledger by an older run is dropped the next time the
session is mined.

`sweep` reads every session in `~/.local/share/mastracode/mastra.db`, mines each one, then deletes a
session's `span_events` and `log_events` rows only when the session has been mined, is not held, and
either its own card has a `docs/retros/<card>.md` and is listed as Complete in the census doc, or it
names no card at all and is approved there. Every fact comes from `docs/retros/census-2026-10-29.md`
(`--census` overrides): the `Cards with a session` table, the `Complete cards with no session` list,
the `Approved to delete without a retro` bullets and the `Held back on purpose` bullets. A hold
outranks a retro and a Complete card; an approval never stands in for a card the session itself
named; a card passed on the command line never opens the gate, and `sweep` has no `--complete` flag
because the census doc is the only place a Complete card is read from. `--dry-run` mines, prints the
plan and posts nothing. A real run posts its numbers and the reason each session was kept on
JUL-276. Mining copies that session's cost rows into the ledger before anything is deleted, so the scorecard still
prices the card once its payloads are gone. `metric_events`, which carry the cost, are never deleted.

A running session holds DuckDB's exclusive lock, so every command exits 0 with `status: busy` and a
PID instead of failing, and `--wait-for-lock --minutes N` polls until the lock frees. Compaction
refuses to start when it would not fit in the free space. Sizes before and after land in
`~/.local/state/julia/trace-store-report.json`; read that file rather than guessing whether the
store is under control.

The store is opened with a memory budget of a third of the machine, at most 2 GB, spilling to a temp
directory beside it. DuckDB's own default is 85% of memory, which on this 7 GB server is 6 GB, and on
30 October the kernel killed a sweep at 6.15 GB the moment it started writing. For the same reason
one open serves every session a sweep cleans: an open per session cost 3.1 GB of caches across 42 of
them.

## GitHub boundaries

Use ordinary signed-in GitHub access for authorized cards. Keep authentication material inside its trusted process. Evidence and notes belong on the card branch and pull request.
