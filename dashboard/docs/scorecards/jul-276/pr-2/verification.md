# JUL-276 PR-2 verification

Run the dashboard as a service that updates itself from main between builds.

- Candidate: `d7b9005` on `feat/jul-276-service`, PR [#376](https://github.com/toddwyder/julia-next/pull/376).
- Server: `vps-ce27cb55`, systemd 255, Node v24.14.1.
- Deployed checkout: `/home/ubuntu/julia-dashboard` (worktree of `main`, detached).
- Service unit: `julia-dashboard.service`, timers `julia-dashboard-update.timer` (5 min) and
  `julia-dashboard-watchdog.timer` (1 min).

## Unit and build gates (candidate `d7b9005`)

| Gate | Command | Result |
| --- | --- | --- |
| Unit tests | `cd dashboard && npm test` | 50 tests, 50 pass, 0 fail |
| Lint | `cd dashboard && npm run lint` | clean |
| Build | `cd dashboard && npm run build` | compiled, `/`, `/start/[card]`, `/api/health` dynamic, `/_not-found` static |
| Framework lint | `node scripts/lint-framework.mjs` from the repo root | passing (root project only) |

The unit suite covers the decisions the service makes, so CI needs no systemd: the update
decision (idle, active run, unreadable run file), the updater flow against real git
repositories (fast-forward, non-fast-forward stop, checkout ahead of the ref, merge that
leaves the checkout behind, `DASHBOARD_UPDATE_REF`), the watchdog threshold (single blip
silent, third failure notifies once, recovery notifies once, failed notice retried), and the
three health checks.

## Install (lane 1)

Installed with `sudo -n node dashboard/scripts/install-service.mjs --host 100.119.112.9 --port 4313 --ref origin/feat/jul-276-service`.

| Check | Evidence |
| --- | --- |
| Service enabled at boot | `systemctl is-enabled julia-dashboard` returns `enabled` |
| Update timer enabled | `systemctl is-enabled julia-dashboard-update.timer` returns `enabled` |
| Watchdog timer enabled | `systemctl is-enabled julia-dashboard-watchdog.timer` returns `enabled` |
| Service answering | `GET http://100.119.112.9:4313/` returns 200, `<h1>Ready cards</h1>` |
| Health answering | `GET /api/health` returns 200 `{"status":"ok"}` with `linear`, `state`, `runs` all ok |

Screenshot: `lane-1-ready.png` (1280x800).

## Boot (lane 1b)

The service, the update timer and the watchdog timer must all come back on their own after a
real reboot. `enabled` alone is not proof, so the server is being rebooted.

What is written here before the reboot, so the check cannot be chosen after seeing the result:

| Check | Command | Pass condition |
| --- | --- | --- |
| The machine really rebooted | `uptime -s`, `journalctl --list-boots` | boot time is the reboot, and there is a new boot id |
| The service started by itself | `systemctl show -p ActiveEnterTimestamp julia-dashboard`, compared with `uptime -s` | start falls inside the first minute after boot, and `journalctl -b -u julia-dashboard` names `systemd` starting it, not a person |
| Nothing was started by hand | `journalctl -b -u julia-dashboard -u julia-dashboard-update -u julia-dashboard-watchdog` | every start line belongs to systemd at boot or to a timer, and no `systemctl start` appears after boot |
| The page answers on the tailnet address | `curl -sS -o /dev/null -w '%{http_code}' http://100.119.112.9:4313/`, then `/api/health` | `200` for both, and health reports `linear`, `state` and `runs` ok |
| The updater came back | `systemctl list-timers julia-dashboard-update.timer`, `journalctl -b -u julia-dashboard-update` | timer active with a next elapse, and at least one run after boot |
| The watchdog came back | `systemctl list-timers julia-dashboard-watchdog.timer`, `journalctl -b -u julia-dashboard-watchdog` | timer active with a next elapse, and at least one probe after boot |
| It serves the merged build | `cat /var/lib/julia-dashboard/state/build.json` | `commit` matches the merged main commit |

The previous boot's journal is kept in `/var/log/journal`, so the shutdown of the old boot and
the start of the new one can both be read afterwards.

### Boot results

Filled in after the server is back. Everything above was written before the reboot.

## Crash recovery (lane 2)

`systemctl kill --kill-who=main -s SIGKILL julia-dashboard`, then poll `GET /` until the answer
comes from a new `MainPID`.

| Kill | MainPID before -> after | Answer came back |
| --- | --- | --- |
| 1 | 1638294 -> 1638455 | 5001 ms |
| 2 | 1638455 -> 1638627 | 5141 ms |
| 3 | 1638627 -> 1638803 | 4968 ms |
| 4 (video) | killed mid-page-load | 5540 ms |

Baseline was 15 seconds; all four recoveries are inside it. `Restart=always` with
`RestartSec=2` and `StartLimitIntervalSec=0` in `ops/julia-dashboard.service` is what makes
this work; without the zero start limit, systemd stops restarting after five fast crashes.

Screenshot after kill: `lane-2-after-kill.png`. Recording of the kill and the page answering
again: `lane-2-kill-recovery.webm`.

## Updater (lanes 3 and 4)

| Lane | Setup | Evidence |
| --- | --- | --- |
| 3, skip during a run | run file `state/runs/lane-3.json` with `status: "running"` | `decide: action skip, code active-run`, naming `lane-3 is running`; no git, npm or systemctl command ran; the run file was left in place |
| 4, update when idle | no run file, ref `origin/feat/jul-276-service` | fetch, fast-forward, `npm ci`, `npm run build` (15.7 s), restart, record; `state/build.json` commit `713f7a3` matched `git rev-parse HEAD` and `systemctl show -p ActiveEnterTimestamp` moved |
| 3, unreadable run file | covered by unit test | update refuses with `unreadable-run-file` because an active run cannot be ruled out |

Plan deviation, recorded in the decision trail: lane 4 could not be a merge to `main`, because
that would ship this PR before Todd's yes. `DASHBOARD_UPDATE_REF` exists for exactly this and
was set to `origin/feat/jul-276-service`, so the updater moved the deployed checkout to a new
pushed commit. After merge the env file returns to `origin/main`.

Running the updater by hand without the service env file exposed a real defect: `git merge
--ff-only` exits 0 when the wanted commit is already an ancestor, so the updater reported and
recorded a build of a commit the checkout never moved to. Fixed in `713f7a3`; the updater now
treats an ahead checkout as up to date, re-reads `HEAD` after the merge, and stops before
building when the checkout is somewhere else. Two unit tests cover both cases, and both were shown red with the fix removed and green with it
back (see "Red then green" below).

## Red then green: the updater fix tests

The two tests that cover the updater defect were each run against the code before the fix
(`git show e693d67:dashboard/scripts/update.mjs`) and then against the fixed code.

Without the fix:

```text
✖ a checkout ahead of the ref stands still instead of reporting a build it never made (294.98ms)
✖ a merge that leaves the checkout behind is a failure, not a recorded build (218.81ms)
ℹ tests 2
ℹ pass 0
ℹ fail 2
```

The failures are the defect itself: the ahead case returned `updated` where the test expects
`up-to-date`, and the behind case returned action `install` where it expects phase
`fast-forward`.

With the fix back:

```text
✔ a checkout ahead of the ref stands still instead of reporting a build it never made (146.85ms)
✔ a merge that leaves the checkout behind is a failure, not a recorded build (183.86ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

Command for both runs, with the file swapped between them:

```sh
node --test --test-name-pattern="checkout ahead of the ref|merge that leaves the checkout behind" scripts/update.test.mjs
```

## The merge step needs no ref reset

Verifying a branch on the real service used to write that branch into
`/etc/julia-dashboard.env`, which left a manual "point it back at main" step after the merge. That
step is gone rather than remembered: `envFileContent` always writes
`DASHBOARD_UPDATE_REF=origin/main`, and the installer passes `--ref` only to the single sync run
(`installSyncEnv`), so the installed unit follows main from the moment it is enabled.

Evidence, in order:

| Check | Evidence |
| --- | --- |
| The env file cannot take a branch | unit test `a branch ref is a one-time sync and never reaches the env file`: `envFileContent({ ref: 'origin/feat/jul-276-service' })` still yields `origin/main`; the test fails with the pin removed and passes with it back |
| The live env file follows main | `/etc/julia-dashboard.env` reads `DASHBOARD_UPDATE_REF=origin/main` |
| Main being behind is not a rebuild | updater ran with the installed settings and logged `{"phase":"compare","action":"ahead","commit":"4d11c7c…","target":"4669edc…"}`, then stopped: no `npm ci`, no build, no restart, and the built commit stayed `4d11c7c` |
| A merge needs no action | once main contains this commit, `target` equals `head` and the same path reports up to date; the five-minute timer is the only thing involved |

So the answer to "where does pointing it back at main happen" is: at install time, in
`dashboard/scripts/install-service.mjs`, which never stores a branch. Merge time touches nothing.

## Health (lanes 7, 8, 9)

| Lane | Setup | Evidence |
| --- | --- | --- |
| 7, healthy | no run files | 200 `{"status":"ok"}`, checks `linear: Linear answered`, `state: state folder writable`, `runs: 0 run files`. Screenshot `lane-7-health-ok.png` |
| 8, failing piece named | `state/runs/broken.json` truncated | 503, `failing: ["runs"]`, detail `1 of 1 run files do not parse`, the file named in `files`; HTML view lists `broken.json` in the rose block. Screenshot `lane-8-health-failed.png` |
| 9, phone | same failure at 390x844 | `Health: failed` readable, rose border on the failing check, file path visible. Screenshots `lane-9-phone-ready.png`, `lane-9-phone-health.png` |

The 503 on the failure lanes is the check working, so the browser console records it as one
failed resource. No other console error and no page error appeared on any lane.

## Watchdog (lanes 5, 6 and 10)

The notices were sent by the installed timer, not written by hand.

| Lane | What happened | Evidence |
| --- | --- | --- |
| 5, down notice | `broken.json` left in place; three consecutive probes failed | Linear comment `1ee88cf3` on JUL-276 says the dashboard is down, names the health address and the failing `runs` check, and says nothing is needed from Todd; `issueReminder` notification delivered at 02:29:41Z |
| 6, recovery notice | `broken.json` removed; next probe answered | comment `cab5aed2` says the dashboard is answering again and names `downSince`; `issueReminder` notification delivered at 02:31:04Z; state file shows `consecutiveFailures: 0`, `lastNoticeKind: recovery` |
| 10, repeat 2, 5 and 6 | kill recovery and both notices ran again at the final head | recovery 5540 ms with the video above; watchdog state and the two notifications above |

Delivery was read back with the Linear `notifications` query, because a comment alone does not
prove a reminder was created. A second full outage was not forced, to avoid pinging Todd twice;
the "nothing repeats while it stays down" behaviour is covered by unit test
`the third consecutive failure notifies once, and nothing repeats while it stays down`.

## Deviation: one installed unit for every lane

systemd unit names are global, so ten independent installs are not possible on one server. One
`julia-dashboard.service` was installed and reused for every lane, with per-lane state folders
for the lanes that do not depend on the installed service (3, 7, 8), and sequential runs for
the lanes that do (2, 4, 5, 6, 9, 10). Each lane therefore proves the same unit the server will
run, which is stronger than ten throwaway units would have been; what it does not prove is two
installations side by side, which the plan never needed.

## Open

- Todd's yes in chat, which the plan requires before merge.
- The dashboard address is reachable on the tailnet only; a real phone over Tailscale was not
  used, the 390x844 viewport stands in for it.
- The service runs `node dashboard/server.js` through the operator checkout's
  `scripts/julia-agents.mjs` wrapper, so the key comes from 1Password at start. If the operator
  checkout is mid-rebase when the service restarts, the service fails closed and the watchdog
  reports it; documented in `docs/service.md`.

## How to rerun

```sh
cd dashboard
npm test
npm run lint
npm run build
sudo node scripts/install-service.mjs --host 100.119.112.9 --ref <ref>
curl -s http://100.119.112.9:4313/api/health
```
