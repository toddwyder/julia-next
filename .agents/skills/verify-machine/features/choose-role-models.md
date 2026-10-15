# Discover and choose role models

This feature shows exact models offered by configured routes and saves one exact route/model choice
for each delivery role.

## Sub-features

- `models-list` discovers current Antigravity, Claude, and available CommandCode offers.
- `models-save` validates and saves exact defaults for all four roles.
- `models-boundaries` rejects absent offers, aliases, and disallowed company/service pairings.

## How to get to it (user POV)

- Run the exact PowerShell recipe below. It copies the currently selected exact IDs returned by the
  real list into an isolated configuration; it does not invent or hard-code an offer.

## Driving it with julia-vault-windows.ps1 models

Preconditions:

- Doctor passes and no other run owns an ACP model-discovery process.
- Save drives use a run-specific `JULIA_CONFIG_DIRECTORY` and input file.
- CommandCode discovery is requested only when its restricted secret is available.

```powershell
function Invoke-ModelCommand([string]$evidenceName, [string[]]$arguments) {
  $output = & .\scripts\julia-vault-windows.ps1 -JuliaArguments $arguments 2>&1
  $exitCode = $LASTEXITCODE
  $output | Set-Content -Encoding utf8 (Join-Path $evidenceDirectory $evidenceName)
  if ($exitCode -ne 0) { throw "model command failed with exit code $exitCode`: $($arguments -join ' ')" }
  return ($output -join "`n") | ConvertFrom-Json
}

$modelList = Invoke-ModelCommand 'models-list.json' @('models', 'list')
$defaultsPath = Join-Path $evidenceDirectory 'role-defaults.json'
$modelList.defaults | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $defaultsPath

$modelScratch = Join-Path $evidenceDirectory 'model-config'
$priorConfigDirectory = $env:JULIA_CONFIG_DIRECTORY
try {
  $env:JULIA_CONFIG_DIRECTORY = $modelScratch
  Invoke-ModelCommand 'models-save.json' @('models', 'save', $defaultsPath) | Out-Null
  $savedModels = Invoke-ModelCommand 'models-post-save-list.json' @('models', 'list')
  $expectedDefaults = $modelList.defaults | ConvertTo-Json -Depth 8 -Compress
  $observedDefaults = $savedModels.defaults | ConvertTo-Json -Depth 8 -Compress
  if ($observedDefaults -ne $expectedDefaults) { throw 'saved defaults differ from requested defaults' }
} finally {
  if ($null -eq $priorConfigDirectory) { Remove-Item Env:JULIA_CONFIG_DIRECTORY -ErrorAction SilentlyContinue }
  else { $env:JULIA_CONFIG_DIRECTORY = $priorConfigDirectory }
  if (Test-Path -LiteralPath $modelScratch) {
    $evidenceRoot = [IO.Path]::GetFullPath($evidenceDirectory) + [IO.Path]::DirectorySeparatorChar
    $scratchPath = [IO.Path]::GetFullPath($modelScratch)
    if (-not $scratchPath.StartsWith($evidenceRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'model scratch escaped evidence directory' }
    Remove-Item -LiteralPath $scratchPath -Recurse -Force
  }
}
```

- **List offers.** Observable success is a nonempty offer list identifying route, exact model ID,
  company, service, and coding capability, followed by cleanup of owned ACP processes.
- **Save isolated defaults.** Success looks like the same four exact selections in the independent
  `models-post-save-list.json` readback, with scratch state removed afterward.

## Gotchas

- Claude aliases such as `sonnet` are not exact provider IDs and must be rejected.
- Duplicate model IDs on different routes are different offers; preserve the route.
- Listing crosses live boundaries and can take time without making a model generation call.
- Do not overwrite the operator's real role defaults for verification.
- The recipe validates the scratch path before cleanup and retains the evidence files.
