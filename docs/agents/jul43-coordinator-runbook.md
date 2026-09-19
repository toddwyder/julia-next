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

## Start

There is no scheduled trigger — explicit launch only. From inside an Orca terminal on the
`orchestrator-local` runtime (as `orchestrator-svc`), run:
```sh
node /srv/orchestrator-svc/julia-next/scripts/julia-run.mjs <ISSUE-ID>
```
It refuses as any other account, runs readiness, self-heals a stale checkout, refuses a
double-start, then starts a real Orca Run/terminal that invokes the `julia-coordinator` skill
(`disable-model-invocation: true`, so it must be named explicitly there) for that issue. Prints
the run id on success, or which step failed and why on failure. Once started, the coordinator
posts its own admission comment and reconciles Orca + Linear state itself — see
`.claude/skills/julia-coordinator/SKILL.md` for that procedure. **`julia-run.mjs` itself no
longer posts a start comment (JUL-73):** the separate `claude -p` call that used to do this
(`defaultPostCommentImpl`/`postStartComment`) was a second vendor dependency doing no real work,
since the coordinator's own first wake already posts admission to Linear.

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
`graph/seat-table.mjs`'s `orchestrator` entry instead: `claude` (primary) or `pi-glm` (backup),
tried automatically on a detected usage-cap error rather than hand-edited. See "Seat-table
backups: Pi (JUL-77)" below for the table itself and the cap-detection/fail-over mechanism.
`codex` is no longer a valid orchestrator entry — the table reserves it for the **reviewer**
seat instead, so this section's Codex login/MCP-approval knowledge stays relevant, just for a
different seat. Both orchestrator launch branches (`claude`, `pi-glm`) share the same env prefix
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
- **Reviewer/orchestrator backup — GLM-5.3, custom provider (pay-per-use, not the ZAI Coding
  Plan).** `ZAI_API_KEY` is the *native* env var name for ZAI's own Coding Plan integration
  (`docs/providers.md` table) — using it for a pay-per-use custom provider would be confusing, so
  the drop-box/launcher env var is named `ZAI_PAYG_API_KEY` instead, kept out of the native
  name entirely. `~/.pi/agent/models.json` for `orchestrator-svc` (**the public pi.dev docs site
  describe an older/different `providers: [ {id, type, ...} ]` array shape — wrong for this
  installed version; confirmed live against the bundled `models.md`**, correct shape is an
  object keyed by provider id, field `api` not `type`):
  ```json
  { "providers": { "glm-5-3": {
      "baseUrl": "https://api.z.ai/api/paas/v4/", "api": "openai-completions",
      "apiKey": "$ZAI_PAYG_API_KEY", "models": [ { "id": "glm-5.3", "name": "GLM-5.3" } ]
  } } }
  ```
  Launch: `pi --provider glm-5-3 --model glm-5.3 -p "<prompt>" --mode json`. Live-verified real
  reply from `api.z.ai`.
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
- Cost is reported per response (`usage.cost.total`) for DeepSeek; GLM-5.3 via the custom
  `openai-completions` provider reported `cost: 0` on the one live call made — likely the
  endpoint doesn't return usage-based pricing in the response for this route, not that the call
  was actually free. Unresolved: get a real per-session cost figure for the GLM backup seat
  before relying on the "cost per session recorded for each backup seat" acceptance line.
