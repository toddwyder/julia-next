# Manage model connections

This feature lets an operator list, add, reconnect, test, disable, and remove Julia's persisted
model-connection records while storing references rather than secret values.

## Sub-features

- `connections-list` displays redacted saved records.
- `connections-add` and `connections-reconnect` save an enabled route and secret reference.
- `connections-test` checks that an enabled real route advertises models.
- `connections-disable` and `connections-remove` stop or remove a saved route.

## How to get to it (user POV)

- Run the exact PowerShell recipe below through the restricted launcher.
- Use the isolated lifecycle for mutations; use the real store only for list or an explicitly
  required live test.

## Driving it with julia-vault-windows.ps1 connections

Preconditions:

- Doctor passes.
- Mutation drives set `JULIA_CONFIG_DIRECTORY` to a run-specific scratch directory.
- A live `test` drive names only the secret required by its configured route.

```powershell
function Invoke-ConnectionCommand([string]$evidenceName, [string[]]$arguments) {
  $output = & .\scripts\julia-vault-windows.ps1 -JuliaArguments $arguments 2>&1
  $exitCode = $LASTEXITCODE
  $output | Set-Content -Encoding utf8 (Join-Path $evidenceDirectory $evidenceName)
  if ($exitCode -ne 0) { throw "connection command failed with exit code $exitCode`: $($arguments -join ' ')" }
  return ($output -join "`n") | ConvertFrom-Json
}

$realList = Invoke-ConnectionCommand 'connections-list.json' @('connections', 'list')

$connectionScratch = Join-Path $evidenceDirectory 'connection-config'
$priorConfigDirectory = $env:JULIA_CONFIG_DIRECTORY
try {
  $env:JULIA_CONFIG_DIRECTORY = $connectionScratch
  $added = Invoke-ConnectionCommand 'connections-add.json' @('connections', 'add', 'verify-temp', 'commandcode', 'DeepSeek', 'CommandCode', 'COMMANDCODE_API_KEY')
  if (-not ($added.records | Where-Object id -eq 'verify-temp').enabled) { throw 'added connection was not enabled' }
  $reconnected = Invoke-ConnectionCommand 'connections-reconnect.json' @('connections', 'reconnect', 'verify-temp')
  if (-not ($reconnected.records | Where-Object id -eq 'verify-temp').enabled) { throw 'reconnected connection was not enabled' }
  $disabled = Invoke-ConnectionCommand 'connections-disable.json' @('connections', 'disable', 'verify-temp')
  if (($disabled.records | Where-Object id -eq 'verify-temp').enabled -ne $false) { throw 'connection was not disabled' }
  $removed = Invoke-ConnectionCommand 'connections-remove.json' @('connections', 'remove', 'verify-temp')
  if ($removed.records | Where-Object id -eq 'verify-temp') { throw 'connection was not removed' }
  $isolatedList = Invoke-ConnectionCommand 'connections-isolated-final.json' @('connections', 'list')
  if ($isolatedList.records | Where-Object id -eq 'verify-temp') { throw 'temporary connection survived final read' }
} finally {
  if ($null -eq $priorConfigDirectory) { Remove-Item Env:JULIA_CONFIG_DIRECTORY -ErrorAction SilentlyContinue }
  else { $env:JULIA_CONFIG_DIRECTORY = $priorConfigDirectory }
  if (Test-Path -LiteralPath $connectionScratch) {
    $evidenceRoot = [IO.Path]::GetFullPath($evidenceDirectory) + [IO.Path]::DirectorySeparatorChar
    $scratchPath = [IO.Path]::GetFullPath($connectionScratch)
    if (-not $scratchPath.StartsWith($evidenceRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'connection scratch escaped evidence directory' }
    Remove-Item -LiteralPath $scratchPath -Recurse -Force
  }
}

if ($env:JULIA_VERIFY_LIVE_CONNECTION -eq '1') {
  $connectionId = ($realList.records | Where-Object enabled | Select-Object -First 1).id
  if (-not $connectionId) { throw 'no enabled real connection is available to test' }
  $tested = Invoke-ConnectionCommand 'connections-live-test.json' @('connections', 'test', $connectionId)
  $testedRecord = $tested.records | Where-Object id -eq $connectionId
  if (-not $testedRecord.lastTest.ok) { throw 'live connection test did not succeed' }
  if ([int]$testedRecord.lastTest.modelCount -le 0) { throw 'live connection test returned no models' }
  $testedAt = [datetimeoffset]::MinValue
  if (-not [datetimeoffset]::TryParse($testedRecord.lastTest.testedAt, [ref]$testedAt)) {
    throw 'live connection test returned an invalid timestamp'
  }
}
```

- **List real records read-only.** Observable success is `ok: true` and redacted records with no
  secret values.
- **Exercise lifecycle in isolation.** Success looks like every mutation exiting `0` and the final
  isolated list containing no `verify-temp` record.
- **Test a live route only when required.** Set `JULIA_VERIFY_LIVE_CONNECTION=1`. The checked helper
  selects one enabled real ID and retains `connections-live-test.json`; the observable result has a
  positive model count and successful test timestamp.

## Gotchas

- `test` crosses a live provider boundary; file-backed lifecycle tests do not prove it.
- Never mutate the real connection store merely to demonstrate lifecycle operations.
- ACP discovery can take longer on a cold start; a timeout is not a zero-model result.
- A connection record stores an environment-field reference, never a credential value.
- The recipe validates the scratch path before cleanup and retains the evidence files.
