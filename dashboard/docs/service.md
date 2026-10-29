# The dashboard as a service

The dashboard runs on the Julia server as a systemd unit, from a checkout of its own, and keeps
itself current from `main` between builds. This page says what is installed, where it lives, and
what to read when it misbehaves.

## What runs

| Unit | Kind | What it does |
| --- | --- | --- |
| `julia-dashboard.service` | service | Serves the dashboard with `node dashboard/server.js` on `DASHBOARD_HOST:DASHBOARD_PORT`. `Restart=always`, `RestartSec=2`, `WantedBy=multi-user.target`. |
| `julia-dashboard-update.timer` | timer | Runs `julia-dashboard-update.service` 90 seconds after boot, then every 5 minutes. |
| `julia-dashboard-update.service` | oneshot | `dashboard/scripts/update.mjs`: moves the checkout onto the ref, `npm ci`, `npm run build`, restart the service, record the served commit. |
| `julia-dashboard-watchdog.timer` | timer | Runs `julia-dashboard-watchdog.service` 60 seconds after boot, then every minute. |
| `julia-dashboard-watchdog.service` | oneshot | `dashboard/scripts/watchdog.mjs`: probes `/api/health` and tells Todd when the dashboard is down and when it recovers. |

## Where things live

| Path | What it holds |
| --- | --- |
| `/home/ubuntu/julia-dashboard` | The checkout the service runs from. A worktree of `main`, never the operator checkout. |
| `/etc/julia-dashboard.env` | Non-secret settings, `root:root` mode 0600: host, port, state folder, checkout, update ref. |
| `/var/lib/julia-dashboard/state` | State that must survive a checkout reset: `build.json`, `watchdog.json`, `runs/*.json`. |

`/etc/julia-dashboard.env` holds no secret. `LINEAR_API_KEY` reaches the app from 1Password
through `scripts/julia-agents.mjs`, which the service names in its `ExecStart`. The watchdog
probes without the wrapper, so a 1Password outage cannot blind the watch; only the notice it
sends needs the key, and that child process goes through the wrapper.

## Run files

Anything that starts a build writes one file per run into `/var/lib/julia-dashboard/state/runs`:

```json
{ "id": "jul-279-1700000000", "status": "running", "pid": 4242, "startedAt": "2026-10-29T10:00:00.000Z" }
```

`status` is one of `starting`, `running`, `finished`, `failed`. The updater updates only when no
file says `starting` or `running`; a file it cannot read also stops the update, because an active
build is never risked to save five minutes. The health check parses every file and names the ones
it cannot read.

## Health

`/api/health` answers `200` and `{"status":"ok"}` only when all three checks pass:

1. `linear`: Linear answers a viewer query with the configured key.
2. `state`: the state folder can be written (a real file is written and removed).
3. `runs`: every run file parses.

Otherwise it answers `503`, names the failing checks, and lists the files behind a failing `runs`
check. Machines get JSON; a request that accepts HTML gets a small page that shows each check, the
failing ones in rose.

## Install and reinstall

Install from the checkout you want the units to come from. The script refuses to run off the
server, from the operator checkout, or from a lane worktree, and it is safe to run twice.

```sh
sudo node dashboard/scripts/install-service.mjs --host 100.119.112.9
```

It creates the state folder, writes the env file only if it is absent, copies the five unit files,
reloads systemd, runs one update, and enables the service and both timers.

The env file always records `DASHBOARD_UPDATE_REF=origin/main`, so the installed unit follows main
from then on. `--ref` moves the checkout to a branch for one sync only and is not saved, which is
what lets a branch be verified on the real service without leaving the server pointed at a branch
after the merge. Nothing has to be reset by hand at merge time.

## Reading a failure

```sh
systemctl status julia-dashboard
journalctl -u julia-dashboard -n 100 --no-pager
journalctl -u julia-dashboard-update -n 60 --no-pager
journalctl -u julia-dashboard-watchdog -n 60 --no-pager
cat /var/lib/julia-dashboard/state/build.json
```

Every line the scripts write starts with `julia-dashboard:` and carries its phase, so a fetch, a
skip, a failed build and a restart are distinguishable without opening the code. A skipped update
names the run that blocked it.

`state/build.json` names the commit the running checkout was built from, and
`systemctl show -p ActiveEnterTimestamp julia-dashboard` says when the current process started, so
the two together name the build that is being served.

## When Todd is told

The watchdog tells Todd only twice per outage: once after three consecutive failed probes, and
once when the dashboard answers again. Both go out as a comment on JUL-276 plus an `issueReminder`
on that card, which is the pair that actually reaches his phone. No service issue is created, and
a single failed probe is silent.
