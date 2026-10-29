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

Everything above was written before the reboot; this table was filled in after it, with nothing
above changed.

| Check | Result |
| --- | --- |
| The machine really rebooted | `uptime -s` says `2026-10-29 03:20:10`. `journalctl --list-boots` shows a new boot id `b60026d7c7634b59ae85155614c139a3` whose first entry is `03:20:32`, and the previous boot `cfd374ecf7df49f0b88e168be74fb4b7` ends at `03:19:59`. `last -x reboot` records `reboot system boot 6.8.0-147-generi Thu Oct 29 03:20 - still running`. |
| The service started by itself | `systemctl show -p ActiveEnterTimestamp julia-dashboard` says `Thu 2026-10-29 03:20:32 UTC`, 22 seconds after boot; `ExecMainStartTimestamp` is the same and `NRestarts` is `0`. `journalctl -b` line: `03:20:32 systemd[1]: Started julia-dashboard.service - Julia dashboard.` |
| Nothing was started by hand | The only lifecycle lines in this boot are systemd's own: `03:20:31 Started julia-dashboard-update.timer`, `03:20:31 Started julia-dashboard-watchdog.timer`, `03:20:32 Started julia-dashboard.service`; everything after them is `Starting`/`Finished` from the two timers (`03:21:15` watchdog, `03:21:47` update). No `systemctl start` line exists in this boot, and `who` shows no login before `03:45`, twenty-five minutes after the units were up. |
| The page answers on the tailnet address | `curl -sS -o /dev/null -w '%{http_code}' http://ovh.tail91f394.ts.net:4313/` returns `200`, and `/api/health` returns `200 {"status":"ok"}` with `linear: Linear answered`, `state: /var/lib/julia-dashboard/state is writable`, `runs: 0 run files parse`. The same two calls on `http://100.119.112.9:4313` return `200` and the same body. |
| The updater came back | `systemctl list-timers julia-dashboard-update.timer` shows it active with a next elapse; its first run after boot is `03:21:47` and it has run every five minutes since, the last at `04:02:37`. |
| The watchdog came back | The timer is active with a next elapse; the first probe after boot is `03:21:15` and the latest `04:06:22`, every one `probe: ok`, `consecutiveFailures: 0`. |
| It serves the merged build | At boot `state/build.json` said `commit 670825c249edf3dbaceb48d4e56bd1ee20315eeb`, `ref origin/feat/jul-276-service`, which is the head of the branch being merged and ahead of `main` (`4669edc`); the updater logged `{"action":"update","target":"4669edc…"}` at `04:02:37` and stood still, as recorded under "A merge needs nothing from a person" below. This row can only pass after the merge, so it was left open rather than rewritten. After the merge the updater moves the checkout onto `origin/main` and the row to read back is `state/build.json`'s `commit`, which must equal `git -C /home/ubuntu/julia-dashboard rev-parse origin/main`. |

The app's first line is shortened by the 1Password wrapper the unit runs under: the project name
inside `julia-dashboard: starting from /home/ubuntu/julia-dashboard/dashboard/` is replaced by a
masked token in the journal. Every `phase` line after it prints unchanged, so the log stays
readable.

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

## Red then green: the updater moves the checkout onto main

The updater used to compare ancestry and either fast-forward or stand still. Todd asked for the
opposite after his UAT yes: the deploy checkout follows `main` and nothing else, so after a squash
merge it must move onto the ref by itself. The two `ahead` and `ff-only` tests from the earlier
round were replaced by the tests below, because the rule they pinned is the one that is now gone.

The new tests were run against the code before this change
(`git show 4aa4cac:dashboard/scripts/update.mjs`) and then against the changed code.

Without the change:

```text
✖ an update moves the checkout onto the ref, rebuilds, restarts the unit and records the served commit
✖ a squash merge leaves the branch tip off main, and the updater moves the checkout onto main by itself
✖ local changes that block the move stop the update before any build or restart
✖ a move that leaves the checkout off the ref is a failure, not a recorded build
ℹ tests 10
ℹ pass 6
ℹ fail 4
```

