# Verify restricted Julia secrets

This feature proves that the provisioned restricted Julia service account resolves the configured
references without displaying their values or starting delivery.

## Sub-features

- `vault-bootstrap` validates the installed restricted bootstrap.
- `vault-scope` validates that the service account sees only the configured Julia vault.
- `vault-resolution` resolves configured fields and reports only their count.

## How to get to it (user POV)

- From the repository root, run `scripts/julia-vault-windows.ps1 -Verify` in PowerShell.
- Read the retained transcript in the run evidence directory.

## Driving it with julia-vault-windows.ps1 -Verify

Preconditions:

- Doctor passes.
- The provisioned restricted bootstrap and default launch configuration exist.
- No personal `OP_*` authentication is supplied.

```powershell
$startedAt = Get-Date -Format o
$vaultOutput = & .\scripts\julia-vault-windows.ps1 -Verify 2>&1
$vaultExit = $LASTEXITCODE
$vaultOutput | Set-Content -Encoding utf8 (Join-Path $evidenceDirectory 'vault-verify.txt')
[pscustomobject]@{
  feature = 'verify-restricted-secrets'
  command = 'scripts/julia-vault-windows.ps1 -Verify'
  stdoutAndStderr = $vaultOutput -join "`n"
  exitCode = $vaultExit
  startedAt = $startedAt
  finishedAt = Get-Date -Format o
  sideEffects = 'read-only; no delivery, account, credential, configuration, or permanent-part change'
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $evidenceDirectory 'drive.json')
if ($vaultExit -ne 0) { throw "restricted vault verification failed with exit code $vaultExit" }
```

- **Verify restricted resolution.** Observable success is exit code `0` and a message reporting a
  positive field count followed by `no values displayed`.
- **Check side effects.** No product, tracker, credential, configuration, or permanent part changes.

## Gotchas

- Never call `julia-vault.mjs` directly for a Windows key operation.
- `-Provision` creates persistent account access and is not this feature.
- Vault migration can create items and files and is not this feature.
- Do not copy resolved values into evidence or command arguments.
