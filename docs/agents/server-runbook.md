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
Full prompt payloads in `span_events` are nearly all of it, and on 29 October the file reached
22.6 GB. One command cleans it, and the last step of a slice's retro is the only thing that runs it.

```sh
node scripts/trace-store.mjs status
node scripts/trace-store.mjs clean <session id> [--card JUL-284]
```

`clean` takes one session id, the session the slice ran in, and does three things: it keeps that
session's `metric_events` rows, which carry the per-call tokens and cost the scorecard prices a card
from; it deletes the session's `span_events` and `log_events` rows, which hold the prompts; and it
checkpoints the file, so DuckDB folds the write-ahead log in and drops the blocks the delete freed.
Nothing deletes on a timer, by age, or from a list of sessions: a session loses its detail when a
retro has learned from it. The output is JSON with the row counts, the file size before and after,
and the free space after, and the retro pastes it.

A checkpoint rewrites blocks in place and truncates only the tail, so holes in the middle of a big
file stay. A cleanup can give back less than the round added, so when the file is over 15 GB after
one, `clean` comments on the slice's card (`--card`, JUL-276 by default) with the store size and
the fact that the round was too big. That comment is the alarm, so a `clean` run whose comment
failed says so in its JSON.

DuckDB's default memory limit is 85% of the machine, which on this 7 GB server is 6 GB, and on
30 October the kernel killed a run at 6.15 GB before it deleted a row. The store is therefore
opened with a budget of a third of the machine, at most 2 GB, spilling to a temp directory beside
it. A session that holds the store's exclusive lock makes `clean` exit 0 with `status: busy` and
the holder's PID; it changes nothing, so the next run can clean the same session again.

`status` prints the file, its size, the free space, and the row count of every table.

## GitHub boundaries

Use ordinary signed-in GitHub access for authorized cards. Keep authentication material inside its trusted process. Evidence and notes belong on the card branch and pull request.