The squash test fails as `actual: 'failed'` where it expects `'updated'`: `main`'s squash commit is
not an ancestor of the branch tip, so the old `merge --ff-only` cannot reach it and the update
stops with the server still serving the tested build. That is the defect Todd asked to remove.

With the change back:

```text
✔ an update moves the checkout onto the ref, rebuilds, restarts the unit and records the served commit
✔ a squash merge leaves the branch tip off main, and the updater moves the checkout onto main by itself
✔ local changes that block the move stop the update before any build or restart
✔ a move that leaves the checkout off the ref is a failure, not a recorded build
ℹ tests 10
ℹ pass 10
ℹ fail 0
```

Command for both runs, with the file swapped between them:

```sh
node --test scripts/update.test.mjs
```

The squash test builds the real shape: a topic branch pushed, the checkout detached on its tip,
then a `merge --squash` commit on `main`, and it first asserts that `merge-base --is-ancestor` says
the merge commit is not an ancestor of the tip. That assertion is what makes the test about squash
merges rather than about any move.

## A merge needs nothing from a person

Verifying a branch on the real service used to write that branch into
`/etc/julia-dashboard.env`. `envFileContent` always writes `DASHBOARD_UPDATE_REF=origin/main`, and
the installer passes `--ref` only to the single sync run (`installSyncEnv`), so the installed unit
follows main from the moment it is enabled and no ref is put back afterwards.

The checkout is the same story, moved out of prose and into the updater: when the checkout is not
at the ref, `update.mjs` runs `git checkout --detach <ref>` and then verifies `HEAD` is the ref
before it installs, builds and restarts. It no longer compares ancestry, so a squash merge is not
a special case.

| Check | Evidence |
| --- | --- |
| The env file cannot take a branch | unit test `a branch ref is a one-time sync and never reaches the env file`: `envFileContent({ ref: 'origin/feat/jul-276-service' })` still yields `origin/main` |
| The live env file follows main | `/etc/julia-dashboard.env` reads `DASHBOARD_UPDATE_REF=origin/main` |
| A squash merge is moved onto main | `node --test scripts/update.test.mjs`: the squash test above, red without the change and green with it |
| A move that does not land is a failure | test `a move that leaves the checkout off the ref is a failure, not a recorded build`: no `build.json` is written |
| Local changes still stop it | test `local changes that block the move stop the update before any build or restart`: phase `move`, no `npm ci`, no build, no restart |
| Nothing is left to remember | `docs/agents/server-runbook.md` "Merging a dashboard pull request" is now `gh pr merge <number> --squash --delete-branch`; the fetch, detach and manual start are gone |

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

## The stop ping after a reboot

The reboot exposed a hole the old wiring could not see. Mastra Code loads hooks from the session's
project directory and from `~/.mastracode/hooks.json`. The stop ping was wired only in
`.mastracode/hooks.json` inside this repository, and the chat opened after the reboot started in
`/home/ubuntu`, so no hook ran: `loadHooksConfig('/home/ubuntu')` returned `{}`, and the last
record in `~/.local/state/julia/stops.jsonl` was `03:18`, before the reboot.

Two fixes, both in the repository:

- `scripts/install-hooks.mjs` writes a global entry into `~/.mastracode/hooks.json` that calls
  `scripts/stop-ping.mjs --global` through absolute paths, so any session on the machine pings.
  It replaces only its own entry, so re-running it is safe.
- The `--global` entry exits without a ping when the session's own project already wires
  `stop-ping.mjs`, so one stop stays one comment and one reminder. The home directory resolves
  the global file as its project file; that file is this hook, not a second one, and a test pins
  that (`the global hook does not mistake itself for a project hook`).

Proof, on the server, after the reboot:

