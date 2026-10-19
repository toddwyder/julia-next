# Julia-next server runbook

Linear is the card tracker; GitHub owns code, pull requests, and CI. Mastra Factory is retired and is not a server route.

## Access

- **Host alias:** `ovh`.
- **Tailscale address:** `100.119.112.9`.
- **Public address:** `40.160.140.228`.
- **Operator SSH:** `ssh ovh`; its Windows SSH configuration uses user `ubuntu` and key
  `C:\Users\toddw\.ssh\ovh_runner_ed25519`.
- **Host OS:** Ubuntu 24.04, reinstalled 18 October 2026.
- **Keep SSH and sudo outside automated runners.** An authorized operator uses the laptop's
  Tailscale route; never copy a private key into an agent workspace or request one in chat.
- **The laptop agent is the operator for an authorized card.** It may perform read-only server
  work without a separate prompt. A server change needs the card's approval.

## Secret transport

- Laptop delivery commands that need a Julia secret run through
  `scripts/julia-vault-windows.ps1`, as required by `AGENTS.md`.
- Never print credentials, OAuth URLs or codes, pairing material, or raw
  credential-bearing subprocess output.

## Control page over Tailscale Serve

The control page runs on the host and is reached only over Tailscale Serve. A
Ready card that fails admission is listed as not startable with a plain-English
reason; the other Ready cards and the model list still load.

- **Code:** `/opt/julia-control/reviewer`.
- **Service:** `julia-control.service` runs `/usr/local/bin/julia-control-run` as
  the `julia-control` user. The wrapper injects the service-account token from
  systemd's credentials directory and resolves the vault references before
  starting `src/mastra/control-server.ts`.
- **Vault:** the server has its own read-only Julia service account at
  `/etc/julia-control/op-service-account-token` (root only). The account is
  scoped `read_items` on the Julia vault and cannot see other vaults.
  `/etc/julia-control/secrets.env` holds only `op://` references, never values.
- **Exposure:** `tailscale serve --bg --https=443 http://127.0.0.1:43123` publishes
  `https://ovh.tail91f394.ts.net` to the tailnet only. Funnel is off. The page
  itself accepts only a loopback Host or `ovh.tail91f394.ts.net`.
- **Boundary:** from a tailnet device the Serve URL reaches the loopback listener;
  the public address answers nothing.
- **Restart:** `sudo systemctl restart julia-control.service`.
- **Agent dashboard:** `GET /julia-control/api/agents` reads Codex JSONL from
  `JULIA_CODEX_SESSIONS` (default `~/.codex/sessions`), CommandCode JSONL from
  `JULIA_COMMANDCODE_PROJECTS` (default `~/.commandcode/projects`), and persisted
  Mastra traces. Normalized Codex detail is retained across restarts in the
  Julia-owned `julia_agent_activity_records` table inside the configured
  `JULIA_INITIALIZATION_DB`; raw prompts and raw tool output are not shown.

## GitHub write boundaries

- For authorized cards, use the approved delivery path and ordinary signed-in GitHub access where
  the card calls for it.
- Keep credentials, tokens, and other authentication material inside their trusted process; never
  expose their values in output, prompts, tickets, artifacts, or logs.
