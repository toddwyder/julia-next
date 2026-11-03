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

The wrapper reads `/home/ubuntu/.config/julia-agents/service-account-token`, clears inherited 1Password authentication overrides, and invokes `op run --env-file=scripts/julia-agents.env`. It then runs the command through `scripts/linear-token.mjs`, which trades the "Julia controller" app's client pair for a Linear access token at the start of every run and passes it as `LINEAR_API_KEY` in the form `Bearer <token>`, so no long-lived Linear key sits on the machine. Never print credentials, OAuth links or codes, pairing material, or raw credential-bearing subprocess output.

## Running a card

One program runs a card: `machine/run.mjs`. Start it on the server from the repository root, through
the wrapper, because the stages comment on Linear:

```sh
node scripts/julia-agents.mjs -- node machine/run.mjs JUL-<n>
node scripts/julia-agents.mjs -- node machine/run.mjs JUL-<n> --pr <n>
```

`--pr <n>` starts at review for a pull request that already exists and records the build as skipped.
`--model <id>` passes a review model to the review loop. `--dry-run` prints the three stage commands
and runs none of them, and `--help` prints the usage. Exit `0` means every stage passed, `1` means
the run stopped and the last line names the stage and the reason, and `2` means the arguments were
wrong.

The run is one stock Mastra workflow, id `machine`, with three steps in a row. Each step runs the
program that already owns that stage, as a process of its own:

1. `build` runs `mastracode -p <kickoff prompt>`, which builds the card and opens its pull request.
2. `remediation` runs `machine/remediation/run.mjs` on that pull request: the Shipping review, a
   FAIL handed back to the builder, and the next review, until it passes or stops.
3. `landing` runs `machine/merge/run.mjs`, which merges the pull request and finishes the card.

A stage that fails ends the run there: the later stages stay `pending`, the record says `failed`,
and the process exits `1`. A rerun of the same card is a new run and the old one stays on the page.

### Where a run keeps its files

The run record is a single JSON file, `/var/lib/julia-dashboard/state/machine-runs/<run-id>.json`,
overridable with `MACHINE_RUNS_DIR`. The run id is the UTC start stamp and the card, so it sorts by
start time and reads in a URL. The machine is the only writer, and every write is a temporary file
renamed into place, so a reader never sees half a record. The record carries the run's own idle
limit (default ten minutes, `MACHINE_IDLE_LIMIT_MIN`), a `heartbeatAt` the process beats every thirty
seconds, one step per stage with its times, detail and cost, and `pingedAt` once Todd has been told.

Each stage's trace files go under the checkout the machine ran from, in
`.artifacts/machine/<run-id>/traces/<stage>/`, beside that run's state database at
`.artifacts/machine/<run-id>/state.db`. Every stage is given its own `JULIA_TRACES_DIR` and never
inherits the parent's `MASTRA_OBSERVABILITY_DB_PATH`: the parent holds that file open, and a second
writer to it records nothing at all. Once a stage exits, the parent reads its trace files and writes
the tokens, cost and elapsed time into that stage's step.

### What the dashboard shows

The dashboard reads that folder directly, so `/runs` lists every run newest first with its status
and `/runs/<id>` is the one run page: each stage's status, start, end, elapsed time, tokens and cost,
what happened to it, and the run's own total. A stage that succeeded but left no model rows in its
trace file is called out on the page rather than shown as free, because free and unrecorded are not
the same thing. A run that has already been announced says `Todd was told once` with the time.

### The watcher

`machine/watch.mjs` compares each running run's last heartbeat against that run's own idle limit. A
run past its limit is marked stalled in the record and Todd is told once; the mark is written before
the comment is sent, and a run that carries a ping is skipped, so a second pass never repeats the
message. `dashboard/ops/julia-machine-watch.service` and `.timer` run one pass every minute, and
`node dashboard/scripts/install-service.mjs` installs them along with the dashboard units.
`node machine/watch.mjs --dry-run` prints what a pass would mark and says, and changes nothing.

Nothing marks a stalled run on the page except time: `/runs` and `/runs/<id>` show `stalled` for a
`running` record that has been silent longer than its own idle limit, which is why a slow build
reads as running and a vanished process reads as stalled without either side guessing at the other's
timeout.

### What Todd sees