| Step | Result |
| --- | --- |
| Global hooks installed | `node scripts/install-hooks.mjs` wrote `~/.mastracode/hooks.json` with the Notification command `node /home/ubuntu/julia-dashboard/scripts/julia-agents.mjs -- node /home/ubuntu/julia-dashboard/scripts/stop-ping.mjs --global` |
| The home directory now has a hook | `loadHooksConfig('/home/ubuntu')` returns one Notification hook; a repository directory returns two (global plus project) |
| No double ping from inside the repository | the hook run with `--global` from the repository cwd left `stops.jsonl` at 75 lines, the same count as before |
| A real ping fires from outside the repository | at `04:11:05Z` the hook, run from `/home/ubuntu` for thread `34c99d86…`, appended a stop record resolving `card: JUL-276` and wrote a second record with `comment: …#comment-ecc6ebe2` and `notified: true`, `remindAt: 04:11:36Z`; comment `ecc6ebe2` on JUL-276 carries the message and the resume line |
| Tests | `node --test scripts/stop-ping.test.mjs` 6/6 pass, and with `scripts/scorecard.test.mjs` 18/18 |

The root `node scripts/test-owners.mjs --run local` in this checkout fails on tests that need
`firebase-tools`, which is not installed here; that is unrelated to this change and CI installs it.

## A chat with no card still pings

A chat started in the home directory has nothing that names a card: no kickoff line, no card in its
title, and no card branch under `/home/ubuntu`. The hook fired for such a chat and then had nowhere
to write, which is how a stop could reach `stops.jsonl` while Todd heard nothing.

The same payload against the code before this change (`git show 4aa4cac:scripts/stop-ping.mjs`),
for this chat's own thread:

```text
{"posted":false,"card":null,"error":"no card for this thread"}
```

Now the ping falls back to the card the last recorded stop belonged to, and remembers the answer for
that chat in `~/.local/state/julia/thread-cards.json`, so later stops do not drift to another card.
The stop record carries where the card came from — `thread`, `branch`, `project branch`, `binding`
or `last ping` — so an inherited card is never read as one the chat declared.

Proof, on the server:

| Step | Result |
| --- | --- |
| A real ping from outside the repository | at `04:40:54Z` the global hook, run with cwd `/home/ubuntu` for thread `5d5df123-2d91-4268-8c69-4a6676a5d209`, appended a stop record with `card: JUL-276`, `cardSource: "last ping"`, and a ping record with `comment: …#comment-dfb48afb`, `notified: true`, `remindAt: 04:41:25Z` |
| The binding is written | `~/.local/state/julia/thread-cards.json` holds `{"5d5df123…": {"card": "JUL-276", "source": "last ping", "at": "2026-10-29T04:40:54.939Z"}}` |
| The next stop reuses it | test `a chat started outside the repository pings the last card and stays bound to it`: after the history moves to another card, the second stop reports `cardSource: "binding"` and still posts to `JUL-276` |
| A chat that names its own card binds nothing | test `a chat that names its own card declares it and binds nothing` |
| A stop with no card anywhere still records and says why | test `a stop with no card anywhere is recorded and says so` |
| Tests | `node --test scripts/stop-ping.test.mjs` 10/10 pass |

## Resume after a reboot

`mastracode -t <thread>` is a headless-only option: it needs `--prompt`, and the interactive CLI
silently starts a new chat instead of reopening the thread. The interactive command is
`mastracode resume <thread-id>`. That is why the chat opened after the reboot was new, had no
kickoff message and could not be attributed to a card. The old thread was never lost:
thread `34c99d86…` is intact in `mastra.db`.

The stop comment now says `Continue in that session: cd /home/ubuntu/julia-mastra && mastracode
resume 34c99d86…`, naming the command that works and the directory the thread belongs to. Test:
`the stop comment names the resume command, never -t, which opens a new chat`.

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
node scripts/install-hooks.mjs
curl -s http://100.119.112.9:4313/api/health
```
