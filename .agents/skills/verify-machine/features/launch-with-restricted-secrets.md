# Launch with restricted Julia secrets

This feature proves that the provisioned restricted Julia service account can resolve only the
configured Julia references without exposing their values.

## Sub-features

- `vault-verify` validates the installed bootstrap and single-vault scope.
- `vault-julia` launches the canonical Julia CLI with selected resolved references.
- `vault-command` launches one explicit executable with only named secret fields.
- `vault-admin` keeps provisioning and migration behind explicit operator authorization.

## How to get to it (user POV)

- Run `scripts/julia-vault-windows.ps1 -Verify` from PowerShell.
- Use `-JuliaArguments` for `connections`, `models`, or `init`.
- Use `-SecretNames` with `-RunArguments` for an explicit approved command.

## Driving it with julia-vault-windows.ps1

Preconditions:

- The provisioned restricted bootstrap and default launch configuration exist.
- No personal `OP_*` authentication is needed or supplied.

```powershell
$vaultOutput = & .\scripts\julia-vault-windows.ps1 -Verify 2>&1
$vaultExit = $LASTEXITCODE
$vaultOutput | Set-Content -Encoding utf8 (Join-Path $evidenceDirectory 'vault-verify.txt')
if ($vaultExit -ne 0) { throw "restricted vault verification failed with exit code $vaultExit" }
```

- **Verify restricted resolution.** The observable success result is exit code `0` and a message
  reporting a positive field count and `no values displayed`.
- **Inspect side effects.** Record that no account, credential, configuration, sign-in, or permanent
  part changed. The drive is read-only.

## Gotchas

- Never call `julia-vault.mjs` directly for a key operation on Windows.
- `-Provision` creates persistent access and is an account action, not routine verification.
- `migrate` can create vault items and files; it is not part of this proof.
- Do not copy resolved environment values into evidence or command arguments.
