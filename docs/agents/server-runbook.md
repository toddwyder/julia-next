# Julia server runbook

Linear holds cards and requirements. GitHub holds code, pull requests, and CI. Mastra Factory is retired; do not use it as a server route.

## Authority

Todd's latest card decision controls server changes. Ask Todd only for an indispensable account action, spending beyond the card cap, or a household product decision.

Do not restore `julia-agent`, the old learning helper, the retired build service, the former root control deployment, or the old machine kept at tag `old-machine-final`. Do not repeat the completed one-time vault bootstrap.

## Agent commands

Run commands that need Julia credentials through this wrapper from the repository root:

```sh
node scripts/julia-agents.mjs -- <command> [args...]
```

The wrapper reads `/home/ubuntu/.config/julia-agents/service-account-token`, clears inherited 1Password authentication overrides, and invokes `op run --env-file=scripts/julia-agents.env`. Never print credentials, OAuth links or codes, pairing material, or raw credential-bearing subprocess output.

## Add a CommandCode model to Mastra Code

Take the exact id from `https://api.commandcode.ai/provider/v1/models`. Append it to the `CommandCode` entry in `customProviders` in `/home/ubuntu/.local/share/mastracode/settings.json`. A new key goes into the same entry's `apiKey`; copy it from `COMMANDCODE_API_KEY` inside `node scripts/julia-agents.mjs -- <command>`, and never print it. Mastra Code also ships its own `commandcode` list, which can lag, so a model missing there is addressed as `mastracode/commandcode/<id>`. Prove it with `mastracode -p 'Reply with exactly: OK' -m <model id> -o json`. Kimi K3.1 Pro is `mastracode/commandcode/moonshotai/Kimi-K3.1-Pro`.

## GitHub boundaries

Use ordinary signed-in GitHub access for authorized cards. Keep authentication material inside its trusted process. Evidence and notes belong on the card branch and pull request.
