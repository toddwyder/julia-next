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
Nothing used to watch it, and by 29 October it reached 22.6 GB: full prompt payloads in
`span_events` are most of it. `scripts/trace-store.mjs` caps it.

```sh
node scripts/trace-store.mjs status
node scripts/trace-store.mjs ledger
node scripts/trace-store.mjs prune --keep-days 14 --dry-run
sudo node scripts/install-trace-store.mjs   # writes ops/julia-trace-store.{service,timer}
```

`julia-trace-store.timer` runs the prune nightly at 04:40 from the deploy checkout. The prune keeps
`metric_events`, which carries the cost, exports it to `~/.local/state/julia/trace-costs.json`
before deleting anything, removes spans and logs older than the cutoff, then compacts the file.
A running session holds DuckDB's exclusive lock, so the prune exits 0 with `status: busy` and a
PID instead of failing, and `--wait-for-lock` makes it poll until the store is free. Sizes before
and after land in `~/.local/state/julia/trace-store-report.json`; read that file rather than
guessing whether the store is under control.

## GitHub boundaries

Use ordinary signed-in GitHub access for authorized cards. Keep authentication material inside its trusted process. Evidence and notes belong on the card branch and pull request.
