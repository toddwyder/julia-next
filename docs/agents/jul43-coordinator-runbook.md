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

## Start

There is no scheduled trigger — explicit launch only. From inside an Orca terminal on the
`orchestrator-local` runtime (as `orchestrator-svc`), run:
```sh
node /srv/orchestrator-svc/julia-next/scripts/julia-run.mjs <ISSUE-ID>
```

**Getting into that terminal from a bare SSH session** (e.g. via the Orca app itself, or the
exact commands a fresh session needs — a cold-reader run had to pull these from the CLI's own
`--help` instead of finding them here, which is the gap this fixes):
```sh
# As orchestrator-svc, create the terminal and run julia-run inside it:
/opt/Orca/orca-ide terminal create --environment orchestrator-local \
  --worktree "path:/srv/orchestrator-svc/julia-next" \
  --command "node /srv/orchestrator-svc/julia-next/scripts/julia-run.mjs <ISSUE-ID>" \
  --title "julia-run-<ISSUE-ID>" --json
# Returns {"result":{"terminal":{"handle":"term_...", ...}}} -- read that handle back:
/opt/Orca/orca-ide terminal read --environment orchestrator-local \
  --terminal <handle from above> --json
# Poll terminal read until its tail shows a run id (success) or an error line
# (failure) followed by the shell prompt returning -- there is no separate
# "wait for exit" step for a plain shell command like this one.
```
It refuses as any other account, runs readiness, self-heals a stale checkout, refuses a
double-start, then starts a real Orca Run/terminal that invokes the `julia-coordinator` skill
(`disable-model-invocation: true`, so it must be named explicitly there) for that issue and
posts the start comment (JUL-63). Prints the run id on success, or which step failed and why on
failure. Once started, the coordinator reconciles Orca + Linear state, advances the current
in-flight item, and admits the next eligible issue once a slot is free — see
`.claude/skills/julia-coordinator/SKILL.md` for that procedure.

**The headless launch needs its own tool grants — `claude -p` exits 0 even when every tool call
was refused.** Found across two real live wakes, each diagnosing its own gap and reporting back
instead of silently doing nothing:
1. Launched with no `--allowedTools` at all, the coordinator could reach neither Linear nor
   Orca.
2. With dispatch/readiness scripts granted but not the publish path, a real ticket would build
   and review, then be refused at publish.

`julia-run.mjs`'s launch command now grants: `mcp__linear__*` and `mcp__claude_ai_Linear__*`
(both Linear tool namespaces — see the CWD-dependent tool-name caveat on the start-comment step
above); `Bash` access to the exact scripts the skill's "Each wake"/"Running a step"/"After
verification" procedures name (`orca-cli.mjs`, `check-readiness.mjs`, `collect-worker-result.mjs`,
`verify-reviewer-worktree.mjs`, `coordinator-events.mjs`); the publisher credential file for the
two scripts that need it (`publish-pr.mjs`, `merge-pr.mjs`); and the bare `orca` CLI. If the
skill's own procedure grows to need another script or tool, its `--allowedTools` list in
`scripts/julia-run.mjs`'s `startOrchestrator` needs the matching grant added in the same PR.

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

**Open gap, disclosed not solved this session:** the publish scripts were run from the laptop
against the laptop copy for JUL-61 steps 4 and 5 (PRs #5, #6) — running them *as
`orchestrator-svc` on the server* against `/etc/orchestrator-svc/.env.publisher` has not yet
been exercised end to end. The likely remaining wrinkle: `publish-pr.mjs push` needs to run
with its `cwd` inside a real git worktree holding the commits to push (the builder's worktree,
owned by `runner`), and it's not yet verified that `orchestrator-svc` can read into a
`runner`-owned worktree path to do that. Resolve and verify this before treating "publish from
the server" as proven — don't assume the credential relocation alone finished the job.

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
