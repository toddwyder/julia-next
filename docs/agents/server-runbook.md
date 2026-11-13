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

## Starting a card in Studio

Studio's agent list includes **Lead**, the existing Flow build Agent. Its instructions are the complete repository poteto-mode skill, loaded when Studio creates the Agent. Open Lead's chat and type the task and its stop point. For a build that stops at the pull request, include "Stop when the pull request is open and up to date. Shipping runs separately."

Lead reads its model from `~/.config/julia/lead-model`, independently of the coder's pstack role. Run `node scripts/install-lead-model.mjs` once to create the initial setting. It preserves an existing file. The setting holds one `openai/<model>` value and uses Mastra Code's ChatGPT login. The Lead reads the file at each model call, so an edit reaches the next call with Studio left running. A missing setting prevents Lead from starting and names the installer command. See [the Lead build record](jul-339/build.md) for the dated model choice and acceptance checks.

Mastra prices a run from its own copy of models.dev. `julia-studio.service` turns the daily refresh on
with a drop-in (`~/.config/systemd/user/julia-studio.service.d/pricing.conf` sets
`MASTRA_AUTO_REFRESH_PRICING=true`); without it Mastra reads only the price table installed with the
program. The run record and the model picker read the same refreshed copy, so a price corrected at
models.dev reaches both at once.

The `card-path` workflow begins in Mastra Studio's run form. No script starts a card.

```sh
cd /home/ubuntu/julia-builder
node scripts/julia-agents.mjs -- npx mastra dev
```

Run it from the repository root: the CLI looks for `src/mastra/index.ts` there. The server answers on
`:4111` by default. `FLOW_DIR` is where the run's state (`state.db`) and trace (`trace.duckdb`) are
written, and it defaults to `.artifacts/flow/studio` under the repository; set it to an absolute path
to keep runs apart. The repository the build agent works in is `FLOW_REPO`, default the working
directory.

In Studio, pick the `card-path` workflow and press run. The form asks for `card` and `kind`
(`product` or `machine`) and nothing else; the workflow copies both into saved state and opens
`<FLOW_DIR>/<card>/` for that card's artifacts, verdict queues and stop report.
Because the saved state starts empty, a run started here needs no preparation.
Each card slice starts under built-in limits of $4 and 2,000,000 tokens, defined as `STUDIO_DOLLAR_CAP` and `STUDIO_TOKEN_CAP` in `src/mastra/index.ts`. Studio does not read `FLOW_DOLLAR_CAP` or `FLOW_TOKEN_CAP` from the environment.

A card that waits for Todd is answered from the command line, which reads the card out of the run's
saved snapshot:

```sh
node machine/flow/run.mjs status --dir .artifacts/flow/studio --run-id <run id>
node machine/flow/run.mjs resume --dir .artifacts/flow/studio --run-id <run id> --answer yes
node machine/flow/run.mjs cost --dir .artifacts/flow/studio
```

`docs/agents/machine-programs.md` names every program that starts a card or carries a stage, and
`node scripts/machine-programs.mjs --check` fails a pull request that changes one without updating
the list. Run `node scripts/machine-programs.mjs --write` and commit the list with the change.

`npm run check:studio` boots its own Studio server on a spare port, reads the run form back from
`/api/workflows`, and fails unless it asks for `card` and `kind` alone. It needs the project folder to
itself, so stop any Studio server already running here first; it is not a CI check because it fetches
the CLI and takes about a minute.

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

## Scratch and daily maintenance

Throwaway copies use `~/.local/state/julia-scratch` by default. Studio run state stays
in `.artifacts/flow` so a run waiting for Todd can resume after any number of days. The user tmpfiles configuration `~/.config/user-tmpfiles.d/julia-scratch.conf`
cleans entries untouched for three days. The cleaner does not cover `/tmp`; Ubuntu clears that directory at reboot. The stock
`systemd-tmpfiles-clean.timer` runs daily.
User lingering is enabled, so user timers continue without a login. Inspect them with
`systemctl --user list-timers --all` and inspect cleanup with
`journalctl --user -u systemd-tmpfiles-clean.service`. `julia-trace-fold.timer` and
`julia-disk-check.timer` also run daily. Their unit files live in `~/.config/systemd/user`.
The disk check alerts Todd on JUL-185 below 10 GB free through the Julia controller account.
Inspect its result with `journalctl --user -u julia-disk-check.service`.

### `/tmp/mc` belongs to Mastra Code and is never deleted