- **The `glm-5-3` `models.json` entry is per-identity, not shared** — it was only written for
  `orchestrator-svc` initially (which is all `julia-run.mjs`'s orchestrator-backup path needs),
  but the reviewer-backup seat dispatches as `runner` (PR #36 review finding). `runner` needed
  the identical `~/.pi/agent/models.json` entry added separately; live-verified working (real
  `pong` reply) only after that. Any *new* identity that ever runs a `pi-glm` seat needs this
  file written for it too — it does not follow from `orchestrator-svc`'s copy existing.

### Long-running Orca daemons hold stale supplementary groups (JUL-44) — fixed 2026-09-18

`zai.env` is `root:zai-readers` mode `0440`, and `/etc/group` correctly lists
`zai-readers:x:1003:runner,orchestrator-svc`. Both `id runner` and `id orchestrator-svc` (NSS
lookups) show `1003(zai-readers)`. But inside a terminal spawned by either Orca daemon, the `id`
of the process itself shows only its primary group — `uid=1001(runner) gid=1001(runner)
groups=1001(runner)` — and `test -r /etc/orca-runner/dropbox-secrets/zai.env` fails.

**Cause:** both daemons (`orca-server.service`, `orca-server-orchestrator.service`) were started
BEFORE `zai-readers` was created on 2026-09-18, and the supplementary groups of a process are
fixed at start and inherited by every child.

**Consequence:** the `pi-glm` reviewer-backup and orchestrator-backup seats cannot read their own
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
there are `axiom`, `deepseek`, `linear`, `powersync`, `sentry`, `supabase`, and `zai`. Vercel is
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
| `pi-deepseek`, `pi-glm` | `--thinking off` | `--thinking medium` / `--thinking high` |

`pi --thinking` REQUIRES a level (`off|minimal|low|medium|high|xhigh|max`). Low is `off`; Medium/High
pass `medium`/`high`. **A bare `--thinking` is a bug** (fixed 2026-09-19, JUL-79 relaunch): Pi reads the next
argument as the level, swallowing `-p`, and the coordinator prompt — which starts with the skill's `---`
front matter — is then rejected as `Error: Unknown option: ---`. The seat died at launch, silently (Pi
exits with no useful status in a terminal). The prompt is now always the last argument, after a `--`
separator, so it can never be read as an option. A one-word test prompt hides this bug — always test a
seat launch with the real skill text.

**Launcher (`scripts/julia-run.mjs`, `orchestratorLaunchCommandFor(entry, issueId, { effort })`).**
Two entries are new alongside `claude`/`pi-glm`:

- `codex` — stdin-pipe shape, same preamble as the Pi route: `{ cat
  .claude/skills/julia-coordinator/SKILL.md; printf ...; } | codex exec - -s danger-full-access
  <codex effort args>`, under the shared `ENV_PREFIX`. `-s danger-full-access` is the ONLY sandbox
  level under which Codex's per-write MCP approval gate lets Linear write-classified tool calls
  through (live-verified JUL-73; Codex has no per-tool allowlist). Note `orchestrator-svc`'s Codex
  login is usage-capped until Sep 19, 2026, so don't attempt a live Codex orchestrator run yet.
- `pi-deepseek` — identical to `pi-glm` but invoking the new `orchestrator-deepseek` seat.

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

### The six label groups and the label-name convention

The card's model/effort choices are six Linear label groups, one label per group:
`Orchestrator model`, `Builder model`, `Reviewer model`, `Orchestrator effort`, `Builder effort`,
`Reviewer effort`. The label names follow a fixed convention, and **code is the source of truth**:
the coordinator creates the matching Linear labels from `scripts/seat-labels.mjs`, never from a
hand-maintained list.

- Model labels: `<agent>-<vendor>-<model>`, with `<agent>` one of `orch`/`builder`/`reviewer`.
  Initial catalogue: `claude-opus`, `claude-sonnet`, `claude-haiku`, `codex`, `deepseek-pro`,
  `deepseek-flash`, `glm-5.3` — e.g. `orch-claude-opus`, `builder-deepseek-flash`,
  `reviewer-glm-5.3`.
- Effort labels: `<agent>-effort-low` / `-medium` / `-high`, e.g. `reviewer-effort-medium`.

`scripts/seat-labels.mjs` is pure (no I/O) and exports the group names, the label-name constants,
and `MODEL_CATALOG` (each model label → the `SEAT_TABLE` entry it means, plus the vendor's model
id where the route needs one). A later coordinator/launch step extends `MODEL_SPECS` there when a
vendor ships a new model. `resolveSeatChoices(labels)` returns each seat's `{ entry, effort,
modelLabel }`: a present model/effort label wins, an absent model falls back to the seat table's
`primary` and its default model (`claude`→`claude-opus`, `codex`→`codex`,
`pi-deepseek`→`deepseek-flash`, `pi-glm`→`glm-5.3`), and an absent effort is Medium.
`validateFamilyChoice` enforces builder family ≠ reviewer family (via `FAMILY_OF`) and that every
resolved entry is a real seat-table entry. `seatChoicesForIssue(issue)` is the read-only helper
the coordinator calls on a card it fetched through `linear-cli.mjs` (whose `getIssue` now requests
`labels { nodes { name } }`). The Ready queue fills any missing model/effort label (default +
Medium) before starting a card; a label not yet created on the team is skipped and logged, never
an error.

### The restart-after-finish gap, fixed with two belts

The gap: nothing moved a started card out of Ready, and the double-start guard only held while a
run was active — a finished run whose card was still in Ready would be started again, forever.
`scripts/ready-queue.mjs` now has both belts:

1. **State move.** After a successful start the queue sets the card's workflow state to the
   team's `In Progress` state through the injected Linear client (`findState` + `setIssueState`). A
   failure here is logged (`could not move <ID> out of Ready`) but never undoes the start.
2. **`lastStarted` cooldown.** The queue still records `lastStarted` (card id + the start
   fingerprint of labels/state/blockers + whether the state move succeeded) and, before anything
   else in the next cycle, refuses to start a card whose id and fingerprint match that record
   (`status: 'cooldown'`) — but only when that record says the state move **failed**. The fingerprint
   purposefully includes the labels the queue itself added, so a card Linear now returns with those
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

**(d) `ORCA_TERMINAL_HANDLE` is not set in a Claude orchestrator started by `julia-run.mjs`.** So
`orca orchestration run-current` fails there, and every orchestration command needs an explicit
`--from`. Verified 2026-09-19.

**(e) No repo command READS the GitHub API with the publisher token.** `publish-pr.mjs` only
pushes and opens; `merge-pr.mjs` only merges and does not check mergeability; `gh` on the server is
deliberately unauthenticated. The coordinator therefore cannot read a PR's `mergeable_state` and
relies on the merge API refusing a non-mergeable PR. Noted 2026-09-19 as a known gap.

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
| `systemctl start` / `stop` / `restart julia-ready-queue.timer` | Control the timer. |
| `systemctl start` / `stop` / `restart julia-ready-queue.service` | Run, stop or restart one check on demand (the service is a oneshot). |
| `usermod -aG <group> <account>` for `{deepseek-readers, zai-readers} × {runner, orchestrator-svc}` | Adds a service account to a key-reader group the drop box already uses. Four exact pairs, not a pattern. |

**There is no rule that installs, copies or edits a file** (removed after the PR #44 review; the
test fails if one comes back, and on the server it also tries an `install` as `orchestrator-svc`
and requires sudo to refuse it). The earlier design copied the unit files from the checkout as root,
which meant a merged change could become root code — `orchestrator-svc` can merge its own PRs. Now
the units below are installed **by a laptop session only**; the graph can turn the timer on and off
but cannot change what it runs. A new unit, a changed unit, a new group or a new rule is a
laptop-session edit and install, never a graph action — park it, don't work around it.

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
members (same shape as `zai-readers`). `FIELD_GROUPS.deepseek`, `write-secret.sh`, its installed copy
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
