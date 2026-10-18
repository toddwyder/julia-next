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

## GitHub write boundaries

- For authorized cards, use the approved delivery path and ordinary signed-in GitHub access where
  the card calls for it.
- Keep credentials, tokens, and other authentication material inside their trusted process; never
  expose their values in output, prompts, tickets, artifacts, or logs.
