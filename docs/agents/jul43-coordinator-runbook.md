# JUL-43 / JUL-61 coordinator runbook

**This file's own procedure is current as of 2026-09-17 (JUL-61).** JUL-43 is closed; its
history is preserved at the bottom under "JUL-43 history — not the current procedure." Read
top to bottom for the live operating procedure — you should never need the original chat that
produced this file.

The Linear issue ([JUL-61](https://linear.app/julia-next/issue/JUL-61)) owns the work
definition and its evidence trail; this file owns the verified operating procedure only.

---

## Bootstrap from a laptop

Starting from nothing but this section and a laptop, you can reach the server and start the
orchestrator. Everything below was rediscovered and verified live on 2026-09-16–17.

**Network path.** The server's public hostname (`vps-ce27cb55.vps.ovh.us`) blocks inbound SSH
at the OVH/host firewall (`ufw` or an OVH-side rule) — this was independently reproduced across
three tools (Bash, sandbox-disabled Bash, PowerShell `Test-NetConnection`) and survives a full
reboot, ruling out a transient ban. **The working path is Tailscale**, not the public hostname:

```sh
ssh -i ~/.ssh/ovh_runner_ed25519 ubuntu@100.125.239.98
```

(Windows: the key is at `C:\Users\<you>\.ssh\ovh_runner_ed25519`; use Git Bash or WSL for the
`ssh`/`scp` commands in this runbook, not raw PowerShell.) The peer name is `orca-runner`,
Tailscale IP `100.125.239.98`. Probe only this named login when checking access — do not try
alternate ports or hosts to work around the public-hostname block.

**Editing a file on the server: write locally, then `scp` it over — never nested heredocs
through multiple shells.** `ssh ... bash -s <<'REMOTE'` wrapping a `sudo -u orchestrator-svc
bash -lc '...'` wrapping a `python3 - <<PYEOF` heredoc reliably breaks on quote/backslash
collisions across that many shell layers (a real, repeated time sink in JUL-61). Write the
change to a local file, `scp` it to the server, then run or apply it there.

**Accounts on the server:**

| Account | Role | sudo |
| --- | --- | --- |
| `ubuntu` | Server administrator. This is the *installation* channel — use it to create accounts, install files under `/etc`, manage systemd. Not a day-to-day operating identity. | Passwordless (`sudo -n true` succeeds) |
| `runner` | Builder. Runs `orca-server.service`. Writes in its own worktrees, commits locally. | None |
| `orchestrator-svc` | Orchestrator. Read-only checkout, dispatches builders/reviewers, reads/writes Linear, holds the publisher credential. | Narrow exact-command sudo only: `/etc/sudoers.d/orchestrator-svc-checkout-sync` and `-ops` (see the JUL-79 laptop-session section) |

**Orca's own route** (`orca-server.service`, running as `runner`) reaches the server
independently of SSH entirely — it's a separate channel with its own liveness, not something
this SSH bootstrap needs to re-establish.

**Claude Code permission mode for privileged work.** The default auto-mode classifier blocks
sensitive remote-exec and credential-adjacent commands from an ordinary session — this is
correct behavior, not a bug to route around, for routine work. For a setup ticket that
legitimately needs to run `ssh`/`scp` against this server and touch credential files, use
either:
- accept-edits mode with an explicit `ssh.*` allow rule (and any other specific commands
  needed) added to the repo's `.claude/settings.json` (**not** `settings.local.json` — that
  file is untracked and won't travel with a fresh checkout), or
- `--dangerously-skip-permissions` for the duration of the setup ticket only.

Either way, the allow rules belong in the repo's `.claude/settings.json` so a fresh session
inherits them from the checkout itself rather than needing them re-granted from chat.

**Linear author caveat.** Every Linear MCP write (comment, issue read) authenticates as the
human account that ran `claude mcp login linear`, not as a distinct `orchestrator-svc` bot
identity — Linear's OAuth has no concept of a sub-identity per MCP client. Comments posted "by
the orchestrator" will show as Todd Wyder in Linear's UI. This is a platform limitation, not a
bug in this setup; don't try to work around it by minting a separate Linear account.

**Dispatch runs locally on the server, not from the laptop (JUL-61 step 7 finding).** The
installed Orca CLI at `C:\...\orca.exe` on the laptop is not a separate laptop-only tool — it's
the *same* binary shipped inside Orca's server install, at `/opt/Orca/orca-ide` on this box
(confirmed live: `orca-ide --help` and `node /opt/Orca/resources/app.asar.unpacked/out/cli/index.js
--help` print the identical command tree). `orca-server.service` (the always-on daemon, running
as `runner`) is what either CLI actually talks to — the laptop reaches it remotely over
Tailscale/websocket (`--environment "OVH runner"`); `orchestrator-svc`, running on the same box,
reaches it over the *same* websocket protocol via its own **local** pairing, rather than through
`runner`'s local unix socket (`~runner/.config/orca/o-*.sock`), which `orchestrator-svc` has no
permission to touch.

**One-time setup, as `orchestrator-svc` on the server:**
```sh
# Get the running daemon's current pairing URL (root only; never print/store it beyond this step):
sudo journalctl -u orca-server.service --no-pager | grep "Pairing URL:" | tail -1
# Register it as a new local-named environment (reuses the daemon's advertised
# ws://100.125.239.98:6768 endpoint -- this does not disturb the laptop's own
# "OVH runner" pairing; each `environment add` just adds another accepted client):
/opt/Orca/orca-ide environment add --name ovh-local --pairing-code '<pairing URL from above>'
```
Verified live (2026-09-17): `orca status --environment ovh-local --json` as `orchestrator-svc`
reports `reachable: true`, `connectionState: connected`, and `orca project setups --environment
ovh-local` lists `julia-next` ready at `/home/runner/julia-next` — proof this is a real,
independent dispatch path, not a reused laptop credential. The laptop's own `--environment "OVH
runner"` kept working unaffected after this pairing was added.

Set for `orchestrator-svc`'s environment (e.g. in its shell profile, so every session picks
it up):
```sh
export ORCA_BIN=/opt/Orca/orca-ide
export ORCA_ENVIRONMENT=ovh-local
```
`scripts/orca-cli.mjs` already reads `ORCA_BIN` from the environment; `scripts/check-readiness.mjs`
reads `ORCA_ENVIRONMENT` the same way (defaulting to `"OVH runner"` for laptop use, unchanged) --
`getEnvironment()` in that file is exported for exactly this. When invoking `check-readiness.mjs`
directly, also load the publisher credential (see "Publishing" below):
```sh
ORCA_BIN=/opt/Orca/orca-ide ORCA_ENVIRONMENT=ovh-local \
  node --env-file=/etc/orchestrator-svc/.env.publisher scripts/check-readiness.mjs
```
Verified live, all four checks green, entirely server-local, no laptop involved.

**A second Orca daemon runs as `orchestrator-svc` itself (JUL-63).** `ovh-local` above is
`orchestrator-svc` pairing to the *existing* daemon (`orca-server.service`, `User=runner`) --
every terminal that daemon spawns runs as `runner`, no matter which account invoked the CLI to
create it (confirmed live: `id` inside a terminal created via `ovh-local` reports
`uid=1001(runner)`). Builder/reviewer dispatch is fine running as `runner` (that's the intended
role), but the orchestrator itself needs terminals that are genuinely `orchestrator-svc` --
`ovh-local` cannot provide that. So a **second, independent Orca daemon** runs as
`orchestrator-svc`, on its own port, paired under its own environment name:

| | Runner's daemon | Orchestrator's daemon |
| --- | --- | --- |
| systemd unit | `orca-server.service` | `orca-server-orchestrator.service` |
| Runs as | `runner` | `orchestrator-svc` |
| Port | 6768 | 6769 |
| Xvfb display | `:99` (unmanaged background process) | `:98`, via `xvfb-orchestrator.service` |
| Env file | `/etc/orca-runner/orca-server.env` | `/etc/orchestrator-svc/orca-server.env` |
| `orchestrator-svc`'s pairing name | `ovh-local` | `orchestrator-local` |
| Registered project | `/home/runner/julia-next` | `/srv/orchestrator-svc/julia-next` |
| Used for | Dispatching builders/reviewers | The orchestrator's own Run/terminal |

Both daemons run the same `/opt/Orca/orca-ide` binary as the `ovh-local` setup above -- this is
two instances of one binary, not new software. `orca-server.service`'s own Xvfb (`:99`) is a
bare background process (not a systemd unit) that happened to already exist; the orchestrator's
Xvfb (`:98`) is deliberately a proper `xvfb-orchestrator.service` instead, so it survives
reboots and isn't tied to any one shell session -- a bare background Xvfb died the first time
this was tried, taking the daemon down with it.

**One-time setup for the second daemon** (as `ubuntu`, the admin channel):
```sh
sudo tee /etc/orchestrator-svc/orca-server.env >/dev/null <<'ENV'
ORCA_SERVE_ARGS=serve --pairing-address 100.125.239.98 --port 6769
ENV
sudo chown root:orchestrator-svc /etc/orchestrator-svc/orca-server.env
sudo chmod 0644 /etc/orchestrator-svc/orca-server.env

# Xvfb display :98, supervised (mirror this unit's shape for orca-server-orchestrator.service
# itself, using orca-server.service as the template per JUL-63's decision):
sudo systemctl enable --now xvfb-orchestrator.service
sudo systemctl enable --now orca-server-orchestrator.service
```
Then pair `orchestrator-svc` to its own new daemon and register the project, exactly like the
`ovh-local` setup above but against port 6769:
```sh
CODE=$(sudo journalctl -u orca-server-orchestrator.service --no-pager | grep "Pairing URL:" | tail -1 | sed 's/.*Pairing URL: //')
sudo -u orchestrator-svc /opt/Orca/orca-ide environment add --name orchestrator-local --pairing-code "$CODE"

# Get the new environment's id from `orca environment list --json`, then:
sudo -u orchestrator-svc /opt/Orca/orca-ide project setup-existing-folder \
  --environment orchestrator-local --project github:toddwyder/julia-next \
  --host "runtime:<environment-id>" --path /srv/orchestrator-svc/julia-next --kind git
```
**Re-pairing** (if the daemon restarts and the old pairing goes stale -- watch for `status:
disconnected` on `orchestrator-local`): re-run the `environment add` step above with a fresh
pairing URL from a fresh `journalctl` grep; the project registration does not need repeating.

Verified live (2026-09-17): a terminal created via `--environment orchestrator-local` reports
`uid=1002(orchestrator-svc)` -- a real, independent orchestrator identity, not a reused `runner`
terminal with a different label.

**A narrow sudo rule lets `orchestrator-svc` trigger its own checkout sync**
(`/etc/sudoers.d/orchestrator-svc-checkout-sync`, `visudo -c` clean): exactly
`sudo -n systemctl start julia-next-checkout-sync.service`, nothing else -- `sudo -n systemctl
status <anything-else>` is still refused. This is what `scripts/julia-run.mjs` uses to self-heal
a stale checkout instead of needing the `ubuntu` admin channel for that one action.

**Capturing a browser-approval URL (Claude login, Linear MCP login) from tmux: always
`capture-pane -pJ`, never `-p` alone.** The plain `-p` capture wraps long lines at the terminal
width, which splits a pairing/OAuth URL mid-string and hands Todd a broken link (happened live
in JUL-61). `-J` joins wrapped lines back into one before you read it out:
```sh
tmux capture-pane -t <session> -p -J
```

**Both Orca daemons crash under Xvfb without `LIBGL_ALWAYS_SOFTWARE=1` (JUL-98, 2026-09-22),
fixed.** Each daemon runs headless under Xvfb, a virtual X server with no real GPU/DRI device
behind it. Electron's GPU process still tries to initialize hardware acceleration there, fails,
and brings the whole process down: `FATAL:.../gpu_data_manager_impl_private.cc:416] GPU process
isn't usable. Goodbye.` followed by `Orca serve exited via SIGILL.`. `Restart=on-failure` brings
the daemon back within ~5-20 seconds, but the restart **kills every terminal that daemon owns**,
mid-work, with no chance for a running coordinator or builder to report anything -- found live
when it killed a coordinator and a builder at the same instant. `journalctl` back to server boot
showed the identical signature had already fired at least six times before that, unrecorded,
since 2026-09-17 -- it had been happening for almost a week and nothing was watching for it.
**A first attempt (`--disable-gpu` in `ORCA_SERVE_ARGS`) crash-looped the daemon outright**
(`Unknown flag --disable-gpu for command: serve`): the systemd `ExecStart` runs `/usr/bin/orca-ide`,
a wrapper script that runs `serve` in Node-only mode (`ELECTRON_RUN_AS_NODE=1`) and validates argv
against a strict whitelist -- the actual crashing Electron instance is spawned internally as a
subprocess `serve` never exposes to a CLI flag. **Real fix:** `LIBGL_ALWAYS_SOFTWARE=1` added as
a plain env var (not a CLI flag) to both daemons' env files, forcing Mesa's software GL renderer
so Chromium's GPU process gets a working context under Xvfb instead of failing to find hardware.
Source of truth, verification and reapply-on-rebuild steps: `ops/orca-daemons/README.md`. Proven
live: both daemons restarted clean (`NRestarts=0`, stable), and the crash signature does not
recur in `journalctl` after the fix.

---

## Current roles (JUL-61)

| Role | Account | Can | Cannot |
| --- | --- | --- | --- |
| Orchestrator | `orchestrator-svc` | Read the repo (`/srv/orchestrator-svc/julia-next`, dirs `550`/files `440`, owner `root:orchestrator-svc`), dispatch builders/reviewers via Orca, read/write Linear via its own MCP login, hold the publisher credential (`/etc/orchestrator-svc/.env.publisher`, owner `orchestrator-svc:orchestrator-svc`, mode `600`, parent dir mode `700`) | Write files, commit |
| Builder | `runner` | Write in its own worktree, commit locally | Read the publisher credential, publish, control the orchestrator |
| Reviewer | `runner`, fresh worktree | Read the candidate commit, write a report outside the candidate worktree | Change the candidate — checked afterward by `scripts/verify-reviewer-worktree.mjs` |

Verified live: `runner` cannot read `/etc/orchestrator-svc/.env.publisher` (permission denied);
`orchestrator-svc` can; `orchestrator-svc`'s checkout write is denied (`touch` inside it fails).

**The read-only checkout cannot update itself — by design — so a root-owned systemd timer
syncs it.** `orchestrator-svc` has no write access to `/srv/orchestrator-svc/julia-next`,
including its `.git` directory, so it cannot `git pull`/`fetch` its own checkout (a real
fresh-session acceptance run hit exactly this before the timer existed: the checkout was stuck
at an old commit and reported stale readiness results). Automated 2026-09-17 (JUL-61 closing
pass):

- `/usr/local/sbin/julia-next-checkout-sync.sh` (root:root, mode `700`) fetches `origin/main`,
  resets the checkout to it, then re-applies `root:orchestrator-svc` ownership and `550`/`440`
  permissions — the same sequence the manual procedure used, now scripted.
- `julia-next-checkout-sync.service` (oneshot, runs as root) executes it;
  `julia-next-checkout-sync.timer` fires it 30s after boot/enable and every 15 minutes after
  that (`OnBootSec=1min`, `OnActiveSec=30s`, `OnUnitActiveSec=15min`, `Persistent=true` so a
  missed run while the box was down catches up on the next boot).
- Verified live: triggered a real timer-fired run (not a manual `systemctl start`) and confirmed
  the checkout's HEAD matched `origin/main`'s actual HEAD exactly afterward
  (`git ls-remote origin main`), and that `orchestrator-svc` still cannot write into the
  checkout post-sync.
- **JUL-63**: `orchestrator-svc` can also trigger this itself, narrowly — see the sudo rule in
  the "Bootstrap from a laptop" section above, which `scripts/julia-run.mjs` uses.

Manual sync is still available for an out-of-band update without waiting up to 15 minutes:
`sudo systemctl start julia-next-checkout-sync.service`. Check its history with `sudo
journalctl -u julia-next-checkout-sync.service`.

### The read-only checkout's three "modified" files are mode-only noise (JUL-44)

`git status` in `/srv/orchestrator-svc/julia-next` permanently shows these three entries as
modified: `ops/service-dropbox/write-secret.sh`, `scripts/check-readiness.mjs`, and
`scripts/julia-run.mjs`. `git diff` shows these are `old mode 100755` / `new mode 100644` with
ZERO content change: the `chmod 440` hardening in the checkout-sync script strips the executable
bit from the three files that are committed as executable. Do not treat this as a modified
checkout, and do not try to `git checkout` it away — the next sync re-creates it. A real CONTENT
change would show as added or removed lines, so check `git diff --stat` for nonzero insertions
before believing the checkout is dirty.

## Ready queue: board order and the /tmp trap (JUL-79 step 1)

`scripts/ready-queue.mjs` is the plain-script half of "run the graph from the board": one
`node scripts/ready-queue.mjs --check` invocation performs exactly one check cycle and exits. It
is **not** on a timer until JUL-79's run enables `julia-ready-queue.timer` (its units are in
`ops/ready-queue/`, installed disabled by a laptop session), so "explicit launch only" below holds
until then. When the slot is free it starts the top Ready card via
the same command `julia-run.mjs` uses for a manual start, and its state file is
`~/.local/state/julia-next/ready-queue.json` (what the previous check saw). Facts a future
session must not have to rediscover:

- **Board order is `Issue.sortOrder`, sorted client-side.** Verified live 2026-09-18: the field
  is a populated float (e.g. `-28624`). Linear's paginated connections only accept
  `orderBy: createdAt | updatedAt` — `manual` is rejected — so "top card in Ready" is the Ready
  issue with the lowest `sortOrder`, not the order the connection returns. Moving/reordering a
  card is never itself a trigger; the next check is what acts.
- **The check interval is a parameter, not a sleep.** `--interval-minutes` (default `5`, or
  `READY_QUEUE_INTERVAL_MINUTES`) is echoed only; the script never sleeps. The later timer must
  set its `OnUnitActiveSec` to the same value and pass `--interval-minutes` so the emitted script
  and the unit agree. One-full-check rule: a card starts only if the previous check already saw
  it in Ready, and a card moved into and out of Ready between checks must never start (the state
  file is rewritten with the whole current Ready set each cycle, so a departure is forgotten).
  The timer this script is built for is `ops/ready-queue/julia-ready-queue.timer`; the interval
  belongs in the service's `ExecStart` (`--interval-minutes`) and the timer's `OnUnitActiveSec`
  together, and `ops/ready-queue/units.test.mjs` pins both to 5.

  The real units live in `ops/ready-queue/` (see the JUL-79 laptop-session section below) — a
  service file and a separate timer file, installed by a laptop session, not inline here.
- **No Ready state or label groups existed as of 2026-09-18.** The script resolves the workflow
  state named `Ready` on team `Julia-next` at runtime and no-ops quietly when it is absent;
  creating that state is a separate, Todd-approved step. The label→model/effort choice is now
  the real rule from `scripts/seat-labels.mjs` (JUL-79 step 5); creating the matching Linear
  labels is the coordinator's later action. See "Seat labels, the restart-after-finish guard"
  below.