Mastra Code keeps its cross-process signal sockets under `/tmp/mc`, one of them the lease socket
that says which process owns a thread, and it keeps the socket of a run that is still going
(`@mastra/code-sdk/dist/utils/signals-pubsub.js:5`). The stock `/tmp` rule removes anything there
older than 30 days and the boot pass clears the directory, so on 13 November a cleanup that deleted
`/tmp/mc` aborted every run in progress: the lease lookup failed, and the memory step reported it as
`Processor "observational-memory" stopped the run: Agent execution was aborted`, which is not what
it looked like. `/etc/tmpfiles.d/mastracode.conf` excludes the folder from every cleanup rule; the
repository holds that file as `scripts/server/mastracode-tmpfiles.conf` and installing it is the one
step needed on a new server:

```sh
sudo install -D -m 0644 scripts/server/mastracode-tmpfiles.conf /etc/tmpfiles.d/mastracode.conf
```

`systemd-tmpfiles --cat-config | grep tmp/mc` shows the exclusion is in force. No cleanup script of
ours may remove `/tmp/mc` either: an idle folder is safe, a running session's folder is not, and
telling them apart means finding its sockets in use.

## Mastra Code's trace store

Mastra Code opens its trace store once, at startup, and DuckDB lets one process write a file. The
stock install keeps one store, `~/.local/share/mastracode/observability.duckdb`, and a session that
starts while another holds it gets no tracing at all, silently, for its whole life
(`@mastra/code-sdk/dist/index.js:323`), so its tokens and cost are never recorded and the card priced
from it reads unknown. Run one traced session at a time; a session started while another is open is
the one that loses its rows. `MASTRA_APP_DATA_DIR` moves the store with the rest of the data.

The daily `julia-trace-fold.timer` runs `node scripts/trace-store.mjs fold`, which copies the store's
cost rows into `~/.local/share/mastracode/traces/archive.duckdb` and deletes the store, so the next
session recreates an empty one. A script that needs the program's own packages asks
`scripts/mastra-program.mjs`, which resolves the global npm install from `npm root -g` unless
`MASTRACODE_PROGRAM_DIR` or `MASTRACODE_PROGRAM` names another copy; `npm install -g mastracode` is
how the program gets there and how it updates itself.

A session started outside the stock CLI, or one that runs while another session holds the store,
records nothing. Nothing on the machine notices that, so the card says it.

```sh
node scripts/trace-store.mjs status
node scripts/trace-store.mjs fold [--quiet]
```

`fold` copies each finished file's `metric_events` rows, the per-call tokens and cost, into `traces/archive.duckdb`, then deletes the file. `archive.duckdb` holds cost rows
and nothing else: no prompt payloads, no spans. A file a running session still holds is skipped and
its PID reported, because that session holds it for writing. A finished file is only ever attached
`READ_ONLY`: attaching one for writing and detaching it checkpointed the file, and on 2 November that
rewrote a 14.2 GiB trace to 18.1 GiB, filled the disk and failed. Folding the same file name twice
replaces its rows instead of adding a second copy, so an interrupted fold is safe to re-run; a file
left as `<name>.folding` is picked up by the next fold. One file that cannot be folded is recorded in
`traces/left-behind.json` with its reason and the run carries on with the rest: on 2 November one
trace stopped every fold behind it for two days, so the traces of 31 October to 2 November all waited
on the one that had failed. `status` lists what is still left behind and why.

The store is folded and deleted the same way; on 30 October
5,955,137,536 B became a 3,158,016 B archive holding 44,408 cost rows.

Deleting a file is what returns the disk. A delete inside a file gives nothing back even after a
`CHECKPOINT`: on 30 October 52,443 rows were deleted and checkpointed and the file was 5,955,137,536
B before and after, with 99.9% of it freed blocks the next writes would reuse.

The daily timer folds finished traces without a session id or card. The archive is only as big as
the cost rows.

`fold` prints one JSON answer and exits 0. When the traces directory is over 15 GB after a fold it
prints a loud warning and exits 1, and it also exits 1 when it left a trace behind: at either size a
round was too big or half done, and Todd needs to know. Inspect `journalctl --user -u julia-trace-fold.service` for the daily fold result.

DuckDB's default memory limit is 85% of the machine, which on this 7 GB server is 6 GB, and on
30 October the kernel killed a run at 6.15 GB before it deleted a row. `fold` opens each file with a
budget of a third of the machine, at most 2 GB, spilling to a temp directory beside it. It reads one
small table per file, so a 5.6 GB file folds in seconds.

`status` asks the filesystem and opens nothing, so it answers while a session holds a file. It
prints the directory, every file with its size, which files a fold would take, the total, the free
space, and whether that total is over the 15 GB alarm.

Reading a trace file by hand needs a DuckDB client from somewhere that has one installed, because the
repo root does not. The dashboard's dependencies carry one, and so does the installed program:

```sh
node -e "const {createRequire}=require('node:module');const r=createRequire('/home/ubuntu/julia-dashboard/dashboard/package.json');const {DuckDBInstance}=r('@duckdb/node-api');..."
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
