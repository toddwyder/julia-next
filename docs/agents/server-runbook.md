# Julia server runbook

Linear holds cards and requirements. GitHub holds code, pull requests, and CI. Mastra Factory is retired; do not use it as a server route.

## Authority

Todd's latest card decision controls server changes. Ask Todd only for an indispensable account action, spending beyond the card cap, or a household product decision.

Do not restore `julia-agent`, the old learning helper, the retired build service, or the former root control deployment. Do not repeat the completed one-time vault bootstrap.

## Agent commands

Run commands that need Julia credentials through this wrapper from the repository root:

```sh
node scripts/julia-agents.mjs -- <command> [args...]
```

The wrapper reads `/home/ubuntu/.config/julia-agents/service-account-token`, clears inherited 1Password authentication overrides, and invokes `op run --env-file=scripts/julia-agents.env`. Never print credentials, OAuth links or codes, pairing material, or raw credential-bearing subprocess output.

Installation details and unit names live in [the systemd README](../../ops/build-runner/systemd/README.md). The committed installers and service configuration own checkout paths. Permanent prerequisites live in [permanent-machine-parts.json](permanent-machine-parts.json).

The server-tests worker needs Bun 1.4.4 on its service PATH (`~/.local/bin/bun`) because `test-owners.mjs --install` installs the poteto-mode scripts owner from its `bun.lock`. Without it, the server receipt fails before any test runs.

## Model connections and card accounts

Use `ops/build-runner/connections.mjs` with `ops/build-runner/machine-settings.json` for stock subscription sign-ins. Todd completes only the account approval. Access and refresh tokens never enter reports or repository files.

`machine-settings.json` owns model roles and the shared `authPath` and `ledgerPath`. It carries no model list: the Start page and the worker read model IDs, prices and bounds from the models.dev catalogue, with CommandCode's own model list and prices filling models models.dev lacks. A model without a published price is refused. Never replace the shared stores with per-run stores. The stock SDK owns token renewal. [ADR 0022](../adr/0022-subscriptions-and-card-cap.md) records the accounting policy.

## GitHub boundaries

Use ordinary signed-in GitHub access for authorized cards. Keep authentication material inside its trusted process. Evidence and notes belong on the card branch and pull request.
