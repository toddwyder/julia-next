# Julia-next server runbook

**Current operator runbook for the OVH server.** Linear is the card tracker; GitHub owns code,
pull requests, and CI. Mastra Factory is retired and is not a server route. The retired graph/Orca
dispatch machinery and its history are archived in `docs/retros/server-runbook-graph-history.md`;
nothing there is a live route.

## Access

- **Operator SSH (over Tailscale):** `ssh -i ~/.ssh/ovh_runner_ed25519 ubuntu@100.125.239.98`
  (`scp -i` the same way; use Git Bash, not raw PowerShell).
- **`ubuntu` has passwordless sudo** as the installation channel: create accounts, install files
  under `/opt` and `/etc`, manage systemd, and run a command as another account with
  `sudo -u <account>`.
- **Keep SSH and sudo outside automated runners.** An authorized operator uses the laptop's
  Tailscale route; never copy a private key into an agent workspace or request one in chat.
- **The laptop agent is the operator for an authorized card.** It may perform read-only server
  work without a separate prompt. A server change needs the card's approval.

## Retired Factory service

Factory's service, account, Funnel endpoint, credentials, database, timers, and repository source
were removed. Do not recreate or probe the former paths. Historical evidence lives in Git only.

## Accounts and permission boundaries

| Account | Role | Access |
| --- | --- | --- |
| `ubuntu` | Server administrator — installation channel only, not a day-to-day identity | Passwordless sudo |
| `orchestrator-svc` | Service operator — maintains the deployed checkout | Narrow exact-command sudo only (`/etc/sudoers.d/orchestrator-svc-checkout-sync` and `-ops`) |
| `runner` | Builder — writes in its own worktree and commits locally | No sudo access |

- SSH, sudo, and credential-adjacent operations stay outside automated runners and are done by an
  authorized operator, not a builder.

## Secret transport

- Every secret is read in-process (via `ops/service-dropbox/read-secret.mjs` `readSecret()`) and
  handed to the child only through `spawn`'s `env` option — never command arguments and never a
  shell string, so it never appears in `argv` and is never printed.
- **Never `cat` a drop-box secret file directly.** These are raw, non-`KEY=VALUE` tokens; a bare
  `cat` echoes the full value into whatever captured the command's output. Use `readSecret()`.
- Never print raw secret files. Service and access-check logs record sanitized
  action/outcome/commit evidence — never credentials, OAuth URLs/codes, pairing material, or raw
  credential-bearing subprocess output.
- After any `groupadd`/`usermod -aG` that a seat's secret access depends on, verify secret
  access again — supplementary groups are fixed at daemon start and are not re-read live.

## GitHub write boundaries

- For authorized cards, use the approved delivery path and ordinary signed-in GitHub access where
  the card calls for it. The publisher scripts remain owned by the separate graph service and are
  not a general card-delivery route.
- Keep credentials, tokens, and other authentication material inside their trusted process; never
  expose their values in output, prompts, tickets, artifacts, or logs.

## Data and checkout ownership

- Work in the assigned workspace/worktree. Do not overwrite or clean another worker's or the
  shared checkout's data. Destructive operations need an exact authorized target; retain the
  applicable backups and recovery steps below.

## Backups, rollback, and storage

- The retired graph/Orca rollback pin lives under `/opt/orca-pin/`; changing it is an admin
  session between cards. Retirement of old host units is recorded in
  `docs/agents/factory-platform-auth-change-log.md` (issue #144 before/after evidence).
- Factory has no live storage, trace store, alerting, or install rollback procedure.

## Residual accounts and retired machinery

- Service-unit removal does not prove account or key removal. Until retirement of old graph/Orca
  accounts and credential files is evidenced, treat the old account mappings and restrictions in
  `docs/retros/server-runbook-graph-history.md` as residual, not current. Do not probe secrets to
  settle it.
