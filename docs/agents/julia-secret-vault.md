# Julia secrets in 1Password

Todd authorized centralizing Julia service credentials in a dedicated **Julia** vault. No new tracker issue is needed. The first migration covers Vercel, Linear, Axiom and Sentry; unrelated older application secrets are left alone.

The official signed 1Password CLI is required. On Windows, open/unlock 1Password, enable Windows Hello, then enable **Settings → Developer → Integrate with 1Password CLI**. This authentication is performed in 1Password; never paste an account password, Secret Key or service account token into a card or chat.

## Migrate existing credentials

Run the following through the operator's authenticated terminal, supplying the known environment files in precedence order:

```powershell
$env:JULIA_OP_EXECUTABLE = 'the absolute installed op.exe path'
node scripts/julia-vault.mjs migrate --from-env 'existing.env' 'existing.env.local'
```

The tool creates or reuses the Julia vault and one item per configured service. It sends JSON item bodies over stdin, reads each item back, and checks the original field values before returning references. Secret values are never placed in command arguments or printed. Existing items with different values are refused, not overwritten. A successful retry reuses matching items. An absent credential is reported as a missing service; no replacement credentials are invented.

The saved `.julia/secrets.env` contains only `op://<vault-id>/<item-id>/<field>` references. `.julia/vault-launch.json` contains the vault ID, reference file path and CLI executable path. Both live outside the builder checkout. Keep source environment files until real service connections are proved with the first Julia cards. Vault readback alone does not establish the correct service/project/dataset or a working token. Preserve the existing Axiom dataset and Sentry project during import, and confirm their intended Julia destination before use.

## Launch Julia delivery

```powershell
node scripts/julia-vault.mjs init '$init' JUL-123
```

The wrapper runs the existing `$init` entry point with `op run`, stdout/stderr secret masking enabled, and no shell command expansion. It refuses plaintext values, unexpected fields, references outside the selected vault and inherited references to other vaults. Existing spending/start approval and release/UAT configuration still apply. Secrets exist only in the operator subprocess environment for its lifetime. Native builders and reviewer transports exclude deployment/telemetry/Linear credentials and all `OP_` bootstrap/session variables; provider authentication and PATH remain.

Desktop integration is suitable for supervised use and may prompt for Windows Hello. It does **not** restrict the authenticated desktop account to one vault. For unattended runs, use a 1Password service account granted **read_items only on Julia**, without write/share/create-vault permissions. Keep its bootstrap token in a protected Windows credential store and retrieve it only into the operator process, not a plaintext env file. Service-account creation and bootstrap installation are pending until account access is available; do not claim unattended vault isolation based on desktop integration alone.

Vercel's application runtime still needs its deployment environment values. Those are runtime projections of the canonical vault, rather than another manually maintained source. Migrating this runner does not delete cloud configuration or alter the paused Factory's credentials/service. The controlled Sentry error and actual Axiom delivery event remain first-card proofs.

Official references: [Windows CLI/app setup](https://www.1password.dev/cli/app-integration), [secret references and op run](https://www.1password.dev/cli/secrets-environment-variables), [service-account vault permissions](https://www.1password.dev/service-accounts/get-started).