A stage that fails is news within the minute: the parent saw the stage's exit, so it finishes the
record as failed and comments on the card itself, naming the stage, what happened, the run id, and
that nothing more will happen until the card is started again. A run that goes quiet is the
watcher's job, and its comment says the process behind the run is gone and that this is the message
for it. Both comments point at the run page, and a comment Linear refuses is a line on the console
and not a reason to take anything down.

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
moves it with the rest of the data. `mastracode` on PATH is now the launcher rather than the
program, so a script that needs the program's own packages reads `MASTRACODE_PROGRAM_DIR` or
`~/.local/lib/mastracode-program`, never the command's neighbours.

A session started any other way, by a Mastra Code update that replaces the launcher or by a command
that skips it, records nothing and leaves no file of its own. Nothing on the machine notices that, so
the card says it. A session that started after the launcher was installed and left no cost rows makes
the scorecard print `- Cost incomplete:` with the reason. `scripts/check-branch-pr.mjs` passes that
branch's pull request and prints the reason, because those sessions have no rows to price; a cost
that is unknown, zero or missing still refuses it. The launcher's install time is the cutover, so a
run from before it is history and not a loss.

```sh
node scripts/trace-store.mjs status
node scripts/trace-store.mjs fold [--quiet]
```

`fold` copies each finished file's `metric_events` rows, the per-call tokens and cost a scorecard
prices from, into `traces/archive.duckdb`, then deletes the file. `archive.duckdb` holds cost rows
and nothing else: no prompt payloads, no spans. A file a running session still holds is skipped and
its PID reported, because that session holds it for writing. A finished file is only ever attached
`READ_ONLY`: attaching one for writing and detaching it checkpointed the file, and on 2 November that
rewrote a 14.2 GiB trace to 18.1 GiB, filled the disk and failed. Folding the same file name twice
replaces its rows instead of adding a second copy, so an interrupted fold is safe to re-run; a file
left as `<name>.folding` is picked up by the next fold. One file that cannot be folded is recorded in
`traces/left-behind.json` with its reason and the run carries on with the rest: on 2 November one
trace stopped every fold behind it for two days, so the traces of 31 October to 2 November all waited
on the one that had failed. `status` lists what is still left behind and why, and the scorecard of a
card whose threads such a file answers says its cost may be short, until a later fold clears it.

The single store the launcher replaced,
`~/.local/share/mastracode/observability.duckdb`, is folded and deleted the same way; that happened
on 30 October, 5,955,137,536 B into a 3,158,016 B archive holding 44,408 cost rows.

Deleting a file is what returns the disk. A delete inside a file gives nothing back even after a
`CHECKPOINT`: on 30 October 52,443 rows were deleted and checkpointed and the file was 5,955,137,536
B before and after, with 99.9% of it freed blocks the next writes would reuse.

Nothing has to be remembered: no session id, no card, no timer, no list. The scorecard prices a
card from every file in that directory, the archive included, and the archive is only as big as
the cost rows.

`fold` prints one JSON answer and exits 0. When the traces directory is over 15 GB after a fold it
prints a loud warning and exits 1, and it also exits 1 when it left a trace behind: at either size a
round was too big or half done, and Todd needs to know. The launcher runs it with `--quiet`, which
prints only those notes and goes to stderr, so a failed cleanup is said out loud in the session's own
output instead of vanishing.

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

## The runner's own GitHub identity

The runner is a GitHub App named **Julia Runner**, slug `julia-runner`, id `5561742`, installed on `julia-next` only. Its credentials came from GitHub's manifest flow on 1 November 2026 and sit in `/home/ubuntu/.config/julia-runner` at 0600 in a 0700 directory.

- `app.json` holds the app id, client id and client secret.
- `private-key.pem` holds the App's private key.
- `installation.json` holds installation `177375308`.
- `setup-status.json` holds the four steps of the setup run.

GitHub granted it checks write, statuses write, pull requests write, contents write and metadata read. Anything it opens is authored `julia-runner[bot]`: pull request 399 was the first, on `runner/identity-proof`.

To act as the runner, sign an RS256 JWT with `private-key.pem` (issuer is the app id, expiry within ten minutes), trade it for an installation token at `POST /app/installations/177375308/access_tokens`, and call the API with that token. A personal token cannot do this: `POST /check-runs` answers 403 for one.

The page that created the App was a one-off script, never a service. It ran on 1 November 2026, wrote these four files and stopped; nothing on the server starts it, and its code lived only in the closed pull request 398.
