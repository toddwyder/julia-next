# Julia-next server runbook

**Current operator runbook for the OVH server.** GitHub issues and Mastra Factory are the
current route (`docs/agents/work-execution.md`, ADR 0009). The retired graph/Orca dispatch
machinery and its history are archived in `docs/retros/server-runbook-graph-history.md`; nothing
there is a live route.

## Access

- **Operator SSH (over Tailscale):** `ssh -i ~/.ssh/ovh_runner_ed25519 ubuntu@100.125.239.98`
  (`scp -i` the same way; use Git Bash, not raw PowerShell).
- **`ubuntu` has passwordless sudo** as the installation channel: create accounts, install files
  under `/opt` and `/etc`, manage systemd, and run a command as another account with
  `sudo -u <account>`.
- **Keep SSH and sudo outside the Factory sandbox.** An authorized operator uses the laptop's
  Tailscale route; never copy a private key into Factory or request one in chat.
- **On a machine card the laptop agent is the operator.** A laptop agent working a
  `factory:machine` card is the authorized operator and may use this route for read-only server
  work (logs, files and read-only commands) without asking Todd. A server change (install,
  restart, configuration or writing sudo command) needs the card's approval. A Factory builder is
  never the operator.

## Factory service (Mastra Factory — current route)

- Factory runs as the dedicated `julia-factory` service account from `/var/lib/julia-factory/app`
  under `julia-factory-trial.service`, bound to `127.0.0.1:4111` behind the existing Tailscale
  HTTPS Funnel, with WorkOS login protection.
- The root-owned, mode-600 `/etc/julia-factory/factory.env` holds service configuration; never
  put credential values there.
- Installed versions are pinned: Factory 0.19.1, `@mastra/auth-workos` 1.6.6, core 1.74.0, SDK
  1.10.1. The aligned direct storage and memory packages are recorded in
  `ops/factory/app/package.json`.
- The WorkOS cookie-identity install patch was removed after the 1.6.6 upgrade. See
  `ops/factory/README.md` for the current approved-exceptions list and the installer.
- The normal Git identity is the verified Factory App bot, not a person; the Factory App is
  restricted to `julia-next`.

## Accounts and permission boundaries

| Account | Role | Access |
| --- | --- | --- |
| `ubuntu` | Server administrator — installation channel only, not a day-to-day identity | Passwordless sudo |
| `orchestrator-svc` | Publisher — holds the publisher credential, merges via the publisher App | Narrow exact-command sudo only (`/etc/sudoers.d/orchestrator-svc-checkout-sync` and `-ops`) |
| `runner` | Builder — writes in its own worktree, commits locally | Cannot read the publisher credential or publish |

- Verified live: `runner` cannot read `/etc/orchestrator-svc/.env.publisher` (permission denied).
  Builders never gain the publisher credential or the whole orchestrator group.
- SSH, sudo, and credential-adjacent operations stay outside the Factory sandbox and are done by
  an authorized operator, not a builder.

## Secret transport

- Every secret is read in-process (via `ops/service-dropbox/read-secret.mjs` `readSecret()`) and
  handed to the child only through `spawn`'s `env` option — never command arguments and never a
  shell string, so it never appears in `argv` and is never printed.
- **Never `cat` a drop-box secret file directly.** These are raw, non-`KEY=VALUE` tokens; a bare
  `cat` echoes the full value into whatever captured the command's output. Use `readSecret()`.
- Never print raw secret files. Publisher and access-check logs record sanitized
  action/outcome/commit evidence — never credentials, OAuth URLs/codes, pairing material, or raw
  credential-bearing subprocess output.
- After any `groupadd`/`usermod -aG` that a seat's secret access depends on, verify secret
  access again — supplementary groups are fixed at daemon start and are not re-read live.

## Publisher secrecy and scope

- Every GitHub write — branch push, PR open, merge — goes through the publisher scripts
  (`scripts/publish-pr.mjs`, `scripts/merge-pr.mjs`) as the `julia-graph-publisher` App, pinned to
  the reviewed head.
- An outside agent merges only its own setup or documentation PR through the publisher App, never
  a Factory card. There is no blanket or wildcard merge grant.
- The App's private key lives at `/etc/orchestrator-svc/.env.publisher` on the server (owner
  `orchestrator-svc:orchestrator-svc`, mode 600, parent dir mode 700), and at
  `C:\Julia\.env.publisher.local` on the laptop, loaded via Node's `--env-file`. Keep keys, JWTs,
  and installation tokens inside this trusted process; never expose their values in output,
  prompts, tickets, artifacts, or logs.
- The publisher App has no `workflows` permission, so it cannot edit `.github/workflows/*` —
  deliberately, not a bug to work around. Scope tokens to the intended repository and App.

## Data and checkout ownership

- Work in the assigned workspace/worktree. Do not overwrite or clean another worker's or the
  shared checkout's data. Destructive operations need an exact authorized target; retain the
  applicable backups and recovery steps below.

## Backups, rollback, and storage

- The retired graph/Orca rollback pin lives under `/opt/orca-pin/`; changing it is an admin
  session between cards. Retirement of old host units is recorded in
  `docs/agents/factory-platform-auth-change-log.md` (issue #144 before/after evidence).
- Factory storage and the trace store: see `ops/factory/storage-operations.md` (free-space
  thresholds, sandbox cleanup, DuckDB trace growth; never delete the live DuckDB or its WAL).
- Factory wait alerts and the storage monitor: see `ops/factory/README.md`.
- Backup/rollback for the Factory install itself is in `ops/factory/README.md` (`.before-*`
  backups and the reinstall wrapper).

## Residual accounts and retired machinery

- Service-unit removal does not prove account or key removal. Until retirement of old graph/Orca
  accounts and credential files is evidenced, treat the old account mappings and restrictions in
  `docs/retros/server-runbook-graph-history.md` as residual, not current. Do not probe secrets to
  settle it.
