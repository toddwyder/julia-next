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

Mastra Code opens its trace store once, at startup, and DuckDB lets one process write a file. A
session that starts while another holds `observability.duckdb` gets no tracing at all, silently, for
its whole life (`@mastra/code-sdk/dist/index.js:323`), so its tokens and cost are never recorded and
the card priced from it reads unknown. Pstack runs sessions in parallel, so this happened on the
first slice of 30 October and nothing said so.

The launcher at `~/.local/bin/mastracode` (`scripts/mastracode`, installed by
`node scripts/install-launcher.mjs`) is the one place every session starts from. It gives the launch
its own file under `~/.local/share/mastracode/traces/<utc stamp>-<pid>.duckdb` through
`MASTRA_OBSERVABILITY_DB_PATH`, so parallel sessions never share a lock, and before starting it folds
whatever earlier sessions left behind. `JULIA_TRACES_DIR` moves the directory; `MASTRA_APP_DATA_DIR`
moves it with the rest of the data.

```sh
node scripts/trace-store.mjs status
node scripts/trace-store.mjs fold [--quiet]
```

`fold` copies each finished file's `metric_events` rows, the per-call tokens and cost a scorecard
prices from, into `traces/archive.duckdb`, then deletes the file. `archive.duckdb` holds cost rows
and nothing else: no prompt payloads, no spans. A file a running session still holds cannot be
attached, so it is skipped and its PID reported. Folding the same file name twice replaces its rows
instead of adding a second copy, so an interrupted fold is safe to re-run; a file left as
`<name>.folding` is picked up by the next fold. The single store the launcher replaced,
`~/.local/share/mastracode/observability.duckdb`, is folded and deleted the same way, so the 5.6 GB
it occupies leaves the disk on the first launch after this ships.

Deleting a file is what returns the disk. A delete inside a file gives nothing back even after a
`CHECKPOINT`: on 30 October 52,443 rows were deleted and checkpointed and the file was 5,955,137,536
B before and after, with 99.9% of it freed blocks the next writes would reuse.

Nothing has to be remembered: no session id, no card, no timer, no list. The scorecard prices a
card from every file in that directory, the archive included, and the archive is only as big as
the cost rows.

`fold` prints one JSON answer and exits 0. When the traces directory is over 15 GB after a fold it
prints a loud warning and exits 1: at that size a round was too big and Todd needs to know.

DuckDB's default memory limit is 85% of the machine, which on this 7 GB server is 6 GB, and on
30 October the kernel killed a run at 6.15 GB before it deleted a row. `fold` opens each file with a
budget of a third of the machine, at most 2 GB, spilling to a temp directory beside it. It reads one
small table per file, so a 5.6 GB file folds in seconds.

`status` asks the filesystem and opens nothing, so it answers while a session holds a file. It
prints the directory, every file with its size, which files a fold would take, the total, the free
space, and whether that total is over the 15 GB alarm.

Reading a trace file by hand takes the client out of the repo, because it is a dev dependency here
and the installed program also carries one:

```sh
node -e "const {createRequire}=require('node:module');const r=createRequire('/home/ubuntu/julia-mastra/package.json');const {DuckDBInstance}=r('@duckdb/node-api');..."
```

Four facts that cost failed runs on 30 October: `connection.runAndReadAll(sql).getRowsJS()` returns rows as arrays, not objects (`getRowObjectsJson` does not exist on the reader); values come back as `BigInt`, so `Number()` them before arithmetic; `duckdb_tables().estimated_size` is a row count, not bytes, so measure payloads with `sum(length(cast(column as varchar)))`; and `octet_length` is not implemented for `VARCHAR` here, so cast first. A connection holds a file's lock until it is closed, so close the connection and then the instance.

## GitHub boundaries

Use ordinary signed-in GitHub access for authorized cards. Keep authentication material inside its trusted process. Evidence and notes belong on the card branch and pull request.
