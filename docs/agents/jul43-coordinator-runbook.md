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
| `orchestrator-svc` | Orchestrator. Read-only checkout, dispatches builders/reviewers, reads/writes Linear, holds the publisher credential. | None |

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

### Long-running Orca daemons hold stale supplementary groups (JUL-44)

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

**Workaround, no root required, verified live:** wrap the seat launch in `sg`, which lets a
process acquire a group it is already entitled to:
```sh
sg zai-readers -c "<the run-pi-seat.mjs command>"
```
Inside that, `id` reports `gid=1003(zai-readers)` and the secret reads fine.

**Permanent fix** (needs root, and it kills every terminal those daemons own — never do it
mid-run): `systemctl restart orca-server.service orca-server-orchestrator.service`.

**General rule:** after any `groupadd` or `usermod -aG` that a seat depends on, either restart
the daemons or wrap the launch in `sg`. Always verify secret access for a seat by reading it FROM
INSIDE an Orca-spawned terminal, never from an SSH login — those two differ, and only the first
matches how a real dispatch runs.

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

### The checkout-sync service can leave the base checkout's `main` stale while exiting 0 (JUL-44)

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
`ops/service-dropbox/run-pi-seat.mjs`, the very files that run depended on.

**Check before every dispatch** (do not assume a green timer means the ref is current); the count
this prints must be 0:
```sh
git -C /home/runner/julia-next rev-list --count main..origin/main
```

**Repair** when that count is nonzero and `rev-list --count origin/main..main` is 0 (clean
ancestor, so a fast-forward is safe):
```sh
git -C /home/runner/julia-next fetch origin main
git -C /home/runner/julia-next branch -f main origin/main
```

Verified live: after this repair, a newly created worktree had head `31e89e1`, not `ac73112`. If
`origin/main..main` is NONZERO, `main` has genuinely diverged — stop and investigate rather than
forcing it.

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