- **Linear relation direction, verified live 2026-09-18.** There is no `blocked_by` relation type
  and no `blockedBy` field on `Issue`. Every blocking relation is typed `blocks` and lives on the
  blocker's own `relations` connection as `{ type: 'blocks', issue: <blocker>, relatedIssue:
  <blocked> }`. The blocked card sees the same relation in its `inverseRelations` connection,
  also typed `blocks`, where `relation.issue` is the blocker and `relation.relatedIssue` is the
  blocked card itself (verified on JUL-78: four `blocks` entries with `issue` JUL-54/56/55/57 and
  `relatedIssue` JUL-78). `ready-queue.mjs` therefore reads a card's blockers only from its
  `inverseRelations` entries typed `blocks`, taking `relation.issue`; `relations` entries typed
  `blocks` are cards THIS card blocks and are ignored. The `Team.states` query shape is confirmed
  live.
- **Both Orca daemons run with `PrivateTmp=yes`.** A file written to `/tmp` by a terminal of one
  daemon is INVISIBLE to terminals of the other daemon (`orca-server.service` as `runner` vs
  `orca-server-orchestrator.service` as `orchestrator-svc`). Coordinator-to-worker prompt handoff
  must therefore be self-contained in the terminal command itself (e.g. base64-embedded) or live
  inside the repo — never a `/tmp` path, which silently reads as an empty/missing file to the
  other side rather than failing loudly.

## Six JUL-94 dispatch and publish discoveries (verified 2026-09-19)

1. `orca orchestration run-create` fails with `no_active_sender_terminal` when it is run from a
   plain shell instead of from inside an Orca terminal. Pass `--from` with any live terminal
   handle on that environment and the same command succeeds.
2. `worker-start --base-branch` is handed straight to `git worktree add` as a ref, so a branch
   that exists only on the remote fails with `fatal: invalid reference`. Fetch it first with
   `git fetch origin BRANCH:refs/remotes/origin/BRANCH`, then pass `origin/BRANCH` instead of the
   bare branch name.
3. A codex worker can fail at stage `agent_readiness` with the message `Agent startup blocked:
   codex-update-prompt` when the Codex update banner is showing. The verified recovery is to read
   the agent terminal, send the text `3` to choose Skip until next version, then re-dispatch onto
   that same ready terminal with `worker-start --terminal HANDLE --worktree path:PATH`, dropping
   the creation flags `--name`, `--repo`, `--base-branch` and `--setup`, which are rejected for an
   existing worktree.
4. `orca terminal wait --for tui-idle` reports satisfied while a codex worker is still mid-turn,
   so it is not a completion signal. Poll `orca orchestration worker-show` and read
   `projection.outcome`, or look for the artifact the worker was asked to write.
5. The julia-graph-publisher installation token cannot read CI results: `GET
   /repos/OWNER/REPO/commits/SHA/check-runs` and `GET /repos/OWNER/REPO/actions/runs` both return
   HTTP 403 `Resource not accessible by integration`, so CI green cannot be proven through the
   publisher. The same token can read the pull request record itself, including `state`,
   `mergeable`, `mergeable_state` and the head sha. Until the App gains checks read permission,
   the substitute used on JUL-94 is the CI unit-test step only: run `node --test
   scripts/*.test.mjs` locally on the candidate commit in the candidate worktree and record its
   real output as the evidence. That step is not the whole workflow and does not cover the other
   workflow steps — the `node --check` syntax pass over every `.mjs` under `scripts` and `ops`,
   the check that no builder-side script under `scripts` reads an Axiom credential, the check
   that the relay binds to `127.0.0.1`, the check that the relay systemd unit carries its
   account and hardening directives, and the check that the example env file holds only a
   placeholder token. A coordinator that needs full coverage must run those checks too.
6. There is no read-only script for pull request status: `publish-pr.mjs` only pushes and opens,
   and `merge-pr.mjs` only merges. Reading pull request mergeability on JUL-94 required an ad hoc
   token-bearing GET run as `orchestrator-svc`; closing this gap with a small read-only script is
   worth doing. The concrete recipe is:

   ```sh
   node --env-file /etc/orchestrator-svc/.env.publisher --input-type=module -e "import { getPublisherInstallationToken } from './scripts/publish-via-github-app.mjs'; const token = await getPublisherInstallationToken(); const res = await fetch('https://api.github.com/repos/toddwyder/julia-next/pulls/NUMBER', { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } }); const pr = await res.json(); console.log(JSON.stringify({ state: pr.state, mergeable: pr.mergeable, mergeable_state: pr.mergeable_state, head_sha: pr.head.sha }));"
   ```

   It is run as `orchestrator-svc` from `/srv/orchestrator-svc/julia-next`. The token is minted
   inside the process, so it never appears in `argv` and is never printed. This exact read was
   used on 2026-09-19 to confirm `mergeable_state` clean before merging PR 53.

## Nine JUL-97 coordinator-run discoveries (verified 2026-09-19)

Each of these was learned on the box during JUL-97 and would quietly mislead a fresh session;
the date is the day it was verified. Items 1-5 are about dispatch and the seat tools, 6 about
reading an Orca terminal, 7 about the board reacting to a merge, 8 about Linear's GraphQL facts
the board work proved, and 9 about the coordinator's own tool grants.

1. **Claude on `runner` works.** A live probe (`claude -p` with a one-line prompt) returned a
   normal answer and exit 0. JUL-89 and the JUL-97 readiness review both recorded it as stuck at
   a sign-in prompt; that premise is stale. Probe before believing either way — a prior note is
   not evidence of today's login state.
2. **A real Codex usage cap was captured mid-review.** The output was `ERROR: You've hit your
   usage limit ... try again at Sep 20th, 2026 12:33 AM`. It matches `CAP_ERROR_PATTERN` in
   `scripts/julia-run.mjs`. This is **not** a failed attempt -- that accounting rule does not live
   in `graph/seat-table.mjs`, which only maps seats to their primary/backup entries; it lives in
   the coordinator skill (`.claude/skills/julia-coordinator/SKILL.md`, "Running a step" step 4: a
   restart on the backup is "the table doing its job, not a failed attempt"). The same review
   restarted on the reviewer backup, and that restart is what produced the verdict. Recognising
   the pattern is what keeps a capped seat from burning an attempt. The automatic cap fail-over
   in `scripts/julia-run.mjs` (`waitForEarlyCapError`) covers the **orchestrator** seat only; a
   builder or reviewer cap is the coordinator's own manual check.
3. **Launching Claude from an Orca terminal command with the prompt in an argument does not
   work.** Claude Code's `--allowedTools` is **variadic**, so every bare word after it is read as
   another tool rule; the prompt argument is swallowed and the run dies with `Error: Input must be
   provided either through stdin or as a prompt argument when using --print`. The rule that
   follows: nothing that isn't a flag may follow `--allowedTools`; the prompt belongs on stdin.
   A quoted, comma-separated tool list followed by more flags is fine — that is exactly what
   `julia-run.mjs`'s own launch command does:

   ```sh
   claude -p --permission-mode acceptEdits --effort high --allowedTools Bash Read Grep Glob Write < promptfile
   ```
4. **The Pi builder dispatch that works, end to end** -- corrected 2026-09-22 (JUL-98): the
   original form below used a `{ ...; } | consumer` brace-group, which is no longer usable (see
   the finding right after it) and never actually ran a real dispatch as documented; a brace-free
   heredoc piped straight into the consumer replaces it and is live-verified under the
   coordinator's real `Bash(orca *)` grant:

   ```sh
   orca worktree create --environment ovh-local --repo path:/home/runner/julia-next --name NAME --base-branch BRANCH --no-parent --setup skip

   orca terminal create --environment ovh-local --worktree path:THATPATH --command "cat <<'BRIEF' | node ops/service-dropbox/run-pi-seat.mjs builder-backup --effort high
   <the step brief: ticket id, step, acceptance criteria, candidate branch>
   BRIEF"
   ```

   The heredoc feeds the brief straight to `builder-backup`'s stdin; it is never written to a
   `BRIEF.md` file in the candidate worktree at all, so there is nothing for the worktree's own
   `git status` to see and nothing to `rm` afterward -- simpler than the original two-step
   write-then-cat-then-delete it replaces. The environment names on the box are `ovh-local`
   (`runner`) and `orchestrator-local` (`orchestrator-svc`), not the display names.

   **Claude Code's Bash permission layer refuses any brace-group compound statement outright,
   even nested inside a quoted `--command` argument to `orca` (found 2026-09-22, JUL-98).** Two
   independent JUL-98 coordinator launches, each carrying the exact documented
   `--allowedTools` grant list, could do nothing beyond reads and Linear writes -- verified live
   with three throwaway diagnostic sessions (no card touched, terminals closed after) rather than
   guessed at:
   - `orca --help` and `orca --help && echo DONE` -- both approved under `Bash(orca *)`.
   - A plain `;`-separated chain and a redirect outside the working directory each fail for their
     own ordinary reasons (the latter: "Output redirection ... blocked ... only ... allowed
     working directories"), neither is about compound statements.
   - A heredoc alone, and a heredoc piped straight into a consumer, are both approved.
   - `{ echo hi; orca --help; } | cat` -- a brace-group -- is declined outright, verbatim reason
     `Contains compound_statement`, before anything inside it runs. Nothing about `orca`, the
     pipe, or what the braces contain: the `{ ...; ...; }` syntax itself is refused, apparently
     scanned for anywhere in the full command string regardless of quoting context.
   The installed Claude Code CLI (`2.1.269`) had not changed since before that evening's working
   coordinator sessions (package install directory's mtime: 2026-09-12, untouched) -- so this is
   either a behavior this CLI version always had that the brace-group dispatch pattern never
   actually exercised live before, or a permission-classifier change bundled with a Claude model
   update rather than a CLI version bump; either way, pinning the CLI version is not the fix here.
   The brace-free heredoc-pipe form above and in the coordinator skill's own dispatch step
   (`.claude/skills/julia-coordinator/SKILL.md`, "Running a step") is the corrected pattern going
   forward -- never reintroduce a `{ ...; }` block in a dispatch command.
5. **`orca terminal wait --for` accepts only `exit` and `tui-idle`.** `tui-idle` is not completion
   for a Pi or Codex agent, and even `--for exit` times out while a shell stays open after the
   agent has finished. The reliable completion signals are `pgrep -f` for the agent process and
   the candidate worktree's own `git log`.
6. **`orca terminal read` with no cursor returns the OLDEST retained window, not the newest.** A
   long agent run therefore looks frozen. Use `--screen` for the current frame, and `--limit <n>`
   to request more retained lines for a long agent response. The documented use of `--cursor` is
   to pass the `nextCursor` value from a previous read to get only new output since that read;
   passing a cursor past the last `nextCursor` jumps forward but silently skips output, so it is a
   trade-off, not the normal use.
7. **Merging a pull request whose title names the ticket moved JUL-97 straight from Backlog to
   Complete mid-item**, with two steps still to run. The coordinator moved it back to
   Implementation and said so on the card. (These are the columns after JUL-97 step 1's rename:
   `Done` → `Complete`, `In Progress` → `Implementation`.) Expect this on every step PR whose
   title names the ticket (see also "A PR title naming a Linear issue closes that issue on
   merge").
8. **Linear API facts the board work proved**, each checked against Linear's own published
   GraphQL schema:
   - `workflowStateCreate` requires `color`, and `WorkflowStateUpdateInput` has no `type` field,
     so a state's type can never be repaired through the API.
   - `IssueLabelCollectionFilter` has `every` and `some` but no `none`.
   - The retirement mutation is `issueLabelRetire`, not `issueLabelArchive`, and it leaves the
     label on cards that already carry it.
   - `Template.templateData` is typed `JSON` and documented as a JSON-encoded STRING, unlike
     `CustomView.filterData`, which is `JSONObject`.
   - Every collection returns 50 records a page by default. This board needs 76 labels alone, so
     an unpaginated read makes a second run look like work to do.
9. **On the `claude` orchestrator route, the coordinator session's own tool grants are an
   explicit per-script allowlist, not a blanket `node scripts/` permission.** The list is written
   in `scripts/julia-run.mjs`'s `startOrchestrator`; it grants both Linear tool namespaces, then
   Bash access to exactly these scripts, plus the bare `orca` CLI:

   ```
   mcp__linear__*, mcp__claude_ai_Linear__*,
   Bash(node scripts/orca-cli.mjs:*), Bash(node scripts/ready-queue.mjs:*),
   Bash(node scripts/seat-labels.mjs:*), Bash(node scripts/linear-cli.mjs:*),
   Bash(node scripts/check-readiness.mjs:*), Bash(node scripts/collect-worker-result.mjs:*),
   Bash(node scripts/verify-reviewer-worktree.mjs:*), Bash(node scripts/coordinator-events.mjs:*),
   Bash(node --env-file=/etc/orchestrator-svc/.env.publisher scripts/publish-pr.mjs:*),
   Bash(node scripts/publish-pr.mjs:*),
   Bash(node --env-file=/etc/orchestrator-svc/.env.publisher scripts/merge-pr.mjs:*),
   Bash(node scripts/merge-pr.mjs:*),
   Bash(orca *)
   ```

   `publish-pr.mjs` and `merge-pr.mjs` are granted **both** with and without the publisher
   env-file prefix (fixed 2026-09-22, "Seven findings" item 5 below has the incident) --
   a session calling either the plain relative-path form (matching every other script on this
   list) or the `--env-file` form reaches the script either way, and the script itself
   self-loads the credential file when it isn't already in the environment
   (`loadPublisherCredentialFile`), so neither form is missing the credential either. A script
   with no grant at all still cannot be run even though it sits in the checkout --
   `scripts/board-setup.mjs`, for example, has no grant yet. Adding a script to the skill's
   procedure means adding its grant in `startOrchestrator` in the same PR (see "The headless
   launch needs its own tool grants" below), **granted in the exact shape every session actually
   calls it** -- when in doubt, grant the plain relative-path form alongside any credential-
   prefixed form. `node -e` is NOT granted, and neither is `env`, `base64` or a `sudo` command. A
   coordinator that needs a one-off computation must use a granted script or an Orca terminal,
   not an inline node expression.

## Start

There is no scheduled trigger — explicit launch only. From inside an Orca terminal on the
`orchestrator-local` runtime (as `orchestrator-svc`), run:
```sh
node /srv/orchestrator-svc/julia-next/scripts/julia-run.mjs <ISSUE-ID>
```

**Getting into that terminal from a bare SSH session** (an `ubuntu` login, no Orca app open). A
fresh session used to have to dig these commands out of the CLI's own `--help`. Create the
terminal on the `orchestrator-local` runtime as `orchestrator-svc` and let it run `julia-run`:
```sh
sudo -u orchestrator-svc /opt/Orca/orca-ide terminal create --environment orchestrator-local \
  --worktree "path:/srv/orchestrator-svc/julia-next" \
  --command "node /srv/orchestrator-svc/julia-next/scripts/julia-run.mjs <ISSUE-ID>" \
  --title "julia-run-<ISSUE-ID>" --json
# Returns {"result":{"terminal":{"handle":"term_...", ...}}} -- read that handle back:
sudo -u orchestrator-svc /opt/Orca/orca-ide terminal read --environment orchestrator-local \
  --terminal <handle from above> --json
```
Poll `terminal read` until its tail shows a run id (success) or an error line (failure), followed
by the shell prompt returning. There is no useful `terminal wait` here: the terminal is a plain
shell that stays open after the command finishes, so `--for exit` only ever times out, and
`--for tui-idle` returns at once even mid-run (see "Seven findings carried from the cancelled
JUL-106", item 3). Both were seen on this box on 2026-09-20.

It refuses as any other account, runs readiness, self-heals a stale checkout, refuses a
double-start, then starts a real Orca Run/terminal that invokes the `julia-coordinator` skill
(`disable-model-invocation: true`, so it must be named explicitly there) for that issue. Prints
the run id on success, or which step failed and why on failure. Once started, the coordinator
posts its own admission comment and reconciles Orca + Linear state itself — see
`.claude/skills/julia-coordinator/SKILL.md` for that procedure. **`julia-run.mjs` itself no
longer posts a start comment (JUL-73):** the separate `claude -p` call that used to do this
(`defaultPostCommentImpl`/`postStartComment`) was a second vendor dependency doing no real work,
since the coordinator's own first wake already posts admission to Linear.

**The coordinator is a one-shot headless session, so it has to stay until its card is complete
or parked (found on JUL-106, 2026-09-20).** `julia-run.mjs` launches `claude -p
"/julia-coordinator <card>"`; that process exits as soon as the model's reply ends, and nothing
launches it again (there is no scheduled trigger, and the Ready queue only starts cards that are
not already in flight). The JUL-96 and JUL-106 coordinators each dispatched their builder and then
ended the reply, saying a background watcher would wake them ("a watcher will wake me when it
lands"; "I've armed a background wait ... so I get woken"). That wake-up exists only in an
interactive Claude Code window, so both left a card marked in flight with nobody supervising it,
and the queue then started nothing else. JUL-97's coordinator, launched the same way, stayed alive
for hours because it waited in the foreground (`orca terminal wait ... --timeout-ms 580000` in a
loop): the difference was what the model chose to do, not how it was launched. The coordinator
skill now says so in its own voice ("You are a one-shot session"). Symptom to look for: a card in
flight whose `julia-coordinator <card>` process is gone while its builder session is still open.

**The headless launch needs its own tool grants — `claude -p` exits 0 even when every tool call
was refused.** Found across two real live wakes, each diagnosing its own gap and reporting back
instead of silently doing nothing:
1. Launched with no `--allowedTools` at all, the coordinator could reach neither Linear nor
   Orca.
2. With dispatch/readiness scripts granted but not the publish path, a real ticket would build
   and review, then be refused at publish.

`julia-run.mjs`'s launch command now grants: `mcp__linear__*` and `mcp__claude_ai_Linear__*`
(both Linear tool namespaces — from this checkout's CWD, the coordinator sometimes reaches for
the hosted `mcp__claude_ai_Linear__*` connector instead of the standalone `mcp__linear__*`
server, so both are allowed); `Bash` access to the exact scripts the skill's "Each wake"/"Running
a step"/"After verification" procedures name (`orca-cli.mjs`, `check-readiness.mjs`, `collect-worker-result.mjs`,
`verify-reviewer-worktree.mjs`, `coordinator-events.mjs`); the publisher credential file for the
two scripts that need it (`publish-pr.mjs`, `merge-pr.mjs`); and the bare `orca` CLI. If the
skill's own procedure grows to need another script or tool, its `--allowedTools` list in
`scripts/julia-run.mjs`'s `startOrchestrator` needs the matching grant added in the same PR.

## Second vendor on the orchestrator seat (JUL-73, superseded by JUL-77)

**`ORCHESTRATOR_VENDOR` is retired.** `julia-run.mjs`'s `startOrchestrator` now reads
`graph/seat-table.mjs`'s `orchestrator` entry instead: `claude` (primary) or `pi-deepseek` (backup),
tried automatically on a detected usage-cap error rather than hand-edited. See "Seat-table
backups: Pi (JUL-77)" below for the table itself and the cap-detection/fail-over mechanism.
`codex` is no longer a valid orchestrator entry — the table reserves it for the **reviewer**
seat instead, so this section's Codex login/MCP-approval knowledge stays relevant, just for a
different seat. Both orchestrator launch branches (`claude`, `pi-deepseek`) share the same env prefix
(`ORCA_BIN`/`ORCA_ENVIRONMENT` export, then the publisher env file sourced with `set -a`/`set
+a`). Neither has a slash-command equivalent to Claude's, so each pipes the checkout's own
`.claude/skills/julia-coordinator/SKILL.md` text plus the issue id in on stdin — `codex exec -`
for the historical codex-as-orchestrator path (kept below for the reviewer seat's own launch,
built separately by the coordinator skill's worker dispatch, not by `julia-run.mjs`), and
`node ops/service-dropbox/run-pi-seat.mjs orchestrator-backup` for the table's Pi backup — always
reading the file live on the server at launch time, never a snapshot baked into this repo's JS.

**Codex logins, as `orchestrator-svc` (both headless, same shape as `claude mcp login linear` in
JUL-61 — a URL/code Todd completes in his own browser):**
```sh
codex login --device-auth   # prints https://auth.openai.com/codex/device + a one-time code
codex mcp add linear --url https://mcp.linear.app/mcp   # same MCP URL Claude already uses here
codex mcp login linear      # prints a https://mcp.linear.app/authorize?... OAuth URL
```
**The OAuth callback for `codex mcp login linear` listens on `127.0.0.1:<port>` on the server
itself**, so a browser running anywhere else (Todd's laptop) cannot deliver it directly — the
same class of problem noted elsewhere in this file for editing files across shell layers. After
Todd approves in his browser, he lands on a `127.0.0.1:<port>/callback/...?code=...&state=...`
page that fails to load; take that exact URL and `curl` it from the server (as `orchestrator-svc`)
to deliver the callback to the waiting process. The device-code/URL and the OAuth URL are both
single-use and time-limited (the device code expires in 15 minutes; the OAuth callback listener
times out on its own deadline, observed live at a few minutes) — if either expires before Todd
acts, kill the stale attempt and start a fresh one rather than reusing captured text.

**Codex's MCP tool-call approval gate blocks a write-classified MCP call under `workspace-write`,
even with `--ask-for-approval never`** (live-verified, JUL-73: `codex exec -s workspace-write`
reading via `linear/get_issue` worked, but `linear/save_comment` failed with "MCP tool call
requires approval, but approval policy is never" — the approval gate for a write tool isn't
satisfied by the approval-policy flag the way a shell command's is). This is Codex's own
per-write-tool confirmation, separate from the sandbox's file/network policy. Only `-s
danger-full-access` let the write through. There is no per-tool allowlist in Codex the way
Claude's `--allowedTools` provides, so `danger-full-access` is the closest real equivalent
available today — scoped to what it already means (this account, this repo, this account's own
credentials), not a broader bypass. If a future Codex version adds a narrower MCP-write grant,
prefer it over `danger-full-access` and update this note and the reviewer's worker-dispatch
launch (`.claude/skills/julia-coordinator/SKILL.md`, "Running a step") together.

## Seat-table backups: Pi (JUL-77)

**Pi was not installed anywhere on the server** as of 2026-09-18 — `worker-start`/`orca worktree
create --agent pi` accepts the id (no enum restriction; `--agent` is free text per `orca-cli`'s
own skill guide, "Known ids include `claude`, `codex`, `omp`, `pi`, `grok`"), but nothing was
there to launch. Installed globally: `sudo npm install -g --ignore-scripts
@earendil-works/pi-coding-agent` (binary: `pi`, v0.85.1 as installed). Live-verified:
`orca worktree create --repo path:/home/runner/julia-next --agent pi --no-parent --json` actually
spawns `pi` in the new worktree's terminal (`createdWithAgent: "pi"`, TUI drawn) — the probe
worktree/branch were removed after (`orca worktree rm --worktree name:<name> --force`).

**Config lives per-identity**, not in the repo: `~/.pi/agent/auth.json` (native providers) and
`~/.pi/agent/models.json` (custom providers), one pair per Linux account that runs Pi.

- **Builder backup — DeepSeek, native provider.** `~/.pi/agent/auth.json` for `runner`:
  `{ "deepseek": { "type": "api_key", "key": "$DEEPSEEK_API_KEY" } }` — the `"$VAR"` form
  interpolates the env var at resolution time (confirmed against the bundled
  `docs/providers.md`'s own "Key Resolution" section, not the public docs site, which is a
  different/newer version and gave the wrong `providers` shape below). Launch:
  `pi --provider deepseek --model deepseek-v4-flash -p "<prompt>" --mode json`, with
  `DEEPSEEK_API_KEY` set only in the child process's env (never argv) — see
  `ops/service-dropbox/run-pi-seat.mjs`. Live-verified real reply + real cost
  (`$0.00025844`, `deepseek-v4-flash`).
- **GLM was the orchestrator backup, and is removed (JUL-93, 2026-09-21).** It ran as a
  pay-per-use custom provider (`glm-5-3`, key in `ZAI_PAYG_API_KEY`). The seat, the drop-box
  field, the `zai-readers` group and the label are gone from the repo; the server side was removed
  by a laptop session and is recorded on JUL-93.
- **`pi`'s default provider is `google`** when `--provider`/`--model` are omitted — the first
  attempt at the DeepSeek proof hung (no output, no error) for exactly this reason; always pass
  both explicitly.
- Both secrets are read in-process via `ops/service-dropbox/read-secret.mjs`'s `readSecret()` and
  handed to the child only through `spawn`'s `env` option, never argv or a shell string — see
  that module's comment for the JUL-72 incident this guards against. **Do not `cat` a
  drop-box secret file directly to inspect it** — these are raw, non-`KEY=VALUE` tokens; a bare
  `cat` (rather than `readSecret()`) echoes the full value into whatever captured the command's
  output. Hit live during this same session; caught before it left this session's own scrollback,
  but treat it as a real near-miss, not a hypothetical.
- Cost is reported per response (`usage.cost.total`) for DeepSeek.
- **Pi's `models.json` is per-identity, not shared.** A provider entry written for
  `orchestrator-svc` does not exist for `runner`; any new Pi provider must be written for each
  identity that runs it. (The old `glm-5-3` entries were removed from both, JUL-93.)

### Long-running Orca daemons hold stale supplementary groups (JUL-44) — fixed 2026-09-18

*(Historical: this finding was recorded against the `zai` key. GLM and the `zai-readers` group were
removed in JUL-93, so read `zai` below as any reader group; the same trap applies to
`deepseek-readers` today.)*

`zai.env` is `root:zai-readers` mode `0440`, and `/etc/group` correctly lists
`zai-readers:x:1003:runner,orchestrator-svc`. Both `id runner` and `id orchestrator-svc` (NSS
lookups) show `1003(zai-readers)`. But inside a terminal spawned by either Orca daemon, the `id`
of the process itself shows only its primary group — `uid=1001(runner) gid=1001(runner)
groups=1001(runner)` — and `test -r /etc/orca-runner/dropbox-secrets/zai.env` fails.

**Cause:** both daemons (`orca-server.service`, `orca-server-orchestrator.service`) were started
BEFORE `zai-readers` was created on 2026-09-18, and the supplementary groups of a process are
fixed at start and inherited by every child.

**Consequence:** the `pi-glm` reviewer-backup and orchestrator-backup seats (as they were on
2026-09-18; `reviewer-backup` has been DeepSeek Pro since JUL-89) cannot read their own
secret from inside a dispatched terminal, even though the drop box is configured exactly as
`ops/service-dropbox/README.md` specifies. The JUL-77 "live-verified working" check for this seat
passed from a fresh SSH login (which gets correct groups) and so never exercised the path a real
dispatch actually uses.

**Fixed, live 2026-09-18:** `systemctl restart orca-server.service orca-server-orchestrator.service`
as root, between runs only (confirmed no worker/coordinator process was active first — the
restart kills every terminal those daemons own, so it must never happen mid-run). Verified from
inside a freshly Orca-spawned terminal afterward (not an SSH login — those differ):
```
id -> uid=1001(runner) gid=1001(runner) groups=1001(runner),1003(zai-readers)
test -r /etc/orca-runner/dropbox-secrets/zai.env -> readable
```
No `sg` wrapper needed or present anywhere in the repo's launch code (`run-pi-seat.mjs`,
`julia-run.mjs`, `SKILL.md`) — it was only a manual runtime workaround for the one run that hit
this, never baked into a script.

**General rule, still true:** after any `groupadd`/`usermod -aG` that a seat's secret access
depends on, restart both daemons before the next dispatch that needs it — a process's
supplementary groups are fixed at daemon start, not re-read live. Always verify secret access for
a seat by reading it FROM INSIDE an Orca-spawned terminal, never from an SSH login.

### Vercel auth is CLI login state, not a drop-box field (JUL-44)

There is no `vercel.env` in `/etc/orca-runner/dropbox-secrets/`. The fields actually present
there are `axiom`, `deepseek`, `linear`, `powersync`, `sentry`, and `supabase` (a `zai` file existed until JUL-93 removed it). Vercel is
authenticated instead through the stored credential of the CLI itself at
`/home/orchestrator-svc/.local/share/com.vercel.cli/auth.json` (mode `600`, owner
`orchestrator-svc`). Verified live 2026-09-18: `npx --yes vercel@latest whoami` as
`orchestrator-svc` returns `toddwyder-2186`. Do not go looking for a vercel drop-box field or add
one — check the CLI login state instead.

**Also note** the drop-box files are named `<field>.env`, NOT `<field>`. A readability probe
written against the bare field name returns a false "not readable" for every field; this cost
real time during the JUL-44 preflight before it was caught.

**`/home/orchestrator-svc/julia-next` is not a real checkout — ignore it.** Only
`/srv/orchestrator-svc/julia-next` (read-only, synced) and `/home/runner/julia-next` (writable,
worktree base) are the checkouts `julia-next-checkout-sync.sh` and `julia-run.mjs`'s `CHECKOUT`
constant actually manage. `/home/orchestrator-svc/julia-next` is a stale leftover (found stuck at
`cb4fd90`, JUL-43-era, 25+ commits behind) that happens to exist and happens to run — it cost real
time this session before the mistake was caught. `publish-pr.mjs`/`merge-pr.mjs` must run from
`/srv/orchestrator-svc/julia-next`, never this path.

**The checkout-sync service (`julia-next-checkout-sync.timer` → `.service` →
`/usr/local/sbin/julia-next-checkout-sync.sh`) was silently broken** — found failing live this
session (`fatal: Not possible to fast-forward, aborting`) on its `runner`-checkout leg. Root
cause: `/home/runner/julia-next` (the writable base checkout every worker worktree forks from)
had one stray commit on its local `main` directly — `6329f4f`, an uncommitted-to-GitHub duplicate
of what later landed properly as `105ad83`/PR #29 — blocking every fast-forward since. The
script's own comment says this checkout is "never committed to directly," so this was a real
violation of that invariant, not a design gap. Fixed by resetting `/home/runner/julia-next`'s
`main` to `origin/main` (confirmed the stray commit's content was a strict subset of what
`origin/main` already carried, so nothing was lost) and re-running the sync service successfully.
**Any session touching this runner going forward should confirm the sync timer is still green**
(`systemctl status julia-next-checkout-sync.timer`) rather than assume it — this had apparently
been broken long enough for both checkouts to drift 25+ commits behind before anyone noticed.

### The checkout-sync service could leave the base checkout's `main` stale while exiting 0 (JUL-44) — fixed 2026-09-18

Found live 2026-09-18: the timer was active and the service ran successfully, yet the local
`main` of `/home/runner/julia-next` sat at `ac73112` while `origin/main` was `31e89e1` — 8
commits behind, 0 ahead (a clean ancestor, no divergence). The HEAD of that base checkout was on
branch `jul72-safe-secret-read`, which already equalled `origin/main`, so the fast-forward in the
sync succeeded vacuously against the CURRENT branch and never advanced the `main` ref itself.
This is worse than the loud "fatal: Not possible to fast-forward" failure this runbook already
records, because it exits 0 and looks healthy.

**Why it matters:** `orca worktree create --base-branch main` forks every builder worktree from
the `main` ref. A stale `main` silently hands the builder 8-commit-old code — on 2026-09-18 that
would have produced a worktree with no `graph/seat-table.mjs` and no
`ops/service-dropbox/run-pi-seat.mjs`, the very files that run depended on. Repaired by hand
in the moment (`git fetch origin main` + `git branch -f main origin/main`, safe because it was a
clean ancestor) — but the script itself was still broken for the next time HEAD parked on a
non-`main` branch.

**Real fix, landed:** the old root-owned, untracked `/usr/local/sbin/julia-next-checkout-sync.sh`
is replaced by `scripts/checkout-sync.mjs` (tracked, tested — `scripts/checkout-sync.test.mjs`
pins the exact failure mode above as a regression test). Its `advanceMainRef` only takes the
`merge --ff-only` path when `main` is genuinely the checked-out branch; any other branch
(including detached HEAD) fetches straight into the local `main` ref
(`git fetch origin main:main`), which git applies unconditionally precisely because `main` isn't
checked out there — no vacuous success possible. The orchestrator checkout's leg
(`resetOrchestratorCheckout`) is unchanged in behavior (`reset --hard` is always safe there; it's
never committed to directly). The systemd service's `ExecStart` now runs `node
/srv/orchestrator-svc/julia-next/scripts/checkout-sync.mjs` — **note this must point at the
read-only `/srv/...` checkout's own copy of the script, not a worktree's, since the unit runs as
root outside any dispatched worktree.** The old shell script was removed.

If a stale `main` is ever suspected anyway (do not assume a green timer alone means current):
```sh
git -C /home/runner/julia-next rev-list --count main..origin/main
```
must print 0. A nonzero count with `rev-list --count origin/main..main` also 0 is now a bug in
`checkout-sync.mjs` to fix and log, not something to hand-repair again.

**Orchestrator launch and cap fail-over (Build item 3, `scripts/julia-run.mjs`).**
`startOrchestrator` reads `SEAT_TABLE.orchestrator` and starts the primary entry
(`orchestratorLaunchCommandFor`), then calls `waitForEarlyCapError` on that terminal: a bounded
(`45s` default) `terminal wait --for tui-idle` followed by `terminal read`, checked against
`CAP_ERROR_PATTERN`. A `terminalWait` timeout is *not* treated as a cap or any other kind of
failure — it means the session is still running normally past the check window, and is left
alone. Only an actual pattern match starts a second run/terminal on the backup entry, same
objective (`startOrchestratorEntry` called twice, never more — the table has exactly one backup
per seat, not a chain). `CAP_ERROR_PATTERN` is built from Codex's real, live-captured cap text
this session plus the other vendors' documented phrasing; Claude Code's own exact cap text was
never observed live this week (no session in this project's record hit one), so that part of the
pattern is unverified — a real example should replace the guess the first time one is seen.

### A PR title naming a Linear issue closes that issue on merge (JUL-44)

**Linear's GitHub integration auto-links any PR whose TITLE contains an issue identifier, and
moves that issue to Done when the PR merges.** The link is title-based, not body-based, and it
does not require a closing keyword.

This closed JUL-44 twice while all four of its acceptance criteria were still unticked. The two
verified instances are PR #21 (merge commit 7cda4a9, merged 2026-09-17T13:03:48Z; JUL-44 moved
to Done at 2026-09-17T13:03:52Z, 4 seconds later) and PR #37 (merge commit 2ed3f6f, merged
2026-09-18T14:35:55Z; JUL-44 moved to Done at 2026-09-18T14:35:58Z, 3 seconds later). Neither
PR was the ticket's final step, but both carried `JUL-44` in the title, so Linear treated each
merge as completion. PR #38 (merge commit 5aa7345, merged 2026-09-18T14:55:19Z) is not a
verified instance: JUL-44 was already Done at that moment (it stayed Done from 14:35:58Z until
the coordinator moved it back to In Progress at 15:02:15Z), so no state change can be
attributed to that merge.

Because a multi-step item gives every step's PR the item's own id, **the coordinator must
re-assert the issue's real state after EVERY step merge rather than trusting it** — a Done
status is not evidence that the item is actually finished.

Do **not** fix this by dropping the id from PR titles: the id in the title is what provides
traceability from a merged PR back to its issue. Do **not** fix it by changing the Linear
workspace's own settings — an agent must never change Todd's service-account settings.

## Auto-close is a two-way trap, and effort translation (JUL-79 step 3)

### A PR referencing an issue identifier moves the card on OPEN, not just on merge

Live-observed 2026-09-18/19 on this very ticket, which sharpens the merge-only picture in the
section above: **opening a PR whose identifier-reference (observed via the title) names an issue
moves that issue to In Progress, and merging it moves the issue to Done.** PR #41 (title `JUL-79:
...`) opened at 22:12:36 and the JUL-79 card was In Progress by 22:12:46 (10s); the PR merged at
22:16:28 and the card was Done at 22:16:30 (2s). Neither transition required a closing keyword or
a body field.

**Consequence for a multi-step item:** every step's PR carries the item's own id, so merely
opening step N's PR moves the card to In Progress and merging it moves the card to Done — even
when the item is not finished. This is now a second reason (the merge close in the section above
is the first) that **the coordinator must reconcile the issue's real state back after EVERY
step-merge**, not just re-read it: while more steps remain, move the card back to In Progress
after the merge so the board does not lie. A Done status is never by itself evidence the item is
finished. The same two "do not fix this" rules apply: keep the id in PR titles for traceability,
and never touch Todd's Linear workspace settings.

### Effort translation and the new launcher/seat entries

The ticket's one Low/Medium/High choice is translated to each vendor's own spelling by the pure
`scripts/effort.mjs` (`translateEffort(entry, effort)`, an argv array). Omitted or unrecognized
effort is **Medium** — the stated default — and an unknown *entry* throws, exactly like
`orchestratorLaunchCommandFor`. The mappings, each flag spelling live-verified against the
vendor's own CLI:

| seat-table entry | Low | Medium / High |
| --- | --- | --- |
| `claude` | `--effort low` | `--effort medium` / `--effort high` |
| `codex` | `-c model_reasoning_effort=low` | `-c model_reasoning_effort=medium` / `...=high` |
| `pi-deepseek` | `--thinking off` | `--thinking medium` / `--thinking high` |

`pi --thinking` REQUIRES a level (`off|minimal|low|medium|high|xhigh|max`). Low is `off`; Medium/High
pass `medium`/`high`. **A bare `--thinking` is a bug** (fixed 2026-09-19, JUL-79 relaunch): Pi reads the next
argument as the level, swallowing `-p`, and the coordinator prompt — which starts with the skill's `---`
front matter — is then rejected as `Error: Unknown option: ---`. The seat died at launch, silently (Pi
exits with no useful status in a terminal). The prompt is now always the last argument, after a `--`
separator, so it can never be read as an option. A one-word test prompt hides this bug — always test a
seat launch with the real skill text.

**Launcher (`scripts/julia-run.mjs`, `orchestratorLaunchCommandFor(entry, issueId, { effort })`).**
Two entries are new alongside `claude`:

- `codex` — stdin-pipe shape, same preamble as the Pi route: `{ cat
  .claude/skills/julia-coordinator/SKILL.md; printf ...; } | codex exec - -s danger-full-access
  <codex effort args>`, under the shared `ENV_PREFIX`. `-s danger-full-access` is the ONLY sandbox
  level under which Codex's per-write MCP approval gate lets Linear write-classified tool calls
  through (live-verified JUL-73; Codex has no per-tool allowlist). Note `orchestrator-svc`'s Codex
  login is usage-capped until Sep 19, 2026, so don't attempt a live Codex orchestrator run yet.
- `pi-deepseek` — the Pi route: the same stdin-pipe shape, invoking the `orchestrator-deepseek` seat.

Both existing entries gained effort too: `claude` inserts `--effort <level>` right after
`--permission-mode acceptEdits` (the `--allowedTools` grant list is untouched), and the Pi routes
pass the neutral `--effort <level>` label to `run-pi-seat.mjs` rather than a Pi flag, so the
launcher never has to know which vendor a seat fronts. Omitted effort makes the command identical
to an explicit `medium`.

**Seat (`ops/service-dropbox/run-pi-seat.mjs`).** New `orchestrator-deepseek` seat: DeepSeek
provider, `deepseek-v4-flash`, same `deepseek` secret field / `DEEPSEEK_API_KEY` env var as
`builder-backup` (the seat name carries the semantics; the duplicated config is deliberate so one
seat's model can never move silently with the other's). `buildPiSpawnSpec`/`runPiSeat`/the CLI
(`<prompt> | node run-pi-seat.mjs <seat> [--effort low|medium|high]`) accept effort for **all**
seats, so builder/reviewer Pi dispatches can carry it too. The secret invariant is untouched: the
secret is read in-process via `read-secret.mjs` and injected only through `spawn`'s `env`, never
argv or a shell string.

### The `orchestrator-deepseek` seat could not read its own secret (step-3 review finding) — fixed in the JUL-79 laptop session below

Resolved: see "`deepseek-readers`" in the JUL-79 laptop-session section below. The step-3 review
found that the `pi-deepseek` orchestrator route reads the `deepseek` drop-box field, which
`FIELD_GROUPS` then mapped to `runner` only; the fix (a `deepseek-readers` group holding `runner`
and `orchestrator-svc`, the file re-grouped, both Orca daemons restarted) was done in that session.

## Seat labels, the restart-after-finish guard, and relay reachability (JUL-79 step 5)

### The twelve label groups and the label-name convention

**Rewritten 2026-09-21 (JUL-97 step 2): the BOARD's six-agent vocabulary won and the code follows
it.** The card's model/effort choices are **twelve** Linear label groups, one label per group: a
`<Agent> model` and an `<Agent> effort` group for each of the board's six agents —
`Feature builder`, `Defect fixer`, `Refactor`, `Adversarial reviewer`, `Evidence reviewer`,
`Consultant`. The label names follow a fixed convention, and **code is the source of truth**:
the coordinator creates the matching Linear labels from `scripts/seat-labels.mjs`, never from a
hand-maintained list. No live label name was renamed — cards already carry them.

- Model labels: `<code>-<vendor>-<model>`, with `<code>` one of
  `builder`/`fixer`/`refactor`/`adversary`/`evidence`/`consultant` (`builder-` is the **Feature
  builder's** prefix). Initial catalogue: `claude-opus`, `claude-sonnet`, `claude-haiku`, `codex`,
  `deepseek-pro`, `deepseek-flash` — e.g. `builder-deepseek-flash`, `adversary-codex`,
  `consultant-claude-opus`. (`glm-5.3` was removed in JUL-93, and since JUL-97 step 2
  `board-setup.mjs` retires any `*-glm-5.3` label still sitting in a spec'd group.)
- Effort labels: `<code>-effort-low` / `-medium` / `-high`, e.g. `adversary-effort-medium`.
- **The reviewer's first choice is DeepSeek Pro, its backup Codex (JUL-98, Todd's 21 Sep decision,
  to protect the weekly Codex and Claude quotas; a DeepSeek review costs about half a cent).**
  `graph/seat-table.mjs` has `reviewer` and `adversarial-reviewer` as `pi-deepseek` then `codex`; the
  builder stays Claude. A card that names no reviewer model resolves to `adversary-deepseek-pro`
  (`defaultModelSuffix` in `scripts/seat-labels.mjs`, and the team template's default label), which is
  the model the `reviewer-backup` route in `run-pi-seat.mjs` really runs. The evidence reviewer is not
  part of this decision and is still Codex first.
- **A capped builder no longer stalls the card, and there is nothing to do by hand** (JUL-98 step 2,
  2026-09-21). When the builder falls back to its DeepSeek backup while the reviewer is also on
  DeepSeek, `fallbackSeatChoice` in `scripts/seat-labels.mjs` now moves the **reviewer** to its own
  backup (`adversary-codex`) automatically and reports the move in `partnerMoved` /
  `partnerMovedReason`. `runControllerCheck` (`graph/controller/core.mjs`) calls
  `fallbackSeatChoice` when it is told which seat is capped (`cappedSeat: 'builder'|'reviewer'`) and
  posts `partnerMovedReason` verbatim as exactly one comment on the card it is starting -- and only
  when a partner actually moved; a fallback that needed no partner move says nothing. If the
  fallback is refused, the check returns `seat-refused` and the card stays in Ready, uncommented and
  unmoved. The same move happens symmetrically for a capped reviewer whose backup would collide. It never invents an entry (the
  partner's backup comes from the same seat table) and never launches a same-family pair: if the
  partner's backup does not resolve the collision, the fallback is still refused. Pass
  `{ movePartner: false }` for the old strict answer. `seat-labels.mjs fallback --seat builder
  --reviewer pi-deepseek` now prints the pair to dispatch, the seat it moved (`partnerMoved`) and the
  one-sentence reason (`partnerMovedReason`, the same sentence the controller posts), instead of
  exiting non-zero. *(The by-hand step that used to live here -- "move the reviewer to `adversary-codex` on
  the card first, then fall back the builder" -- is gone: it is done automatically.)*
- **The old three-seat vocabulary is gone**: there is no `Orchestrator`/`Builder`/`Reviewer` model
  or effort group and no `orch-` prefix. The two Orchestrator groups are retired on the board
  (`RETIRED_LABEL_GROUPS` in `graph/board-spec.mjs`), which keeps them on the cards that carry
  them and only stops new applications.
- **The two seat names the coordinator dispatches are unchanged.** `builder` and `reviewer` are
  still the names `worker-start`, `validateFamilyChoice`, `fallbackSeatChoice` and
  `seat-labels.mjs fallback --seat <seat>` use; they now resolve to the Feature builder and the
  Adversarial reviewer respectively (`DISPATCH_SEATS` in `scripts/seat-labels.mjs`). Wiring all
  six seats into dispatch is JUL-102, not done here.

`scripts/seat-labels.mjs` is pure (no I/O) and exports the group names, the label-name constants,
and `MODEL_CATALOG` (each model label → the `SEAT_TABLE` entry it means, plus the vendor's model
id where the route needs one). A later coordinator/launch step extends `MODEL_SPECS` there when a
vendor ships a new model. `resolveSeatChoices(labels)` returns each seat's `{ entry, effort,
modelLabel }`: a present model/effort label wins, an absent model falls back to the seat table's
`primary` and its default model (`claude`→`claude-opus`, `codex`→`codex`,
`pi-deepseek`→`deepseek-flash`), and an absent effort is Medium.
`validateFamilyChoice` enforces builder family ≠ reviewer family (via `FAMILY_OF`) — that is the
dispatched pair, i.e. Feature builder vs Adversarial reviewer — and that every one of the six
resolved entries is a real seat-table entry, so a leftover `*-glm-5.3` label refuses the card
whichever of the six prefixes carries it. `seatChoicesForIssue(issue)` is the read-only helper
the coordinator calls on a card it fetched through `linear-cli.mjs` (whose `getIssue` now requests
`labels { nodes { name } }`). The Ready queue fills any missing model/effort label (default +
Medium) before starting a card — **twelve** of them for a card carrying none; a label not yet
created on the team is skipped and logged, never an error. Since JUL-97 step 2 the queue reads
the team's labels through every page of the connection (the team holds 88 and Linear returns 50 a
page), so an existing label is no longer reported as missing.

### The restart-after-finish gap, fixed with two belts

The gap: nothing moved a started card out of Ready, and the double-start guard only held while a
run was active — a finished run whose card was still in Ready would be started again, forever.
`scripts/ready-queue.mjs` now has both belts:

1. **State move.** After a successful start the queue sets the card's workflow state to the
   team's `In Progress` state through the injected Linear client (`findState` + `setIssueState`). A
   failure here is logged (`could not move <ID> out of Ready`) but never undoes the start.
2. **Per-issue start cooldown.** The queue still records every start in `started`, a map keyed by
   issue id (the start fingerprint of labels/state/blockers + whether the state move succeeded) and,
   before anything else in the next cycle, refuses to start a card whose own record matches its
   current fingerprint (`status: 'cooldown'`). The map replaced a single `lastStarted` record on
   2026-09-21 (JUL-97 step 2): now that the queue walks past a card and starts a later one,
   a single record meant starting the later card erased the earlier card's cooldown and the earlier
   card restarted forever. An old single-record state file is migrated into the map on read
   unconditionally (`startedRecords`): the one card the old file knew about keeps its record —
   `stateMoved` included — under its own id. The **failed** state move is the cooldown guard's
   condition, not the migration's: the guard holds a card only when its record says the state move
   failed *and* the fingerprint still matches. The fingerprint purposefully includes the labels the queue itself added, so a card Linear now returns with those
   labels still matches and is held; a genuinely changed card gets a new fingerprint and is allowed
   through. When the state move succeeded the card really left Ready, so its reappearance in Ready
   is a deliberate re-queue and is admitted normally.

Together they mean the exact live failure mode — run finished, card still in Ready because the
state move failed — cannot start the card twice.

### A coordinator process ON the runner reaches the relay directly

Verified live in the coordinator session that dispatched JUL-79 step 5: a coordinator process
running **on the OVH runner as `orchestrator-svc`** reaches the journey relay at
`127.0.0.1:8943` **directly**, and the emitted event came back `sent:true`. The "emit from a
plain diagnostic terminal on the OVH runner" indirection in
`.claude/skills/julia-coordinator/SKILL.md`'s Journey-accounting section is therefore only needed
when the coordinator runs **off-box** (e.g. a laptop session); an on-box coordinator can call
`scripts/coordinator-events.mjs` itself. The SKILL.md text still describes the off-box route and
is not changed by this step.

## Five JUL-79 step 8 facts, each verified live 2026-09-19

Each of these was learned on the box and would silently mislead a fresh session; the date is the
day it was verified, not the day it was written down.

**(a) A spent Z.ai (GLM) balance is invisible unless the JSON stream is read.** With no balance, a
Z.ai seat returns `429 {"code":"1113","message":"Insufficient balance or no resource package.
Please recharge."}` on every call; Pi retries three times, settles, and exits 0 with empty stderr.
The vendor error appears only inside `--mode json`. Verified 2026-09-19, captured twice. The fixes
are `scripts/julia-run.mjs`'s `CAP_ERROR_PATTERN` (which now recognises that wording) and
`ops/service-dropbox/run-pi-seat.mjs` (which now exits non-zero and prints the vendor error to
stderr when the final assistant turn ends in a vendor error).

**(b) The journey relay is reachable directly from an on-box coordinator.** `127.0.0.1:8943` is
reachable DIRECTLY from a coordinator process running on the box as `orchestrator-svc` from
`/srv/orchestrator-svc/julia-next` -- confirmed 2026-09-19 by a `coordinator_started` emit
returning `sent:true`, with no diagnostic-terminal indirection. The terminal-on-runner
indirection the coordinator skill describes is only needed when the coordinator runs OFF the box.

**(c) `julia-run.mjs` binds the Orca run to the LAUNCHER terminal, not the orchestrator terminal
it opens.** So the run's `coordinator_handle` is not the terminal the orchestrator runs in, and
`worker-start --from $ORCA_TERMINAL_HANDLE` fails with `consumer_fenced`. Until the launcher is
fixed, a fresh orchestrator must run `orca orchestration run-use --id <run id> --from <its own
terminal handle>`. Verified working 2026-09-19.

**Extended 2026-09-21 (JUL-97): this is now the NORMAL case, not the fresh-orchestrator case.**
A coordinator launched by the Ready queue is not the bound consumer of its own Run either -- the
queue creates a terminal that runs `julia-run.mjs`, so the binding lands on that launcher terminal
exactly as above. Every queue-launched coordinator must therefore run, before its first
`worker-start`:

```sh
orca orchestration run-use --environment orchestrator-local --id <runId> --from <its own terminal handle>
```

Skipping it fails `consumer_fenced` on the first dispatch, which reads as a permissions problem
and is not one.

**(d) `ORCA_TERMINAL_HANDLE` is not set in a Claude orchestrator started by `julia-run.mjs`.** So
`orca orchestration run-current` fails there, and every orchestration command needs an explicit
`--from`. Verified 2026-09-19.

**(e) No repo command READS the GitHub API with the publisher token.** `publish-pr.mjs` only
pushes and opens; `merge-pr.mjs` only merges and does not check mergeability; `gh` on the server is
deliberately unauthenticated. The coordinator therefore cannot read a PR's `mergeable_state` and
relies on the merge API refusing a non-mergeable PR. Noted 2026-09-19 as a known gap.

## Six JUL-97 step 2 discoveries (verified 2026-09-21)

Each was established live while building JUL-97 step 2. Two of the six extend facts this runbook
already carried rather than adding new ones; both say so and point at the passage they extend.

### 1. A queue-launched coordinator must bind its own Run first

**Already recorded, extended in place.** See "(c) `julia-run.mjs` binds the Orca run to the
LAUNCHER terminal" above: the fresh-orchestrator case is now the ordinary one, because the Ready
queue launches every coordinator the same way. The `run-use` line is there.

### 2. `run_not_found` on an orchestration command is the wrong daemon, not a missing Run

**Already recorded in part, extended here.** "The coordinator's `ORCA_ENVIRONMENT` is the wrong
daemon for orchestration" below already says `run-use`/`worker-start` need
`--environment orchestrator-local` and `--on ovh-local`. The new fact, verified 2026-09-21, is the
error an omission produces and why: `scripts/julia-run.mjs` exports `ORCA_ENVIRONMENT=ovh-local`
into the coordinator's shell, so `scripts/orca-cli.mjs` defaults **every** orchestration command
to the runner's daemon, where the Run does not exist -- and the command fails `run_not_found`,
which reads as "the Run is gone" when the Run is fine and merely lives on the other daemon. The
split to remember: **orchestration** commands need an explicit `--environment orchestrator-local`;
**worker** and **terminal** commands on the runner need `ovh-local`.

### 3. `worker-stop` and `worker-list` reject `--from`

Unlike `worker-start` and `run-use`, which require it, `orca orchestration worker-stop` and
`orca orchestration worker-list` **reject** `--from` outright. `worker-list` takes `--run`. Passing
the flag out of habit turns a recovery step into an argument error in the middle of an incident.

### 4. Only a step dispatched as a supervised worker can be timed

Orca Task records carry `created_at` and `completed_at`, so a step dispatched through
`worker-start` can be timed exactly. A run driven through plain terminals creates no Task and
therefore leaves **no timing record at all** -- not an imprecise one, none. Concretely: JUL-97's
own 2026-09-19/20 run has zero Tasks, so none of its nine build attempts can be timed, and any
duration quoted for them would be invented. If a step's duration will be asked for, it has to be
dispatched as a supervised worker.

### 5. The coordinator's granted command list refuses the documented `check-readiness` invocation

`scripts/julia-run.mjs`'s `--allowedTools` list allows `Bash(node scripts/check-readiness.mjs:*)`
but **not** the `node --env-file=/etc/orchestrator-svc/.env.publisher scripts/check-readiness.mjs`
form this runbook's own Bootstrap section shows. The `--env-file` prefix makes it a different
command, so in an unattended run the documented invocation is refused. **Use the plain form**
(`node scripts/check-readiness.mjs`) in a coordinator run; the `--env-file` prefix is for a
laptop or interactive session, where it is granted by hand.

**`publish-pr.mjs` and `merge-pr.mjs` are now granted in both forms (JUL-98 step 6, fixed
2026-09-22 ~13:2xZ).** They used to be granted with the `--env-file` prefix only, which is the
same trap as `check-readiness.mjs` above, pointed the other way: the JUL-98 step 6 round 3
coordinator (13:0xZ) called `node scripts/publish-pr.mjs push ...` -- the plain form, matching
the pattern every *other* granted script uses -- and the Bash permission matcher refused it
outright, because that exact literal prefix had no grant. The push never ran; the round's work
sat on the runner's disk, parked, until a laptop session diagnosed it (compare the transcript
`"command":"node scripts/publish-pr.mjs push ..."` against the grant list of the session before
it, which used the `--env-file` form and pushed fine). The **root cause was the same shape as
the 04:37Z brace-group finding below ("Laptop session: relaunched twice...")**: an exact-literal-
prefix permission grant refuses any invocation shape it wasn't written for, and nothing forces a session
to remember which shape a given script needs.

The fix has two parts, both merged in the same PR as this runbook entry -- fixing only the grant
list would have left the credential itself still silently absent for the plain form, and fixing
only the credential loading would have left the plain form refused before it ever reached that
code:

1. **The grant list now allows both invocation shapes** for `publish-pr.mjs` and `merge-pr.mjs`:
   `Bash(node --env-file=/etc/orchestrator-svc/.env.publisher scripts/publish-pr.mjs:*)` AND
   `Bash(node scripts/publish-pr.mjs:*)` (same pair for `merge-pr.mjs`) -- see
   `orchestratorLaunchCommandFor` in `scripts/julia-run.mjs`.
2. **Both scripts now self-load the credential file** (`loadPublisherCredentialFile` in
   `scripts/publish-via-github-app.mjs`, called before `main()`) when it is not already in the
   process's environment, using `node:util`'s `parseEnv` -- the same parser Node's own
   `--env-file` flag uses, so a value it reads matches what `--env-file` would have produced,
   including a PEM private key's embedded newlines. An explicit `--env-file` or a pre-set env var
   still wins; this only fills a gap, never overwrites. In practice `julia-run.mjs`'s own
   `ENV_PREFIX` already sources `/etc/orchestrator-svc/.env.publisher` into the coordinator's
   shell before `claude` starts (`set -a; . <file>; set +a`), so the plain form already worked at
   the process-environment level once the grant itself stopped refusing it -- the self-load is
   belt-and-suspenders for any future invocation shape that does not inherit that shell (a bare
   `node scripts/publish-pr.mjs ...` run some other way).

Both `publish-pr.mjs`/`merge-pr.mjs` and any future script added to the grant list should be
granted in the exact form every session actually calls it -- when in doubt, grant the plain
relative-path form (matching the majority of the list) alongside any credential-prefixed form,
rather than assuming a session will remember to type the longer one.

### 6. "The board already matches the spec" could be true while the board offered a removed model

`scripts/board-setup.mjs` only ever ADDED labels a spec'd group was missing, so a label sitting in
a group the spec names that the spec no longer names was left alone -- and the program still
printed `board-setup: the board already matches graph/board-spec.mjs; no changes`. That is why the
live board still carried `builder-glm-5.3`, `fixer-glm-5.3`, `refactor-glm-5.3`,
`adversary-glm-5.3`, `evidence-glm-5.3` and `consultant-glm-5.3` after GLM was removed in JUL-93:
six model choices Todd could pick that could never run, with the setup program reporting the board
clean. JUL-97 step 2 closes it: a child of a spec'd group that the spec does not name is retired
(`issueLabelRetire`, never deleted, so cards keep showing it), planned and printed as its own
action. A group the spec does NOT name is still untouched. Read a "no changes" from before
2026-09-21 with that blind spot in mind.

## Three JUL-44 step-4 discoveries (verified 2026-09-18/19)

### `vercel project add` leaves framework `null`, so a Next.js deploy is treated as static

**Verified 2026-09-18.** `vercel project add <name>` creates the project with its framework set
only when the local directory it is run against carries a detectable framework preset. For a bare
project created this way the framework stays `null`, Vercel then treats the Next.js app as a static
site, and the deploy fails with `No Output Directory named "public"` (a Next.js app never emits a
`public/` build output directory). The project exists and looks healthy, but every deploy fails.

Two correct routes, pick one and never mix them:

- **Let the first deploy create the project** (run `vercel deploy`/`vercel --prod` without a prior
  `vercel project add`), so Vercel detects `nextjs` itself; or
- **Explicitly set the preset** on an existing project:
  `PATCH https://api.vercel.com/v9/projects/<name>` with body `{"framework":"nextjs"}` (CLI
equivalent: `vercel project` does not expose this — use the REST API with the stored CLI login).

**Never `project add` and then deploy without setting the preset** — the deploy is guaranteed to
fail with the `No Output Directory named "public"` error above, and the failure message points at
the build output rather than at the missing framework, so it reads as an app bug.

### A coordinator run can finish without reporting, and the next wake must recover from live Orca

**Verified 2026-09-19.** A coordinator run can dispatch its workers, watch them finish, and then
end **without posting its outcome** to Linear or emitting a `coordinator_completed`/`_failed`
event. The card then sits in whatever state the last write left it, and nothing on the board says
the run is over.

**Recovery (the next wake does this, from live Orca — do not infer state from the last comment):**

```sh
orca orchestration run-list                      # find the run id
orca orchestration task-list --run <run id>      # see every worker it dispatched and their status
orca worker-show <worker id>                     # read the worker's own final state/output
```

Then reconcile: a worker whose work is done and verified but whose outcome never got reported is
**not** a completed step until the coordinator re-checks its evidence and writes the outcome
itself. Do not trust a prior session's claim; re-derive the run's real state from these three
commands.

### Interactive-launch publisher-grant gap

**Verified 2026-09-19.** `scripts/julia-run.mjs` launches the coordinator with an explicit Claude
`--allowedTools` list that includes the publisher credential file for `publish-pr.mjs` and
`merge-pr.mjs`. A coordinator launched **interactively** (a human-started Claude session, or any
launch path that is *not* `julia-run.mjs`) does **not** inherit those grants — so when it reaches
the publish step it is refused, even though the same run started headlessly would have been
allowed to publish. The work can build and review and then stall at publish for no reason visible
in the run's own output.

**Workaround:** invoke `publish-pr.mjs`/`merge-pr.mjs` only either

- from the headless `julia-run.mjs` launch (which owns the grant), or
- from an interactive session **with an explicit grant** for the publisher credential file
  (`/etc/orchestrator-svc/.env.publisher`) for those two scripts only.

This is a real gap, not a documentation nicety: do **not** paper over it by re-running the publish
through an ungranted interactive session, and do not widen the interactive session's grants beyond
the two publisher scripts to compensate. If the interactive path must publish, add the exact grant;
otherwise escalate the run to the headless launcher.

## Five JUL-44 step-5 discoveries (verified 2026-09-19)

Each of these was learned while dispatching and provisioning JUL-44 step 4 and recorded here in
step 5; the date is the day it was verified, not the day it was written down.

### `worker-start --agent claude` can start a dead worker

`orca orchestration worker-start --agent claude ...` can create an agent terminal that never
reports a session — `worker-read --source auto` returns `fallbackReason: session_not_reported`,
the terminal shows only the launch command, and no report is ever produced (observed: 15 minutes,
no output).

Recovery: `orca orchestration worker-stop --environment orchestrator-local --dispatch
<dispatchId>`, then re-dispatch the same reviewer through the **headless** route instead: create a
worktree and a terminal whose command pipes the spec into `claude --model claude-sonnet-5
--effort medium --dangerously-skip-permissions -p "$(cat <specfile>)" > <reportfile> 2>&1`. That
headless route produced the review.

### The coordinator's `ORCA_ENVIRONMENT` is the wrong daemon for orchestration

The coordinator shell has `ORCA_ENVIRONMENT=ovh-local` (the builder daemon), but the coordinator
terminal lives on `orchestrator-local`. So `orca orchestration run-use` / `worker-start` must pass
**`--environment orchestrator-local`** (the coordinator's own daemon, where the Run lives) **and**
`--on ovh-local` (the worker's daemon). Without this, `run-use` fails `stable_pane_required` and
`worker-start` fails `no_active_sender_terminal`. Bind the Run to this terminal once with:
```sh
orca orchestration run-use --environment orchestrator-local --id <runId> --from "$ORCA_TERMINAL_HANDLE"
```
then dispatch with `--from "$ORCA_TERMINAL_HANDLE" --run <runId> --environment orchestrator-local
--on ovh-local`.

### Creating a PowerSync *project* cannot be done headlessly today

`POST https://accounts.powersync.com/api/accounts/v5/apps/create` exists and its required body is
`{org_id, name, default_region, vcs_mode: "BASIC"|"ADVANCED", source: {type:
"INTERNAL"|"GITHUB"|"AZURE_DEVOPS", properties: {id}}}` (validation order observed: missing
`default_region`/`vcs_mode`/`source`, then `source.type` enum, then `source.properties.id`
required). With `source.type: "INTERNAL"` and any `id`, the PowerSync PAT gets `422 FORBIDDEN`.
The CLI (`npx powersync link cloud --create`) requires an **existing** `--project-id` and cannot
create the project. Therefore creating the project currently needs the PowerSync dashboard.
Supporting commands: `GET https://powersync-api.journeyapps.com/api/v1/regions` lists regions
(`eu`,`us`,`jp`,`au`,`br`,`dev`); the org id comes from running the CLI `fetch instances --output
json` with `PS_ADMIN_TOKEN` set (observed org `toddwyder` with **no** projects).

### An Axiom ingest-only key cannot prove delivery by reading events back

`POST /v1/datasets/_apl` and the legacy query route both return `403 token does not have access to
resource: query with action: read`. Prove delivery with (a) the ingest receipt
(`{"ingested":1,"failed":0}`) and (b) the absence of the app's own `console.warn('julia-next:
axiom boot event failed')` in `vercel logs <deployment-url>`; a **query-capable** key is required
for true read-back. Do not record "Axiom verified" from an ingest-only key.

### Headless Vercel deploy and log reads

A `.vercel/project.json` containing `{"projectId":"<prj_…>","orgId":"<team_…>"}` lets `npx
vercel deploy --prod --yes` run without an interactive link, and `vercel logs <deployment-url>`
prints `λ` lines for real function invocations (the proof the Node runtime booted). Vercel REST
reads (`/v9/projects`, `/v9/projects/<id>/env`) work with the CLI token from
`~/.local/share/com.vercel.cli/auth.json` (a `403 invalidToken` can be transient — retry before
concluding the token is bad). Note that the env API **echoes a value back in its own JSON
response**, so an env write can print a value into the caller's transcript — a DSN is a public
client key, but treat env writes as potentially noisy.

## Three JUL-44 step-6 discoveries (verified 2026-09-19)

Each of these was learned while wiring the PowerSync Production instance to the Supabase
production database in JUL-44 step 6 and recorded here in step 7; the date is the day it was
verified, not the day it was written down.

### The drop box has no Postgres credential for PowerSync; the Supabase management key can create one

**Verified 2026-09-19.** The service drop box carries no Postgres credential for PowerSync. The
Supabase management key (drop-box field `supabase`, a full-access personal access token) can
create the needed narrow database credential headlessly: `POST
https://api.supabase.com/v1/projects/{ref}/database/query` with body `{"query": "..."}` runs
SQL, for example

```sql
CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD '<generated>';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_role;
CREATE PUBLICATION powersync FOR ALL TABLES;
```

Supabase's own PowerSync guide uses this dedicated-role shape, and the `powersync` publication
name is required. The database password can separately be rotated with `PATCH
https://api.supabase.com/v1/projects/{ref}/database/password` with `{"password": "..."}` — but
rotating the `postgres` password is unnecessary when the dedicated role is used. The direct
Supabase connection (`db.<ref>.supabase.co:5432`) resolves to IPv6 only and PowerSync Cloud
reaches it; the Supabase pooler at `aws-0-us-west-2.pooler.supabase.com` has IPv4 if a pooler is
ever needed.

### PowerSync provisioning sequence: service-config, wait for DNS, then sync-config

**Verified 2026-09-19.** On a freshly created (unprovisioned) instance, `powersync deploy` fails
after provisioning with "Failed to reach instance after provision", because the instance DNS name
`*.powersync.journeyapps.com` does not resolve yet. The working sequence is `powersync deploy
service-config` first, wait for the DNS name to resolve, then `powersync deploy sync-config`. A
connection password can be supplied in `powersync/service.yaml` as `password: { secret: !env
POWERSYNC_DATABASE_PASSWORD }`, resolved at deploy time from the process environment. `powersync
status` then reports the connection and replication slot; `Initial replication done: true` with a
0-byte replication lag is the proof the sync project is linked to Postgres.

### Provisioning secrets live at `/home/orchestrator-svc/.env.provisioning`, not `/etc`

**Verified 2026-09-19.** Provisioning secrets live at `/home/orchestrator-svc/.env.provisioning`
(owner `orchestrator-svc:orchestrator-svc`, mode 600), written by the orchestrator itself. The
Sep 17 Decision named `/etc/orchestrator-svc/.env.provisioning`, but that directory is root-owned
mode 700 and cannot be written by `orchestrator-svc`.

## The For-Todd guard: only three kinds of thing reach Todd (JUL-79 step 4)

The rule is now code, not just prose. `scripts/linear-cli.mjs` exports the pure
`checkForToddGuard(body)` (returns `{ ok: true }` or `{ ok: false, rule, reason }`, never
throws) and runs it inside `postComment` **before the first Linear API call** -- so a refused
comment costs no network request and no write. The CLI's `comment` subcommand inherits it. The
Ready queue imports the same function and runs it in its own comment path
(`checkForToddGuardImpl`, defaulting to the real guard), so its unexplained-comment path can be
tested by injection; a refusal there is logged with the rule and reason to stderr (the timer's
journal) and that one comment is skipped, while the cycle and the state file/fingerprint logic
carry on. The guard's two rules, both fail-closed on ambiguity:

1. **`category`.** If the body says `WAITING ON YOU` (case-insensitive), it must name one of the
   three kinds Todd legitimately gets -- the marker `(a)`/`(b)`/`(c)` or that category's
   vocabulary: (a) `sign-in`, `login`, `payment`; (b) `money`, `cost`, `spend`, `budget`,
   `billing`, `subscription`, `purchase`, `price`; (c) `product`, `decision`, `accept`,
   `approve`, `spec`, `scope`. No category -> refuse.
2. **`git-vocabulary`.** Any line in the `For Todd:` trailer (case-insensitive, from the header
   to the first blank line or the end) must not mention `merge`, `push`, `branch`, `PR`,
   `commit` or `rebase`, **including inflections** (`merged`, `merges`, `merging`, `pushes`,
   `pushed`, `pushing`, `branches`, `PRs`, `commits`, `committed`, `committing`, `rebased`,
   `rebasing`). Matching is word-boundary and stem-aware: `commitment`, `approach`, `imprint`
   and `PRint` do not trip it, and a bare `\bpush\b` would have missed `pushed`, which is why the
   patterns carry the stems. The same words **outside** a `For Todd:` line are ordinary prose
   and pass untouched. Strict by design -- no intent detection; even an informational mention is
   refused.

**Writing conventions this forces.** A `For Todd:` line describes the *outcome* without git
vocabulary: write "the step's changes are on main", never "PR merged" or "pushed the branch". A
park on Todd still says `WAITING ON YOU` and names `(a)`/`(b)`/`(c)` (or that vocabulary); a
normal report ends with `For Todd: nothing`.

**What a refusal tells the agent.** The thrown error names the rule that tripped and ends with
the acting instruction: the agent decides, does and logs this itself (merges, git, restarts,
installs, free-tier resources in approved services are all the agent's). It must not reword the
comment to slip past the guard. If the thing really is Todd-only and outside the three kinds,
that is a **design defect**: log it on the ticket and/or here in the runbook (the error names
`docs/agents/jul43-coordinator-runbook.md`), rather than forcing the post through.

## Narrow root for orchestrator-svc, `deepseek-readers`, and the second Orca window (JUL-79 laptop session)

### The sudo rules (`/etc/sudoers.d/orchestrator-svc-ops`)

Source of truth: `ops/sudoers/orchestrator-svc-ops`, guarded by `ops/sudoers/orchestrator-svc-ops.test.mjs`
(every rule must be one fixed command — no wildcards, no lists, no `ALL`, no `#include`, no paths
outside the named ones — and `visudo -cf` must accept the file where `visudo` exists). Installed by
hand from a laptop session with the `ubuntu` channel, **LF line endings only** (a Windows `scp`
once carried CRLF into an installed copy — pipe the file through `tr -d '\r'`, `sudo visudo -cf`
it, then `sudo install -m 0440 -o root -g root`). Rules, as `orchestrator-svc` via `sudo -n`:

| Rule | Why |
| --- | --- |
| `systemctl enable --now julia-ready-queue.timer` | Turns the queue on — JUL-79's own final step. |
| `systemctl disable --now julia-ready-queue.timer` | Switches the old five-minute queue off **for good** (JUL-98): stops it and removes it from the boot-time timer set. `stop` alone only lasts until the next restart, which would bring the old queue back beside the controller and let two things pick from Ready. The one exact command, no `mask`. |
| `systemctl start` / `stop` / `restart julia-ready-queue.timer` | Control the timer. |
| `systemctl start` / `stop` / `restart julia-ready-queue.service` | Run, stop or restart one check on demand (the service is a oneshot). |
| `usermod -aG <group> <account>` for `{deepseek-readers, commandcode-readers} × {runner, orchestrator-svc}` | Adds a service account to a key-reader group the drop box already uses. Four exact pairs, not a pattern (`commandcode-readers` added JUL-98, Todd's 13:43Z Decision, same shape as `deepseek-readers`). |

**There is no rule that installs, copies or edits a file** (removed after the PR #44 review; the
test fails if one comes back, and on the server it also tries an `install` as `orchestrator-svc`
and requires sudo to refuse it). The earlier design copied the unit files from the checkout as root,
which meant a merged change could become root code — `orchestrator-svc` can merge its own PRs. Now
the units below are installed **by a laptop session only**; the graph can turn the timer on and off
but cannot change what it runs. A new unit, a changed unit, a new group or a new rule is a
laptop-session edit and install, never a graph action — park it, don't work around it.

### The controller runs as a user service of `orchestrator-svc` (JUL-98, gap 1, 2026-09-21)

**The design: root once, never again.** The controller is a systemd *user* service of
`orchestrator-svc`, and the system restarts it after a crash. The one root step is done, once:
`sudo loginctl enable-linger orchestrator-svc` (evidence: `/var/lib/systemd/linger/orchestrator-svc`
exists, `loginctl show-user orchestrator-svc` says `Linger=yes State=lingering`, and
`user@1002.service` is active with nobody logged in; 1002 is this host's uid for the account). After that the graph installs and updates the
controller with **no sudo**, from an Orca terminal on `orchestrator-local` (the terminal's
environment has no `XDG_RUNTIME_DIR`, so set both variables yourself, or every `systemctl --user`
command fails silently -- see "`systemctl --user` fails silently in an Orca terminal" below; the user
id is 1002 on this host, and `$(id -u)` gives it inside the terminal). `ops/controller/julia-controller.service` now exists
(JUL-98 step 4), so these commands are the switch-on itself, not a plan for later.

```sh
export XDG_RUNTIME_DIR=/run/user/$(id -u) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus
systemctl --user link /srv/orchestrator-svc/julia-next/ops/controller/julia-controller.service
systemctl --user enable --now julia-controller.service
# after a checkout sync changes the unit file:
systemctl --user daemon-reload && systemctl --user restart julia-controller.service
```

`link` points at the unit file inside the read-only, root-owned checkout, so the account never needs
write access to it. **Proven live 2026-09-21** from a real Orca terminal as `orchestrator-svc`: a probe
unit linked from a root-owned file was killed with `kill -9`, and the system started a new process
2 seconds later (`NRestarts=1`, a different pid, `active`). The probe was removed afterwards.

What the controller's unit file must carry: `Restart=always`, `RestartSec=5`, `NoNewPrivileges=yes`
(accepted in a user unit, checked in the probe), and an `[Install]` section with
`WantedBy=default.target` (without it `enable` cannot make the lingering user manager start it at boot).
It should also set `StartLimitIntervalSec=0`: by default a few quick crashes make systemd give up and
leave the controller down with nothing moving on the board. The trade-off is that a bad build then
crash-loops forever instead of stopping, bounded to one restart every 5 seconds by `RestartSec`; the
controller's build must make a crash loop visible (a journal line and a card comment) rather than
rely on systemd to stop it. **That is built** (`graph/controller/crash-loop.mjs`, JUL-98 step 4):
every start writes one journal line naming the build, the pid and the mode, and once five starts land
inside ten minutes the controller writes ONE comment -- once per episode, not once per restart -- on
the card it was carrying, saying how many starts, on which build, and that systemd will not stop it.
It knows which card that is because `runOnce` writes the carry -- the card's real Linear id, not just
its identifier -- into the state file under `$XDG_STATE_HOME/julia-next/controller.json` BEFORE the
work starts, and the next process reads it back from there. A loop with no card in flight still shouts
in the journal; it simply has nowhere to comment.

The same state file carries the **request-id ledger** (`requests`) -- the Orca request id the
controller was issued for each action -- and that ledger survives a restart, so if the same action is
issued again it is recognised as a replay and no second worker is started. What the controller does
*not* do today is re-issue an interrupted action on the way back up: a card killed mid-flight is not
picked back up by itself, and nothing in the controller notices it was dropped. That resume is the
next card, **JUL-99** ("The card shows its plan, and a crash picks up from it"); the ledger here is
only what stops the resume, once JUL-99 builds it, from starting a second worker. Both of those are
only true because `normalize()` in `graph/controller/state.mjs` round-trips
every field the controller keeps: a field that serializer forgets is silently dropped on read, with no
error anywhere, so anything added to the controller's state must be added there too.

**The controller finds or makes its own Orca sender terminal (JUL-98 step 5).** The controller's two
dispatch calls carry the handle as `--from` -- `orchestration run-create` (`runCreateImpl`) and
`orchestration worker-start` (`workerStartImpl`), both in `graph/controller/wiring.mjs` -- and
`run-create` is refused outright without one
(`graph/fixtures/orca-1.4.205/run-create.no-sender-terminal.error.json`). The mailbox wait
(`orchestration check`, `checkWaitImpl`) carries the same handle under a different flag,
`--terminal`. The rest -- `orchestration worker-release`, `worktree ps`, `worktree rm` -- do not
carry it at all.
**Neither the unit nor an operator has to supply that handle.** At startup `main()` resolves it in
this order (`resolveSenderTerminal` in `graph/controller/wiring.mjs`):

1. `$JULIA_CONTROLLER_TERMINAL`, **if** Orca still knows that handle -- an optional operator
   override, for pointing the controller at a terminal you are watching. Nothing sets it: the unit
   does not, and its only `EnvironmentFile` is the publisher credential file.
2. otherwise the handle the controller recorded on a previous start (`senderTerminal` in
   `$XDG_STATE_HOME/julia-next/controller.json`), **if** Orca still knows that one. This is what
   stops `RestartSec=5` from leaking a new Orca terminal every five seconds.
3. otherwise a fresh one from `orca terminal create --environment orchestrator-local --worktree
   path:/srv/orchestrator-svc/julia-next --title julia-controller`, recorded in the state file
   before the first cycle runs.

"Still knows" is **asked of Orca, never assumed from the handle being present**: `orca terminal show
--terminal <handle>` answers `result.terminal` for a live one and is refused with
`terminal_handle_stale` for one it no longer has (recorded live at 1.4.205 on 2026-09-21:
`graph/fixtures/orca-1.4.205/terminal-show.plain-diagnostic-live.json` and
`terminal-show.unknown-handle.error.json`). A handle Orca refuses -- or one it reports `orphaned` --
is replaced, not used. **A handle is not durable:** an Orca terminal handle does not survive an Orca
restart, so pasting one into the unit would work only until the next restart. That is why the
controller provisions its own rather than being handed one.

The terminal it creates is a **plain diagnostic terminal, not an agent**: `terminal create` with no
`--command`, so it is a bare shell with no model allowance, and nothing is ever typed into it. A
create Orca could not make visible still returns a working handle and says so in `warning`; that is
logged and the handle is used. If a terminal can be neither reused nor created, the controller
**still refuses loudly and exits non-zero** -- the journal line names Orca's own error code and names
`JULIA_CONTROLLER_TERMINAL` as the override -- exactly as it did before step 5, because starting
without a sender terminal would only move the same failure to the first `run-create` with less to
say.

*Before step 5 this was broken outright:* the handle came only from `$JULIA_CONTROLLER_TERMINAL`,
nothing set it, and a real `--once` run on 2026-09-21 at 18:11Z printed the banner, refused and
exited. Under `Restart=always` that is a five-second crash loop with nothing ever moving on the
board.

**Two daemons and two checkouts: which Orca call goes where (JUL-98 step 5c).** The controller's
own side and the worker's side are different daemons *and* different checkouts, and no call may use
the wrong pair.

**The one-line reason the controller's own checkout can never be the worker's:** creating a worktree
writes a branch ref into the repository it is created from, and `/srv/orchestrator-svc/julia-next` is
root-owned and read-only to `orchestrator-svc` on purpose.

*This was live, not theoretical.* On 2026-09-21 at 18:54Z the controller moved **JUL-92** from Ready
to Implementation, failed to start a builder for it, and then reported nothing-eligible on every
cycle afterwards -- leaving a real card in Implementation with nothing working on it. Re-running the
controller's own recorded `worker-start` by hand gave the reason its `lastError` had dropped:

```
state: failed, stage: worktree_create
Command failed: git worktree add --no-track -b jul-92-probe ... refs/remotes/origin/main
fatal: cannot lock ref refs/heads/jul-92-probe: Unable to create
/srv/orchestrator-svc/julia-next/.git/refs/heads/jul-92-probe.lock: Permission denied
```

Every dispatch failed identically, so the controller could never start a single worker. The fix is
**never** to make that checkout writable and **never** to add a sudo rule -- it is deliberately
read-only, which is also why `graph/controller/state.mjs` refuses to keep the state file inside it --
but to dispatch onto the runner's daemon, into the runner's checkout.

| Orca call | boundary (`graph/controller/wiring.mjs`) | `--environment` | `--on` | repo / worktree flag |
| --- | --- | --- | --- | --- |
| `orchestration run-create` | `runCreateImpl` (line 187) | `orchestrator-local` | — | — |
| `orchestration run-list` (via `findActiveRun`) | `activeRunImpl` (line 201) | `orchestrator-local` | — | — |
| `orchestration worker-start` | `workerStartImpl` (line 222) | `orchestrator-local` | **`ovh-local`** | `--repo path:/home/runner/julia-next` |
| `worktree ps` | `observeStartImpl` (line 265) | **`ovh-local`** | — | — |
| `orchestration check --wait` | `checkWaitImpl` (line 282) | `orchestrator-local` | — | — |
| `orchestration worker-release` | `releaseImpl` (line 305) | `orchestrator-local` | — | — |
| `terminal show` | `terminalShowImpl` (line 317) | `orchestrator-local` | — | — |
| `terminal create` | `terminalCreateImpl` (line 331) | `orchestrator-local` | — | `--worktree path:/srv/orchestrator-svc/julia-next` |
| `worktree rm` | `removeWorktreeImpl` (line 345) | **`ovh-local`** | — | `--worktree id:<repoId>::<path>` |

Why it splits that way:

- **The Run and everything hanging off it stay on `orchestrator-local`**: `run-create`, the run-list
  walk, the mailbox `check --wait`, `worker-release`, and the controller's own sender terminal
  (`terminal show` / `terminal create`). The wrong daemon here answers `run_not_found` -- see
  "`run_not_found` on an orchestration command is the wrong daemon, not a missing Run" above.
- **`worker-start` carries both sides.** `orca orchestration worker-start --help` states it: "`--on`
  selects only the worker server; the Run and this command remain on the current Orca server", and
  "Use exact `--repo` on the selected server." So `--environment orchestrator-local` (the Run),
  `--on ovh-local` (where the worker process runs), `--repo path:/home/runner/julia-next` (the
  runner-owned checkout a branch ref can actually be written into). Before this fix the call passed
  **no `--on` at all** and pointed `--repo` at the controller's own checkout.
- **`worktree ps` and `worktree rm` act on the worker's worktree, so they go to `ovh-local`.** Both
  previously passed no `--environment` and fell back to the process default; the unit sets no
  `ORCA_ENVIRONMENT`, so under systemd there is no default to fall back to. `worker-release` was
  `--environment`-less for the same reason and now names `orchestrator-local` explicitly.
- **The controller's sender terminal does not move.** It must live on the daemon its Run lives on,
  and nothing is ever run in it, so the read-only checkout costs it nothing.

**The ownership boundary this opens, and the three places that cross it.** The controller runs as
`orchestrator-svc`; the candidate worktree is now owned by `runner` under
`/home/runner/orca/workspaces/julia-next/`. `orchestrator-svc` can read there, but git's
*dubious-ownership* guard is about the owning UID, not file permissions, and refuses the directory
outright: "fatal: detected dubious ownership in repository at ...". Each crossing gets
`safe.directory` scoped to **exactly** the worktree path the caller passed -- the same fix
`scripts/publish-pr.mjs` (`pushBranch`, line 150) and `scripts/verify-reviewer-worktree.mjs`
(line 31) already use. **No global git config, and no wildcard.**

- `headShaOf` (`graph/controller/wiring.mjs` line 578) -- `git -c safe.directory=<path> -C <path>
  rev-parse HEAD`. Without it there is no reviewed sha for `merge-pr.mjs`.
- `currentBranch` (`graph/controller/main.mjs` line 253) -- the same, for `rev-parse --abbrev-ref
  HEAD`. Without it a passing step never reaches the publish it earned.
- **The suite run** (`graph/controller/test-run.mjs`, `gitSafeDirectoryEnv`, line 82). The command is
  `node --test scripts/*.test.mjs`, not git, so there is no argv position for `-c`; it carries git's
  own documented environment form instead -- `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` /
  `GIT_CONFIG_VALUE_n`, one entry, value exactly the worktree path -- which every git process the
  suite starts inherits. This matters because `scripts/line-endings.test.mjs` shells out to `git
  ls-files --eol` in the repo root and turns a failure into `t.skip('not inside a git checkout')`:
  without this the repo's line-ending guard would **silently skip** on every controller-run suite and
  be reported as a pass.

`pushBranch` and `assertNoUrlRewrites` in `scripts/publish-pr.mjs` already pass `-c
safe.directory=<cwd>` (lines 150 and 85) and were left unchanged. `openPullRequest` and
`mergePullRequest` are GitHub REST calls that never touch the worktree, so they need nothing.

*Not verified live:* every routing and `safe.directory` claim above is pinned by
`scripts/controller-wiring.test.mjs`, which asserts the argv the controller builds and spawns
nothing. That the real `orca` and the real `git` behave as described when the controller runs as
`orchestrator-svc` is only provable on the server.

**The trade-off, stated plainly.** A merged change to that unit file becomes code running as
`orchestrator-svc`. That is not root, and it is the account that already merges its own PRs and holds
the publisher credential, so it adds no reach the graph did not have. The root-code boundary in the
sudo section above is unchanged: no sudo rule installs or edits a file.

**Not proven: a real reboot.** Lingering is set and the user manager is up, but the server was not
rebooted to prove the controller comes back on its own. *If that is wrong:* after the next reboot the
controller would stay down until someone starts it, and nothing would move on the board. The first real
reboot is the test; afterwards, with the two `export` lines above set, check
`systemctl --user is-enabled julia-controller.service` and `systemctl --user is-active julia-controller.service`.

### `systemctl --user` fails silently in an Orca terminal, and silence reads as success (JUL-98, 2026-09-21)

**Read this before running any `systemctl --user` command from a terminal Orca started.**

In a terminal started by Orca on the orchestrator daemon, the two values the user systemd
manager needs are not set:

- `XDG_RUNTIME_DIR` is **empty**;
- `DBUS_SESSION_BUS_ADDRESS` is the literal string **`disabled:`** — set, but to a value that
  means "no bus".

With those two in that state, **every `systemctl --user` command fails silently**: it prints
nothing at all, on stdout or stderr, and returns 1. Nothing says "no bus", nothing says
"failed". A step that runs it and does not check `$?` sees empty output and moves on, which is
exactly what a successful `systemctl --user enable --now` also looks like.

**The fix — export both first, every time:**

```sh
export XDG_RUNTIME_DIR=/run/user/1002
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1002/bus
```

1002 is this host's uid for `orchestrator-svc`; `$(id -u)` gives it inside the terminal.

**Evidence, live 2026-09-21 (coordinator, server).** With those two set:

- `systemctl --user is-system-running` returns `running` — the manager is reachable, which it
  was not a moment earlier from the same terminal.
- A probe unit was installed, started, and killed outright with `kill -9`. Before the kill:
  `MainPID 990028`, `NRestarts 0`. After: `MainPID 990112`, `NRestarts 1`, still `active` — a
  new process, the restart counted, the service up. The probe was removed afterwards.

The coordinator's first probe that day died the silent way, with no output to say so, and was
only caught because the result was checked against the board rather than against the command.

**What breaks if this stays unwritten.** The step that switches the controller on prints
nothing, returns, and looks like it worked. It silently did nothing. The controller is not
running, no card ever moves, and nobody learns until someone notices the board has been still
for hours — by which time the session that ran the step is long gone. Never treat a silent
`systemctl --user` as success: check the exit status, and then check `is-active` and
`is-enabled` by name.

### `--retry-request` takes the id **Orca** issued, not one you invent (JUL-98 step 4, 2026-09-21)

Orca's idempotency is not a caller-chosen key. The first mutating call answers
`result.mutation.requestId` with `replayed: false`; re-running the *same* command with
`--retry-request <that id>` answers the same object with `replayed: true` and starts nothing
(`graph/fixtures/orca-1.4.205/run-create.ok.json` and `run-create.replayed.json`, and that fixture
directory's README records the exact command pair). There is no `--request-id` flag on any verb.

So a caller that wants a repeat to replay has to keep a ledger: *its own* logical key for an action
-> the request id Orca issued for it. `graph/controller/wiring.mjs` (`createRequestLedger`) does
that, and the ledger is plain JSON kept in the controller's state file, so it survives a restart:
if the same action is issued again it is recognised as a replay and no second worker is started.
What the controller does *not* do is re-issue an interrupted action on startup -- a card killed
mid-flight is not picked back up by itself; that resume is JUL-99. Anything written against a
caller-invented request id is wrong and will silently start a duplicate.

### `orca worktree ps --json`: the real shape, and the `truncated` trap (JUL-98 step 4, 2026-09-21)

Confirmed live by running it in a julia-next worktree on the runner:

```
result.worktrees[] -- each row keyed worktreeId ("<repoId>::<path>"), NOT id,
                      carrying agents[] with { paneKey, state, agentType, prompt }
result.hostScope, result.totalCount, result.truncated
```

`agents[].state === "working"` is still the one recorded answer in which Orca says an agent is
really running, which is what `graph/controller/turn-start.mjs` classifies.

**The trap.** `worktree ps` has a row cap and that cap is **shared across hosts**, so a busy machine
can answer a page that simply does not contain the worktree you asked about, with `truncated: true`.
Reading that absence as "no turn started" would release a perfectly healthy worker as never-started.
`createOrcaBoundaries` asks for `--limit 200` and treats *absent on a truncated page* as an error,
never as a verdict.

### A worker's cost figures are under the **worker's** home, never the controller's (JUL-98 step 5, 2026-09-21)

The controller runs as `orchestrator-svc`; a worker runs as `runner`. The session files a cost
line is read from are written **by the worker**, so they are under `runner`'s home and nowhere
else: the Claude transcript at `/home/runner/.claude/projects/<the worktree path with every
non-alphanumeric character replaced by a dash>/`, the Codex rollout under
`/home/runner/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.

`createSeatCostReader` (then in `graph/controller/wiring.mjs`, now in `graph/controller/cost-read.mjs`
and re-exported from `wiring.mjs`) took `os.homedir()` as its default, which
under the unit is `/home/orchestrator-svc` — a directory no worker has ever written into, and one
`runner` cannot even open (`ls -a /home/orchestrator-svc` as `runner`: "Permission denied"). The
read found nothing, the reader refused, the seat got no cost line, and `assertEverySeatCosted`
stopped the step. That is exactly what happened to JUL-92 on 2026-09-21: *"stopped at
build-and-review -- no cost line for the builder seat"*. The builder's transcript for that run was
real all along, at
`/home/runner/.claude/projects/-home-runner-orca-workspaces-julia-next-jul-92-work`.

The reader now takes `workerHome`, defaulting to the exported `WORKER_HOME` (`/home/runner`),
which lives in `graph/controller/cost-read.mjs` beside the reader that uses it and is re-exported
from `wiring.mjs` for every caller that already imported it from there. **The rule, three defects
in:** anything in `graph/controller/` that touches worker files,
worker processes or the worker account must name the worker side explicitly. The controller's own
daemon, checkout and home are never the default for something the worker made.

### And the cost is read **as the worker, through Orca** — never off the controller's disk (JUL-98 step 5, 2026-09-21)

Pointing the reader at `/home/runner` (the section above) was necessary and not sufficient. The
transcript directory is **private to the worker account**. Measured on the box as
`orchestrator-svc`:

```
$ whoami
orchestrator-svc
$ ls -ld /home/runner /home/runner/.claude /home/runner/.claude/projects
drwxr-xr-x 21 runner runner /home/runner
drwxrwxr-x 11 runner runner /home/runner/.claude
drwxr-xr-x 56 runner runner /home/runner/.claude/projects
$ ls -l /home/runner/.claude/projects/-home-runner-orca-workspaces-julia-next-jul-92-work-a1
ls: cannot open directory ...: Permission denied
```

Every hop down to the project directory is world-executable; the **per-project directory itself**
is mode 0700 and owned by `runner`. Claude Code creates it that way — re-confirmed from the other
side the same day, as `runner`: `ls -ld
/home/runner/.claude/projects/-home-runner-orca-workspaces-julia-next-jul98-step-5e` → `drwx------
2 runner runner`. So the controller could see
that the directory existed and could never open it, and JUL-92 kept stopping with the same line:
*"stopped at build-and-review -- no cost line for the builder seat"*.

**The two routes that are closed, so nobody re-opens them.**

- **Widening the permission.** `acl` is not installed on this host (`getfacl` as `runner` on
  2026-09-21: `command not found`), installing it needs root, and a root change
  is not a graph action. Making transcripts world-readable would widen the trust boundary far
  past the problem.
- **Orca's own transcript.** `orca orchestration worker-read --source transcript` returns the
  messages and carries **no** usage, token or cost field — checked against a real dispatch on
  2026-09-21 and handed over with this step; the verb exists (`orca orchestration worker-read
  --dispatch <id> --source <auto|transcript|terminal>`) and its own `--help` describes it as
  "bounded output", not usage. It is not a cost source.

**What runs instead.** A terminal Orca creates on the **worker** daemon runs as the **worker
account**, so it can read the worker's own files. That is the route by which every worker cost
figure posted on JUL-98 was obtained by hand, and it is now the code path:

1. `graph/controller/wiring.mjs`, `createOrcaSeatCostReader` → `workerTerminalCreateImpl`:
   `orca terminal create --environment ovh-local --worktree path:<candidate worktree> --title
   julia-cost-<seat> --command "node '<worktree>/scripts/read-seat-cost.mjs' --seat … --agent …
   --worktree …; echo \"__JULIA_COST_READ_DONE__:$?\""`.
2. `scripts/read-seat-cost.mjs` runs in that worktree **as the worker**, calls
   `createSeatCostReader` from `graph/controller/cost-read.mjs`, and prints **exactly one line**
   of JSON — the seat cost line — on stdout. Any failure goes to stderr and exits non-zero. It
   computes nothing: the totals, the peak and the dollars are `graph/controller/cost.mjs` and
   `graph/rate-table.mjs`, and `tokenTotal()` is still the only place a token total is worked out.
3. The controller polls `terminal read` and parses the one JSON line, then closes the terminal.

**How the controller knows the command has finished, and why it is not `terminal wait`.** A plain
terminal is not finished when `terminal wait` says so: `--for tui-idle` answered `satisfied: true`
after 2.5 s on a terminal still running `sleep 90`, and `--for exit --timeout-ms 8000` held 8.4 s
and then returned `timeout` with the shell still open (the table under "Orca is pinned at 1.4.205",
row 3). The documented way is to poll `terminal read` until the shell prompt is back. The reader
does exactly that, with the prompt's return made machine-readable instead of matched by shape:
the shell prints `__JULIA_COST_READ_DONE__:$?` only once it has the command's exit status, i.e.
only once the prompt is back, and that status travels out with it. The **echo** of the command
contains the same text, so the match is anchored (`^__JULIA_COST_READ_DONE__:(\d+)$`) and the echo
can never be read as the answer.

**The two `terminal read` traps this path lives with.** A read with no cursor returns the
**oldest** retained window, not the newest — so the first read is deliberately cursorless (this
terminal's output starts at its oldest line) and each later read passes the previous read's
`nextCursor`. And `--screen` is not used: a screen read is the current frame only, cannot be
paged, and the one JSON line can have scrolled off it.

**Closing.** `orca terminal close --terminal <handle>` — one pane. Not `--tab`, and never
`--worktree … --all`, which would stop every terminal in the candidate worktree including the
worker's own agent terminal. The close is in a `finally`, so a failed read does not leak a
terminal on the worker daemon; a close that itself fails is warned about and does not replace the
real reason the read failed.

**Nothing about the guard moved.** A missing JSON line, an unparseable one, a non-zero exit and a
timeout are each a refusal: `finishWorker` leaves the worker and its worktree in place and the
step stops naming the seat and the reason, exactly as before. No blank or guessed figure can
reach a card. A worker that never began a turn still takes the never-started path in
`graph/controller/release.mjs` — no terminal is created for it, and it gets its explicit
never-started line.

**What breaks if someone "simplifies" this back to a direct file read.** `readdir` on the
per-project directory throws `EACCES` for `orchestrator-svc`, the reader refuses, the seat gets no
cost line, `assertEverySeatCosted` fails it, and the controller stops at `build-and-review` with
"no cost line for the builder seat" on every card — which is the JUL-92 stop, the only thing the
controller did for a whole evening. It cannot be fixed by changing a path; it needs root, and root
is not a graph action.

### A repeated `--name` is not refused by Orca — it is silently suffixed (JUL-98 step 5, 2026-09-21)

A step that stops before `finishWorker` leaves the worker's worktree registered: JUL-92 stopped at
the cost read, so `jul-92-work` is still in `orca worktree list`. Asking for that name again does
**not** fail. Measured on this host at 1.4.205 by creating the same `--name` three times
(recorded as `graph/fixtures/orca-1.4.205/worktree-create.duplicate-name-suffixed.json`): each
repeat answers `ok: true` with a different `path` and a different `branch` — `…-2`, then `…-3` —
while `displayName` stays the name asked for, with `displayNameMode: "fixed"`. Two worktrees then
share one display name, and Orca's own `name:<displayName>` selector can address neither:
`worktree rm --worktree name:<that name>` answers `selector_ambiguous`
(`worktree-rm.duplicate-name-ambiguous.error.json`).

So a second attempt would get a branch that is not the one the card is named after, and no operator
could clean up by name. The **harder** half is the request ledger: `requestId` is the controller's
logical key for a `worker-start`, and a key it has already seen becomes `--retry-request`, which
Orca replays. With an unchanged key a second attempt would be handed the stopped attempt's dispatch
— a worker that no longer exists — and would then wait on a mailbox nothing will ever post to.

The fix is an **attempt number**, and it goes into both. `graph/controller/main.mjs` counts attempts
per card in the controller's state file (`attempts`, round-tripped by `normalize` in `state.mjs`),
increments it *before* the work starts, and hands it to `runBuildAndReview`, which appends
`attemptTag(attempt)` — `a1`, `a2`, … — to the worktree name and to the request key. So the first
attempt on JUL-92 asks for `jul-92-work-a1`, which collides with the leftover `jul-92-work` in no
way at all. **Nothing leftover is deleted to make room:** `orca worktree rm --help` says removal
"also attempts to delete the checked-out local branch", which would destroy the stopped attempt's
commits.

**Still open, and not fixed here:** the run-create request key is `<identifier>:run`
(`requestIdFor` in `graph/controller/core.mjs`), which carries no attempt, so a second attempt on a
card replays the first attempt's Orca run rather than taking a new one.

### A seat that cannot be launched falls back to its backup, and the card is told why (JUL-98 step 5, 2026-09-21)

**The reviewer seat's first choice cannot be started by the controller at all, on any card.**
`graph/seat-table.mjs` gives `adversarial-reviewer` the primary entry `pi-deepseek`, and
`launchForChoice` in `graph/controller/dispatch.mjs` refuses that entry outright: a DeepSeek (Pi)
seat started with a new worktree cannot report to the mailbox, so the only route JUL-109 section 4
recorded as reporting `worker_done` is an *interactive* Pi adopted with `worker-start --terminal`
once it has fully started — and that route carries no model and no effort. The refusal is
deliberate and is unchanged by this section. What it meant in practice is that the controller could
never run a review of any kind; in the live JUL-92 run of 2026-09-21 it built the card, ran the
suite, costed the builder, and then stopped with `no cost line for the reviewer seat` — true, and
not the reason.

**What now happens.** A seat whose entry cannot be launched takes exactly the route a **capped**
seat already takes. `runBuildAndReview` in `graph/controller/step-runner.mjs` branches on
`launchRefused` (set by `dispatchWorker` only when nothing at all was created) and calls
`fallbackSeatChoice` in `scripts/seat-labels.mjs` — the same function, the same seat table and the
same `validateFamilyChoice` family guard the capped case uses. There is no second fallback
mechanism. The step is then started again on the backup, under a worktree name and a request key
suffixed `-bk`, so it collides with nothing the refused start asked for. For a card carrying no
model labels that is `pi-deepseek` → `codex` (`adversary-codex`), which the seat table has named as
that seat's backup all along. **No seat's preferred entry changed**, and `graph/seat-table.mjs` was
not edited.

**One comment, on the card.** `seatMoveComment` composes it and `carryCard` in
`graph/controller/main.mjs` posts it once, keyed `seat-move:<seat>:<from>-><to>` through the same
duplicate guard every other controller comment uses, before anything else is said about the step —
so a card shows the move whether the step then passed or failed. The same sentence goes to the
journal. When the family guard also had to move the *partner* seat out of the way, seat-labels'
own `partnerMovedReason` is appended to that same comment verbatim, so the board and the code
cannot tell two different stories.

**Three things it will not do.** It never tries a third entry and never invents one — the backup
comes from the seat table or the step stops. It never runs a same-family pair: if
`fallbackSeatChoice` refuses the backup, the step stops and the reason names both entries and the
guard's own words. And it never moves a seat that has already run: the partner move is offered only
while no seat has run yet (`movePartner: ran.size === 0`), so a reviewer falling back can never
rewrite a builder that is already finished.

**And it only says a seat *ran* on its backup when the backup actually got going.** `launchRefused`
is the right test for *starting* a fallback — it marks the one case where nothing at all was
created — but it is the wrong test for whether the fallback then worked. A `worker-start` that
*failed* (the `agent_readiness` / folder-trust case of 19-20 September) comes back without the
mark, and so does a worker whose turn was never proven. Both come back from `runWorkerStep` with a
never-started cost line and a `stage` of `dispatch` or `turn-start`, and it is that `stage` the
backup branch gates on (`neverGotGoing` in `graph/controller/step-runner.mjs`). A backup that was
refused, that failed to start, or whose turn never began therefore takes the stop path that names
both entries and both reasons, and `seatMoveComment` is not written at all — so a card can no
longer be told "it ran on `codex`", "worker-start failed at agent_readiness" and "never started"
in one step.

**A refusal is no longer reported as a blank.** A seat refused before dispatch has no session file
to read, so it gets the explicit never-started line `neverStartedCostLine` in
`graph/controller/cost.mjs` already produces for a worker whose turn never began — 0 tokens, $0,
`neverStarted: true` — carrying the refusal as its reason. Because the seat now *has* a line,
`assertEverySeatCosted` no longer fires, and the step stops with the refusal as its reason instead
of with "no cost line for the <seat> seat". **An unmarked blank cost line still fails the step**,
exactly as before: the never-started mark is explicit, never an absence.

**Still open, and not fixed here:** the Pi refusal itself stands, so no card can actually be
reviewed by DeepSeek through the controller — every review runs on the Codex backup until an
adopted-terminal Pi route exists.

### The controller writes to Linear as the app, and only `orchestrator-svc` can run it (JUL-98 step 2)

`graph/controller/board.mjs` (`createControllerBoard`) is the board `runControllerCheck` actually
writes through. It reuses `createLinearClient` from `scripts/ready-queue.mjs` — the live-verified
queries, unchanged — but passes it an injected `linearGraphQLImpl` built from
`createAuthedLinearCall` in `graph/controller/token.mjs`, so every request carries the "Julia
controller" app's own OAuth token and a refused one renews and retries exactly once. No personal
key can reach Linear through it: none is passed anywhere in the module.

`scripts/linear-cli.mjs` therefore has **two** auth paths and they are not interchangeable. A
personal key (`apiKey`, `lin_api_…`) goes out as the raw `Authorization` value — Linear expects
exactly that. An app access token (`accessToken`) goes out as `Authorization: Bearer <token>`;
sent raw it is refused. The old `apiKey` path is untouched, and the coordinator and the Ready
queue still use it.

**Who can run it.** The token is fetched from `linear-app-id` / `linear-app-secret`, which
`ops/service-dropbox/read-secret.mjs` makes readable by `orchestrator-svc` only. A builder runs as
`runner`, cannot read them, and must not try: every test injects a token provider instead. So the
tests prove the wiring (which header, which query, which retry) and nothing about the live API
accepting this app on these mutations — that is only provable when the controller runs for real.

### The ready-queue units (`ops/ready-queue/`)

`julia-ready-queue.service` (oneshot, `User=orchestrator-svc`, `Group=orchestrator-svc`,
`NoNewPrivileges=yes`, `Environment=ORCA_BIN=/opt/Orca/orca-ide`, one `ExecStart`:
`/usr/bin/node /srv/orchestrator-svc/julia-next/scripts/ready-queue.mjs --check --interval-minutes 5`)
and `julia-ready-queue.timer` (`OnBootSec=1min`, `OnUnitActiveSec=5min`, `Unit=`, `WantedBy=timers.target`).
`ops/ready-queue/units.test.mjs` pins all of it: runs as `orchestrator-svc`, never root; no
`ExecStartPre/Post/Stop/Reload`, no `+`/`!` prefixes, no capability or supplementary-group
directives; executes only `node` on the queue script in the checkout. That checkout is root-owned
and read-only to `orchestrator-svc` (verified live: `/`, `/srv`, `/srv/orchestrator-svc` and
the checkout are not writable by it), so the queue runs code it can read and run but cannot change.
The queue's needs were checked by running the exact command as `orchestrator-svc` with a bare
environment: it needs only `ORCA_BIN` (state lives under `$HOME/.local/state/julia-next/`).

**Install (laptop session, `ubuntu`).** Install from the reviewed commit, not from whatever the
checkout holds now: the checkout is synced from `main`, which `orchestrator-svc` can merge to, so
compare every file to the reviewed SHA first and refuse symlinks. Do the sudoers file first — until
the old file is replaced, the old install rules are still live.
```sh
SHA=<reviewed merge commit on main>; CK=/srv/orchestrator-svc/julia-next
for f in ops/ready-queue/julia-ready-queue.service ops/ready-queue/julia-ready-queue.timer ops/sudoers/orchestrator-svc-ops; do
  sudo test -f "$CK/$f" && sudo test ! -L "$CK/$f" && sudo git -C "$CK" show "$SHA:$f" | sudo cmp - "$CK/$f"
done
# 1. sudoers: LF only, syntax-checked, then installed
sudo sh -c "tr -d '\r' < $CK/ops/sudoers/orchestrator-svc-ops > /tmp/orchestrator-svc-ops"
sudo visudo -cf /tmp/orchestrator-svc-ops
sudo install -m 0440 -o root -g root /tmp/orchestrator-svc-ops /etc/sudoers.d/orchestrator-svc-ops && sudo rm /tmp/orchestrator-svc-ops
sudo -l -U orchestrator-svc            # exactly the file's rules + the one checkout-sync rule
# 2. the units
for u in julia-ready-queue.service julia-ready-queue.timer; do
  sudo install -m 0644 -o root -g root "$CK/ops/ready-queue/$u" /etc/systemd/system/$u
done
sudo systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/julia-ready-queue.service /etc/systemd/system/julia-ready-queue.timer
sudo systemctl show -p User,ExecStart julia-ready-queue.service   # User=orchestrator-svc
```
Do **not** enable the timer in the same session; JUL-79's run does that as its final step. On the
server, `node --test ops/sudoers/` run as `orchestrator-svc` from the checkout also checks live that
an `install` is refused and that the live rule set is exactly the file's.

### Trust boundary, after this change

The reviewer's finding (PR #44) was that `orchestrator-svc` can merge its own PRs, so any rule that
copied a merged file into `/etc` as root made the review the only gate. That path is closed: the
remaining root actions are start/stop/enable of two units that already exist and run as
`orchestrator-svc`, and `usermod` into four named groups (each only grants read of the key files
already `root:<group> 0440`). What is still true and unchanged: the checkout-sync service runs as
root from the merged checkout and `orchestrator-svc` can trigger it, so merged code in
`scripts/checkout-sync.mjs` still runs as root — that path pre-dates these rules and is a separate
gate to consider.

### `deepseek-readers` (was: `deepseek` readable by `runner` only)

`deepseek.env` is now `root:deepseek-readers` mode 0440; both `runner` and `orchestrator-svc` are
members. `FIELD_GROUPS.deepseek`, `write-secret.sh`, its installed copy
in `/opt/orca-runner/service-dropbox/`, and the drop-box README all say `deepseek-readers` now, so
re-pasting the key through the drop box keeps that ownership. Both Orca daemons were restarted after
the `usermod` (a daemon's supplementary groups are fixed at start — see the stale-groups section
above); `/proc/<daemon pid>/status` showed group 1004 on both. This unblocks the
`orchestrator-deepseek` seat carried from the step-3 review.

### The laptop Orca app sees both daemons

The laptop's Orca app now lists two environments: **OVH runner** (`ws://100.125.239.98:6768`,
runs as `runner`) and **OVH orchestrator** (`ws://100.125.239.98:6769`, runs as `orchestrator-svc`),
so a run's orchestrator terminal and its builder/reviewer terminals both show in one window. Added
with `orca environment add --name "OVH orchestrator" --pairing-code <URL from
journalctl -u orca-server-orchestrator.service | grep "Pairing URL:">` (the laptop CLI is
`%LOCALAPPDATA%\Programs\orca\resources\bin\orca.exe`). If the daemon restarts and the pairing goes
stale, repeat with a fresh URL. The pairing code is a credential for a daemon that runs as
`orchestrator-svc` — never paste it into Linear or chat.

## Readiness

```sh
node scripts/check-readiness.mjs
```

Checks, each its own pass/fail line:
1. OVH runner reachable (`orca status --environment "OVH runner" --json`).
2. `julia-next` project registered there.
3. `julia-graph-publisher` App installed on `julia-next` (needs
   `JULIA_PUBLISHER_APP_ID`/`JULIA_PUBLISHER_APP_PRIVATE_KEY` in the caller's process
   environment — see "Publishing" below for where those now live).
4. journey-relay reachable, run from inside a terminal on the OVH runner itself (it binds
   `127.0.0.1:8943` there only).

No `LINEAR_API_KEY` check — the coordinator is a live agent session using Linear's MCP tools
directly.

## Dispatch

Use Orca's `worker-start --on ...` (`scripts/orca-cli.mjs`), following Orca's own
`orchestration` skill. Every worker gets a fresh top-level worktree
(`worktree: 'new-top-level'`, **not** the shared registered checkout), a distinct `--name`, and
an exact `--repo path:...` selector — see `.claude/skills/julia-coordinator/SKILL.md` for the
full dispatch procedure and why each of those is required (verified live against real CLI
rejections, not assumed).

## Review

After a worker's step passes, dispatch a fresh reviewer with no prior context on the ticket. Its
report is saved **outside** the candidate worktree. Before trusting the review, diff the
reviewer's worktree against the candidate commit (`scripts/verify-reviewer-worktree.mjs`) — any
difference, committed or not, rejects the review outright and the step is retried with a fresh
reviewer. See `SKILL.md`'s "After verification" section for the exact sequence.

**`verify-reviewer-worktree.mjs` hits the same dubious-ownership guard as an unpatched
`publish-pr.mjs` (live-verified, JUL-73).** Whenever the verifying process's UID doesn't match
the reviewer worktree's owner UID (the coordinator's own real shape: `orchestrator-svc`
verifying a `runner`-owned reviewer worktree), plain `git -C <path> diff` silently falls back as
if run outside any repository at all, rather than failing loudly — so a tampered worktree and a
clean one both produced empty-looking output, defeating the check it exists to run. Fixed the
same way as `publish-pr.mjs` (JUL-71): `-c safe.directory=<worktreePath>`, scoped to exactly the
path the caller passed in.

## Publishing

Every GitHub write — branch push, PR open, merge — goes through the publisher scripts
(`scripts/publish-pr.mjs`, `scripts/merge-pr.mjs`), which mint a short-lived
`julia-graph-publisher` installation token via `scripts/publish-via-github-app.mjs`. Merging
requires `--sha <reviewed-head-commit>`; GitHub refuses the merge with 409 if the PR head moved
since review (`scripts/merge-pr.mjs`, JUL-61 step 4).

**The publisher App cannot edit `.github/workflows/*` — deliberately, not a bug to work
around.** `julia-graph-publisher` has no `workflows` permission, so GitHub refuses any push
that touches a workflow file with "refusing to allow a GitHub App to create or update
workflow ... without `workflows` permission" (hit live, JUL-61 retro follow-up). The machine
that publishes code should not also be able to edit its own CI. A check that would otherwise
need a new CI step belongs in `scripts/*.test.mjs` instead — CI already runs that whole suite,
so a new test file lands the check without ever touching `.github/workflows/`.

**After a PR merges, start the next change from `git checkout -b <name> origin/main` — never
rebase the old local branch.** Rebasing a branch whose earlier commit was already squash-merged
produces a "skipped previously applied commit" warning and a non-fast-forward push, and
recovering the pre-rebase state costs a `git reflog`/`git fsck` detour (a real incident in
JUL-61). A fresh branch from `origin/main` avoids the whole class of problem.

**Credential location, moved 2026-09-17 (JUL-61):** the App's private key now lives at
`/etc/orchestrator-svc/.env.publisher` on the server (owner `orchestrator-svc:orchestrator-svc`,
mode `600`; parent dir mode `700`). It previously lived only at
`C:\Julia\.env.publisher.local` on the laptop, loaded via Node's `--env-file` flag. That laptop
copy has **not** been deleted yet pending an explicit decision (see JUL-61's Linear thread) —
treat it as a stale duplicate, not a second source of truth, once the server-side copy is
confirmed working.

**Resolved (JUL-71):** publishing from the server, as `orchestrator-svc`, against a `runner`-owned
worktree is now exercised end to end. The wrinkle the previous paragraph anticipated was real:
`orchestrator-svc` *can* read into `/home/runner/julia-next` (file/dir permissions allow it), but
git itself refuses with `fatal: detected dubious ownership in repository at '...'` the moment the
process UID doesn't match the directory owner's UID — a guard unrelated to file permissions.
`publish-pr.mjs`'s own credential-safety design intentionally neutralizes global/system git config
per invocation (`GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=<empty file>`), so adding
`orchestrator-svc`'s own `--global safe.directory` entry does **not** help — it's wiped before
every push. The fix landed in `publish-pr.mjs` itself: both the `url.*.insteadOf` check and the
real push now pass `-c safe.directory=<cwd>`, scoped to exactly the `cwd` the caller already
passed in. This is a narrow, non-attacker-controlled value (never read from repo-local config),
orthogonal to the url-rewrite/credential-helper protections — it only asserts "trust this exact
path's ownership," nothing about credentials or remotes. Verified live: `orchestrator-svc` pushed
a real commit out of `/home/runner/julia-next` through the publisher successfully after this fix
(JUL-71's own readiness-review doc landed this way).

## The reviewer backup is DeepSeek Pro, not GLM (JUL-89, 2026-09-20)

`reviewer-backup` in `ops/service-dropbox/run-pi-seat.mjs` used to launch GLM-5.3, which the cost
rule bars (about $10 on a single issue). It is now `--provider deepseek --model deepseek-v4-pro`,
reading the `deepseek` drop-box field into `DEEPSEEK_API_KEY` in the child's environment only --
never argv, never a shell string (JUL-72). `deepseek-v4-pro` works through the native `deepseek`
provider; a full review on it cost about three cents. There is no fifth seat beside it.

- **GLM is removed (JUL-93, 2026-09-21).** It is no longer a selectable label, a seat, a
  drop-box field or a reader group. A card that still carries an old GLM label is refused by the Ready
  queue with a comment saying the label is retired; it is never re-mapped to another vendor (see
  the Pi paragraph in the coordinator skill).
- **The label names an entry, not the model.** `builder-backup` runs `deepseek-v4-flash` and
  `reviewer-backup` runs `deepseek-v4-pro`, each fixed in `run-pi-seat.mjs`. A
  `reviewer-deepseek-flash` or `builder-deepseek-pro` label is not honoured until JUL-102 wires the
  card's model through. The coordinator says on the card which model actually ran.
- A DeepSeek builder paired with this DeepSeek reviewer is the same model family; the family guard
  in `scripts/seat-labels.mjs` (`fallback`), not this file, is what refuses that pair.

## Builders run on Gemini, started by hand (JUL-98, Todd's 13:51Z Decision, 2026-09-22)

Claude's weekly allowance was forecast to run out Thursday morning, before Friday's reset. Until
the controller can start a Gemini worker itself (JUL-98 step 6, in progress), **the coordinator
starts Gemini (Antigravity, `agy`) builders by hand**, from the next dispatch, through the same
start-then-adopt route step 6's own build brief describes for the controller:

1. Start `agy` in the worker's fresh worktree and **wait until it has fully started** before
   doing anything else with it -- the same wait step 6's round-1 review (JUL-98 card, finding 3,
   2026-09-22 06:2xZ) named for the controller's own route: adopting a Pi/Gemini terminal too
   early loses the task text while still reporting `input_accepted` (also recorded above under
   "Adopting a Pi terminal with `worker-start --terminal` while Pi is still starting loses the
   task text").
2. **Pre-trust the new worktree in `agy`'s trust list before starting it** -- not after. An
   untrusted worktree blocks on a trust prompt no headless session can answer.
3. **Hand it over to Orca with `worker-start --terminal <handle>`** once started, not
   `worker-start --agent`, the same distinction the Pi/DeepSeek paragraph above draws for that
   seat's own launch shape.
4. **Never deliver the handover's own placeholder text as the task.** The real brief -- the step's
   concrete acceptance criteria -- is the one thing sent, not boilerplate left over from adopting
   the terminal.
5. **One report through the mailbox**, exactly as every other seat -- no polling a screen to guess
   whether Gemini is done.
6. **The cost line is read the same way as any other seat's**, not skipped or estimated: model,
   tokens, peak context, minutes, and Gemini's allowance used goes on the line like every other
   worker's.

**Reviews stay on Codex, not Claude**, until the GOAT reviewer trial (Todd's 13:43Z Decision,
same day) is live -- reviewing a Gemini builder's work with Claude would burn the very allowance
this Decision exists to protect. **The coordinator itself stays Claude** -- this Decision is about
the builder seat only, not the orchestrator seat in `SEAT_TABLE.orchestrator`. **The family rule
is unchanged**: Codex (`openai`) reviewing a Gemini builder is a different family either way, so
the existing `assertCanPickDifferentFamilies` guard in `graph/seat-table.mjs` is not violated by
this by-hand override -- it is not itself a seat-table code change, since `SEAT_TABLE.builder`
still names `claude`/`pi-deepseek`; Gemini is chosen by the coordinator at dispatch time until
step 6 gives the controller its own Gemini entry to read.

**Boundaries carried over unchanged from the 04:07Z Decision:** no new spend, the firewall rule
stays runner-only, the family rule is unchanged.

## Seven findings carried from the cancelled JUL-106 (recorded 2026-09-20)

JUL-106 (the watchdog) was cancelled after three rejected rounds; its detection code had been
written against payload shapes nobody had captured. These findings existed only in that card's
comments and in JUL-109's amendment. **Provenance:** items 1-3 and 5 were observed live on
2026-09-20 during that card's runs and have not been re-run since; items 4 and 6 were checked
against the code on `main` when this section was written; item 7 was proven live on 2026-09-20.
JUL-109 upgrades Orca and re-captures every Orca-side item as a saved fixture, so **re-check 1-3
and 5 on the pinned version before relying on them.**

1. **`orca orchestration worker-show --dispatch <id> --json` payload shape.** It carries
   `worker.state`, `worker.stage`, `worker.agentTerminalHandle`, `worker.lastError`; a
   **top-level** `observation` (`{status, exactWorker}`, plus `agentWait` once Orca has looked); a
   top-level `projection` (`stage`, `outcome`, `liveness`, `nextAction`); a top-level `terminal`;
   and `terminalResource.terminalHandle`. There is **no** `worker.status`, no
   `worker.terminalHandle`, no `worker.observation`. Code that read those absent fields sent every
   real worker down its "no terminal" path, so a blocking screen was invisible and a healthy worker
   resolved to `unknown` -- which is what got the watchdog rejected.
2. **`worker-list` is a different shape** and must never be assumed for `worker-show`: it uses
   `workerState` / `dispatchStatus`.
3. **`orca terminal wait` on a plain (non-agent) terminal.** `--for tui-idle` returns
   `satisfied: true` immediately even when the terminal is demonstrably mid-run -- worse than
   failing, because it reads as success. `--for exit --timeout-ms <ms>` is the one that really
   blocks: it holds for the full timeout, then returns `{ok:false, error:{code:"timeout"}}` with the
   shell still open. That is how anything waits in the foreground on a plain-terminal dispatch.
   (The `terminalWait` example in the coordinator skill uses `tui-idle`; do not read its result as
   proof the command finished.)
4. **What a queue-launched coordinator may actually run.** `scripts/julia-run.mjs` grants
   `Bash(orca *)` plus a fixed list of `node scripts/<name>.mjs` (`orca-cli`, `ready-queue`,
   `seat-labels`, `linear-cli`, `check-readiness`, `collect-worker-result`,
   `verify-reviewer-worktree`, `coordinator-events`, and the two publisher scripts, each granted
   both plainly and under `--env-file=/etc/orchestrator-svc/.env.publisher` (JUL-98 step 6, fixed
   2026-09-22 -- see "The coordinator's granted command list refuses..." above). So no `node -e`, no bare binary path, no
   `base64`, `printenv`, `ls`, or `git` outside its own checkout. `scripts/orca-cli.mjs` exposes
   only `run-list`, `task-list` and `worker-show` on the command line. **Every dispatch action goes
   through the `orca` binary on PATH.** The coordinator skill's examples are written as
   `orca-cli.mjs` calls that a real queue-launched coordinator cannot execute.
5. **`orca orchestration run-create` refuses outside an Orca terminal**
   (`no_active_sender_terminal`). A queue-launched coordinator must create a diagnostic terminal
   first and pass `--from <handle>`. That handle becomes the run's `coordinator_handle`, which is
   the wrong-binding trap: the run is bound to a terminal that is not the coordinator's own.
6. **The Pi seat gap (fixed by this change).** There was no DeepSeek reviewer seat:
   `reviewer-backup` was GLM, and `builder-backup` and `orchestrator-deepseek` were both pinned to
   `deepseek-v4-flash`. `scripts/seat-labels.mjs` maps `deepseek-pro` to `deepseek-v4-pro`, which
   had no launch route, so a coordinator following the skill for a `pi-deepseek` reviewer would
   have silently launched GLM. Now closed for the reviewer (section above); the label-to-model half
   is JUL-102, and JUL-89 covers every reviewer seat actually starting.
7. **The `deepseek` secret is readable by `runner` from inside an Orca-spawned terminal.** Proven
   live on 2026-09-20: `deepseek-readers` appears in the spawned terminal's own `id`, so the JUL-44
   stale-supplementary-groups trap (above) is not biting this seat. Confirm it still holds after the
   Orca upgrade in JUL-109.

## Orca is pinned at 1.4.205, and the JUL-106 findings re-checked (JUL-109, 2026-09-20)

**Pin.** `orca-ide` is 1.4.205 on the server for both `runner` and `orchestrator-svc`, held with
`apt-mark hold orca-ide` for the whole controller build. Both packages, their checksums and a
rollback recipe are in `/opt/orca-pin/`. Changing the pin is an admin session between cards,
recorded on JUL-109. The full record is `docs/research/jul109-orca-1.4.205-findings.md`; the real
responses every stand-in should be built from are in `graph/fixtures/orca-1.4.205/` (its README says
where each came from).

**The seven JUL-106 findings above, re-checked on 1.4.205:**

| # | Result |
|---|---|
| 1 `worker-show` shape | Confirmed, with one correction: there is **no** `terminalResource`. Top level is `worker`, `observation`, `projection`, `dispatch`, `terminal`, `server`, `remoteRuntimeEpoch`. The terminal is `terminal.handle` and `worker.agentTerminalHandle`. |
| 2 `worker-list` is a different shape | Confirmed. |
| 3 `terminal wait` on a plain terminal | Confirmed live: `--for tui-idle` said `satisfied: true` after 2.5 s on a terminal still running `sleep 90`; `--for exit --timeout-ms 8000` held 8.4 s then `timeout`. |
| 4 What a queue-launched coordinator may run | Confirmed live with the exact grant list: `orca status --json` allowed; `node -e`, `printenv`, `ls`, `git` refused. |
| 5 `run-create` outside an Orca terminal | Confirmed: `no_active_sender_terminal`. |
| 6 The Pi seat gap | Closed for the reviewer (`reviewer-backup` is `deepseek-v4-pro`) and probed the real way, below. The label-to-model half is still JUL-102. |
| 7 `deepseek-readers` in a spawned terminal | Confirmed: the terminal's own `id` lists `deepseek-readers`. |

**New traps found on 1.4.205** (each has a saved response):

- `projection.stage.activity` in `worker-show` stays `"unknown"` for a worker's whole life. Orca's
  "working" is `worktree ps` `agents[].state`. Do not wait for `activity` to become `working`.
- `worker-list` marks **every** worker `liveness: unverifiable / missing_status` and
  `attention.requiresAction: true`, including ones that finished cleanly, while `worker-show` says
  `live`. Neither is a stuck signal. The failure signature is `worker.state: failed` with
  `failedStage: agent_readiness`, `lastError: timeout`, `observation.status: identity_changed`.
- `worker-start` returning `stage: input_accepted` is **not** proof a turn started. Use
  `terminal send --wait-submit`: a healthy builder shows `["input_accepted","turn_started"]`, a
  screen stuck at a question shows `["input_accepted"]` and a warning.
- `--retry-request` honours only ids Orca issued (`mutation.requestId`, or `orchestrationRequestId`
  in an error). A client-made id is ignored, not replayed.
- `--retry-of` needs `--task <failed task>` (not `--spec`), reuses the task, and does not inherit
  placement. Lineage is `result.dispatch.retryOfDispatchId` (`worker-show`) and
  `dispatch.retry_of_dispatch_id` (`dispatch-show`).
- `worker_done` can arrive about 30 s before the agent is idle. Release a worker after
  `agents[].state` is `done`.
- Adopting a Pi terminal with `worker-start --terminal` while Pi is still starting loses the task
  text and still reports `input_accepted`. Wait for Pi to be up.
- **The runner account's first-run screens are cleared** (JUL-109): base-checkout trust in
  `~/.claude.json` (worktrees inherit it, but only from the exact base path; see the next section), `skipDangerousModePermissionPrompt`, and
  `env.DISABLE_AUTOUPDATER=1` in `~/.claude/settings.json`. Orca rewrites the hooks in that
  settings file on every daemon start; these keys survived two restarts. If a fresh builder ever
  fails `agent_readiness` again, read the terminal first: it is almost certainly one of these three.

## When a builder fails to start after a checkout change, and the failure path (JUL-109 follow-up)

**The base checkout's path is what Claude trusts.** Tested 2026-09-20: replacing the base checkout in
place (same path, fresh clone) is safe. Putting it at a **different path** brings back the eight-hour
failure exactly: `worker-start` returns `failed / agent_readiness / timeout` after 60 s and the terminal
shows "Is this a project you created or one you trust?". Trusting a parent folder does not help; only
the exact base path does. So, whenever the base checkout is moved or re-imported in Orca (Orca refuses
`project setup-update --path` for a repo-backed project; re-import it):

1. In `runner`'s `~/.claude.json`, set `projects["<new base path>"].hasTrustDialogAccepted = true`
   (with `allowedTools: []`). Do it in the same admin step as the move.
2. Start one builder in a fresh worktree of the new base and read `worker-show`. Success is
   `succeeded / settled` (or `worktree ps` `agents[].state: working`), not just a start that returned.
3. If it fails, read the worker's terminal before anything else.

**A reported failure looks like this.** `worker-show`: `worker.state: failed`, `stage: settled`,
`projection.outcome: failed`, `worker.lastError: null`, a terminal present. The worker's own reason is in
the task's `result` and in `dispatch.lastFailure`. A worker that never started instead has
`lastError: "timeout"` and no terminal. Fixtures: `graph/fixtures/orca-1.4.205/failure.*`. Acknowledge
each delivery (`check --ack <deliveryId>`) or the same message wakes the next wait. Retry with
`worker-start --task <same task> --retry-of <failed dispatch>` (repeat `--on`, `--worktree`, `--agent`);
Orca's own `failureCount` stays 0 for a reported failure, so the two-rounds rule is the controller's to count.

**Cost sources and rates** are in `docs/research/jul109-orca-1.4.205-findings.md` section 5 and
`graph/rate-table.mjs`. Two things to remember: a Claude transcript repeats each message once per content
block (count each `message.id` once) and is still about 15% under Claude Code's own record; and Pi's
Pi's printed DeepSeek dollars, DeepSeek's published price and the account balance all differ (on one measured review the balance was lowest: about $0.09, against $0.155 published and $0.22 Pi-printed), so treat a DeepSeek cost line as an upper estimate until a controlled run settles it.

**Two ways a cost line goes wrong, both found on JUL-98 step 3 (2026-09-21) and both now pinned by tests.**

1. *A total that double-counts.* Codex's `input_tokens` already includes the cached part, so summing the
   component fields of the recorded session gives 96,511 against the record's own `total_tokens` of
   51,199. Same failure mode as the PR #64 Claude extract. The rule, now mechanical in
   `graph/controller/cost.mjs`: `tokenTotal()` is the only place a token total is computed, and where a
   record states its own total, that total *is* the figure. A sum is used only when no record total
   exists (Claude's transcript). A doubled figure is worse than a blank one -- it is what the seat-choice
   decision is read from, and it points it the wrong way.
2. *A reader that answers "nothing" instead of refusing.* `claudeUsageFromTranscript` took parsed
   objects only. A real transcript is read off disk as **strings**, so `l.type` was `undefined` on every
   line and it returned an empty object, silently -- measured against the real 777-line transcript of a
   JUL-98 builder, 133 of whose lines carry `claude-opus-5` usage. That silent `{}` is why builder cost
   lines on that card read "not captured". It now takes either form (`parseTranscriptLines()` is the one
   reader), and nine real lines from that transcript are the fixture
   (`graph/fixtures/orca-1.4.205/cost.claude-transcript.real-builder-lines.jsonl`).

**A worker that never started has no cost to lose, and must still be cleaned up.** Read-cost-then-release-
then-remove is right for a worker that ran, but if no turn ever began there is no session file, so the
cost read can only fail -- and under the first version of `finishWorker` that failure stopped the order
and leaked the worktree (the `failed / agent_readiness / timeout` case above, whose `residualResources`
list is exactly the thing needing removal). Pass `turnStarted: false`: the read is skipped and the seat
gets an explicit never-started line (0 tokens, $0, `neverStarted: true`), which is accepted *because it
is marked*. An unmarked blank line still fails the step, as it always did.

**Standing rule for every finding: a gap is recorded with what breaks if it stays.** "No dollar figure for
Claude" is not a note, it is "the cost line will be blank for the seat doing most of the work". A gap
written down without its consequence reads as a footnote and gets skipped. Each row in a "not proven" list
carries two things: what was not proven, and what breaks if it stays that way. This sits beside the rule
that nothing is written as "assumed" or "should work": both exist so a reader cannot mistake an unknown
for a small thing.

## Stop / resume

- **Stopping a run in progress**: Orca's own recovery verbs (`worker-stop` for a proven
  failed/stopped attempt, `worker-abandon` to fence orchestration while accepting resources may
  remain live) — never `terminal close` as a substitute.
- **Recovering from a publish failure** (worker succeeded, publish step failed): the worker's
  commit still exists in its worktree on the runner — re-run just the publish step against that
  same worktree rather than re-dispatching the whole step.
- **Resuming after a disconnect**: reconcile against Orca's run/task list and the Linear issue's
  comment history — a step counts as verified only when you re-checked its evidence yourself,
  never a prior session's claim alone.

## Verification, after a run

1. Read the Linear issue's own comment thread — the coordinator posts admission, blocked, and
   acceptance updates there, not in chat.
2. Confirm the PR (if any) was opened by `julia-graph-publisher[bot]`, not a personal account.
3. Confirm in Axiom (dataset `julia-next-journey0`) that `coordinator_started` /
   `coordinator_progress` / `coordinator_completed` (or `_failed`) events exist for the run's
   `runId`, and no run is stalled (query in `SKILL.md`'s Journey accounting section).
4. Confirm `git log` on the pushed branch shows a real commit, and `main` was never pushed to
   directly.

## Observability

`scripts/coordinator-events.mjs`, `scripts/journey-events.mjs`, and the existing relay. Keep the
started/progress/completed/failed vocabulary; correlate by Run/Task/Dispatch IDs and the exact
commit. Publisher and access-check logs record sanitized action/outcome/commit evidence —
never credentials, OAuth URLs/codes, pairing material, or raw credential-bearing subprocess
output.

---

## JUL-43 history — not the current procedure

JUL-43 is closed; PRs #2 and #3 merged. The sections below are the original session record,
preserved for its verified evidence and failed-attempt history. Anything here that conflicts
with the sections above is superseded — this is historical record, not instructions to follow.

### Session 2

Held the Orca-dispatch coordinator in favor of a GitHub-Actions/BERTHA route
(`julia-next-supervised-worker-manual.yml`); that route was itself later held, because the
Linear-tracker AI-Stack code it depended on was only ever built in a throwaway local clone and
never actually pushed to `toddwyder/AI-Stack` — checked directly against AI-Stack's real `main`
branch, not assumed.

### Session 3 → 4

Restored the Orca-dispatch pieces session 2 deleted (adapted, not reverted verbatim), wired to
`.claude/skills/julia-coordinator/SKILL.md`. Session 3's two blockers (credential access, Orca
dispatch permission) were resolved and verified live in session 4:

- Fixed real bugs in `orca-cli.mjs`/`check-readiness.mjs`: the installed CLI's actual `--json`
  envelope is `{id, ok, result, _meta}` / `{ok:false, error:{code,message}}`, and a real failure
  can carry that structured body on stdout with a nonzero exit.
- Merged PR #2 (`79f9de3`) after confirming independent review, green checks, no outstanding
  review.
- Built `merge-pr.mjs` and `publish-pr.mjs`. Opened PR #3, resolved one real merge conflict with
  a normal local merge (not a force-push).
- Dispatched a real fresh Codex worker to review PR #3: **request changes** — two P1 security
  findings (App private key reaching the git subprocess environment; git hooks/credential
  helpers not disabled) and four correctness findings. Fixed all six via TDD; 45/45 tests green.
- A second fresh Codex worker verified the fix: one P1 remained (a repo-local
  `url.*.insteadOf` rewrite could still redirect the push and carry the token) — fixed by
  refusing to push at all when such a rewrite is present. 49/49 tests green, CI green.
- Live end-to-end proof of Journey accounting for a real run (`sent:true` for both
  `coordinator_started` and `coordinator_completed`).

**Not done in JUL-43**: PR #3's merge needed its own explicit authorization (granted later,
outside this session). No third review round was run after the second fix — two real rounds
each found and fixed genuine P1s, disclosed as the actual depth reached, not overclaimed as
exhaustive.

### Known open questions carried from JUL-43 (unresolved, re-check before relying on them)

- Linear's `commentCreate` mutation may need the ticket's internal UUID rather than its human
  identifier — untested against the real API from this route as of JUL-43; JUL-61's live
  comments on this issue are the actual proof this now works via `mcp__linear__save_comment`.
- The exact APL join syntax in the skill's stalled-run query is written from APL's documented
  shape, not verified against a real query on the live `julia-next-journey0` dataset.
- `gate.checkName: 'checks'` in `graph/julia-next.project.mjs` names the CI job in
  `.github/workflows/ci.yml`; nothing in this route currently reads `gate` for `tracker: 'linear'`
  configs. Present for parity with the config shape, currently unused.
