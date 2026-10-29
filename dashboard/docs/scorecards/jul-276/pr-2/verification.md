# JUL-276 PR-2 verification

Run the dashboard as a service that updates itself from main between builds.

- Candidate: `713f7a3` on `feat/jul-276-service`, PR [#376](https://github.com/toddwyder/julia-next/pull/376).
- Server: `vps-ce27cb55`, systemd 255, Node v24.14.1.
- Deployed checkout: `/home/ubuntu/julia-dashboard` (worktree of `main`, detached).
- Service unit: `julia-dashboard.service`, timers `julia-dashboard-update.timer` (5 min) and
  `julia-dashboard-watchdog.timer` (1 min).

## Unit and build gates (candidate `713f7a3`)

| Gate | Command | Result |
| --- | --- | --- |
| Unit tests | `cd dashboard && npm test` | 49 tests, 49 pass, 0 fail |
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

Boot itself was not exercised because rebooting this server would end the session that built
and verified the card. The boot promise rests on `WantedBy=multi-user.target` plus
`systemctl is-enabled`; a real reboot is left for the install-the-service-once step once this
PR merges, and it is stated here rather than claimed.

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
building when the checkout is somewhere else. Two unit tests cover both cases.

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
- A real reboot to prove the unit starts on boot; deferred as described above.
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
