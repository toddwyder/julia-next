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
- **Agent dashboard:** `GET /julia-control/api/agents` reads Julia's persistent event ledger. Ingestion happens in the monitored launch process and instrumented Mastra runtime, independently of browser requests. The Julia-owned tables are `julia_agent_launches` and `julia_agent_events` in `JULIA_INITIALIZATION_DB`. Completed runs leave live cards and keep their history.
- **Monitored launches:** run `node --experimental-strip-types src/mastra/agent-monitor.ts <commandcode|codex> <configuration.json> <prompt.txt>` from the reviewer package. Configuration supplies `storagePath`, `cwd`, and explicit `launch` fields (`launchId`, `provider`, `cardIdentifier`, `cardTitle`, `role`, `model`, `stage`, `round`). CommandCode can also specify `maxTurns` and `allowTools`; its stock 100-turn default is retained. Proof sets a short explicit turn bound. This is a monitoring utility, not authorization to start the pending delivery runner.
- **Codex connection:** the operator starts the supported shared daemon. Julia obtains its socket from `codex app-server daemon version`, or uses the explicitly provisioned `JULIA_CODEX_SOCKET`. The service account must have access to that supported endpoint. A connection failure is logged and remains disconnected; private provider files are never a fallback.
- **CommandCode authentication:** provision the installed 1.72.3 CLI's supported API-key login under the account owning the child, using the restricted Julia vault route. The server's API-key environment variable alone does not sign the CLI in. Julia does not claim arbitrary existing interactive sessions.
- **Isolated verification:** `JULIA_CONTROL_PORT=0` selects an ephemeral loopback port for a distinct candidate process. The default remains 43123. See [JUL-243 framework map](jul-243-framework-map.md) and [approved Proof story](jul-243/jul-243-plan.md).

## GitHub write boundaries

- For authorized cards, use the approved delivery path and ordinary signed-in GitHub access where
  the card calls for it.
- Keep credentials, tokens, and other authentication material inside their trusted process; never
  expose their values in output, prompts, tickets, artifacts, or logs.
