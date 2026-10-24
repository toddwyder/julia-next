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

## OVH migration (Todd's 10 Oct 2026 decision)

The laptop launcher also accepts `COMMANDCODE_API_KEY`, stored as a concealed field
in **Julia CommandCode**. The normal delivery review transport requires
`authReference: "env:COMMANDCODE_API_KEY"` and calls CommandCode directly from a
local Node process. Preserve the saved model, thinking and spending selections
when updating the connection reference. Old `dropbox:commandcode` references fail
closed; there is no SSH fallback. The runner retains its request intent, worker
identity, timeout, interruption handling and substantive review validation.
Only the CommandCode reviewer child receives this key; native workers exclude
it, all `OP_` bootstrap variables and the operator's service credentials.

Preserve the existing references, bootstrap configuration and encrypted token
when adding fields; do not replace the configuration with a fresh default
migration file.

Confirm any deployment projections before revoking an older token. Sentry
runtime uses the DSN already in Julia; an old personal management token has no
code consumer. Supabase, PowerSync, native DeepSeek and the old controller's
Linear client ID/secret have no current laptop or application consumer. These
are **candidates to revoke later**, subject to account inventory. This migration
changes no credential, service, account or OVH resource.

## Launch Julia delivery

```powershell
.\scripts\julia-vault-windows.ps1 -JuliaArguments @('$init', 'JUL-123')
```

On Windows this restricted helper is the default and required entry point for every local command that needs a Julia vault key. It defaults to `%USERPROFILE%\.julia\vault-launch.json`; `-ConfigurationPath` is only needed for a deliberately separate operator configuration. For a non-delivery command, pass the executable and arguments without shell expansion:

```powershell
.\scripts\julia-vault-windows.ps1 -SecretNames COMMANDCODE_API_KEY -RunArguments @('node', '--test', 'path\to\provider-probe.test.mjs')
```

The helper runs the existing `$init` entry point or explicit command with `op run`, stdout/stderr secret masking enabled, and no shell command expansion. An explicit command must name the exact saved fields it needs with `-SecretNames`; all other Julia references stay absent from that child. The helper refuses plaintext values, unexpected fields, references outside the selected vault and inherited references to other vaults. Direct Windows `init`, `readIssue`, `verify` and `run` operations in `julia-vault.mjs` refuse personal desktop authentication and require the helper's service-account bootstrap. Existing spending/start approval and release/UAT configuration still apply. Secrets exist only in the operator subprocess environment for its lifetime. Native builders and reviewer transports exclude deployment/telemetry/Linear credentials and all `OP_` bootstrap/session variables; provider authentication and PATH remain.

Desktop integration is suitable for supervised use and may prompt for Windows Hello. It does **not** restrict the authenticated desktop account to one vault. For unattended runs, use a 1Password service account granted **read_items only on Julia**, without write/share/create-vault permissions. Keep its bootstrap token in protected Windows storage and retrieve it only into the operator process, not a plaintext env file. Do not claim unattended vault isolation based on desktop integration alone.

The Windows bootstrap helper implements this restricted account with a 90-day expiry. Provision it only after the operator explicitly approves that account, scope, lifetime and storage:

```powershell
.\scripts\julia-vault-windows.ps1 -ConfigurationPath 'operator-vault-launch.json' -Provision
.\scripts\julia-vault-windows.ps1 -ConfigurationPath 'operator-vault-launch.json' -Verify
.\scripts\julia-vault-windows.ps1 -ConfigurationPath 'operator-vault-launch.json' -JuliaArguments @('$init', 'JUL-123')
```

The helper stores only a current-user DPAPI-encrypted token, with file access restricted to that Windows user and SYSTEM. It clears personal `OP_` variables while running, verifies that the account sees exactly the Julia vault, and restores the original environment afterward. Its resolution probe uses the same validated reference snapshot as delivery and prints only a field count. Provisioning writes durable intent before creating the account; interruption or failed persistence parks the operation until account inspection/revocation, rather than creating duplicates. A token cannot be moved to another user or machine by copying the encrypted file. Before the recorded expiry, explicitly revoke/reprovision the account through 1Password administration. Never remove provisioning intent merely to force a retry.

Run the provision check and a separate resolution check before first use. The
restricted runner account must see only the Julia vault and resolve every
imported field. Live service proof belongs to the first cards.

Vercel's application runtime still needs its deployment environment values. Those are runtime projections of the canonical vault, rather than another manually maintained source. Migrating this runner does not delete cloud configuration or alter the paused Factory's credentials/service. The controlled Sentry error and actual Axiom delivery event remain first-card proofs.

Official references: [Windows CLI/app setup](https://www.1password.dev/cli/app-integration), [secret references and op run](https://www.1password.dev/cli/secrets-environment-variables), [service-account vault permissions](https://www.1password.dev/service-accounts/get-started).
