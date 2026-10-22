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

## Agent account

Todd’s latest 22 October 2026 decision keeps agents as ubuntu on the existing connection.
julia-agent remains in place, unused. The builder’s admin rights, control-page pass access,
ability to change runner limits and deployed-code route are accepted. The ubuntu lockdown,
account handoff and related denial/tamper-protection proof are dropped. No new safeguards
are introduced for those risks. Only an actual occurrence of an accepted risk stops for Todd’s response. Ordinary tool/test errors are diagnosed and fixed in place.

Julia worktrees, GitHub sign-in, post-commit push setup, Codex config/auth and agents pass
are restored under /home/ubuntu. Existing worktree links are repaired. The old learning
helper remains deleted. Do not repeat the completed one-time vault bootstrap.

## Secret transport

- Laptop delivery commands that need a Julia secret run through
  `scripts/julia-vault-windows.ps1`, as required by `AGENTS.md`.
- Never print credentials, OAuth URLs or codes, pairing material, or raw
  credential-bearing subprocess output.

### Key copies and rotation

Todd's 22 October 2026 06:09 decision for JUL-250 is to copy, never move, the
CommandCode, Linear, Sentry and Axiom items from `Julia` into `Julia agents` after
settling the card. The
originals and the laptop/control-page references stay unchanged. Copies are
independent: when rotating any of these provider credentials, update both the original
in `Julia` and its copy in `Julia agents`, then verify both uses. See
[1Password's copy instructions](https://support.1password.com/move-copy-items/).

### Server agent commands

Use `node scripts/julia-agents.mjs -- <command> [args...]` from the repository root.
This thin bootstrap reads the already-provisioned agents pass at
`/home/ubuntu/.config/julia-agents/service-account-token` (ubuntu-owned 0600 inside an
ubuntu-owned 0700 directory), clears inherited 1Password authentication overrides and invokes
stock `op run --env-file=scripts/julia-agents.env -- <command> [args...]` with normal masking.
The committed env file contains only references for the four copied items and eight fields.
An unavailable pass fails before child effects; there is no control-page, desktop or Connect fallback.

The one-time saved-bootstrap-item read and protected receipt are complete. Do not repeat that read
or recreate the account. Later agent commands authenticate only with the new agents pass. The
former item-23 ubuntu lockdown is abandoned. The latest decision keeps agents as ubuntu; julia-agent stays unused.
No further privilege changes are required.

Machinery learning/Proof uses Beam alone under Todd's 22 October 07:35–07:44 rule in AGENTS.md;
Claude's 06:58 $0.0000 Beam usage-page read is accepted evidence. No further cost polling is needed.
Real building remains Codex GPT-6 Sol and real review remains DeepSeek through CommandCode under $1/card.

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
- **Agent restart:** `sudo -n /usr/local/sbin/julia-control-deploy-and-restart` (no arguments).
- **Operator restart:** ubuntu retains its existing admin access.

## GitHub write boundaries

- For authorized cards, use the approved delivery path and ordinary signed-in GitHub access where
  the card calls for it.
- Keep credentials, tokens, and other authentication material inside their trusted process; never
  expose their values in output, prompts, tickets, artifacts, or logs.
