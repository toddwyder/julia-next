param(
  [Parameter(Mandatory = $true)][string]$ConfigurationPath,
  [switch]$Provision,
  [switch]$Verify,
  [string[]]$JuliaArguments
)
$ErrorActionPreference = 'Stop'
$configuration = Get-Content -LiteralPath $ConfigurationPath -Raw | ConvertFrom-Json
$bootstrapPath = Join-Path (Split-Path -Parent $ConfigurationPath) 'runner-token.dpapi'
$provisionPath = Join-Path (Split-Path -Parent $ConfigurationPath) 'runner-provision.json'
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$savedOpEnvironment = @{}
Get-ChildItem Env: | Where-Object Name -like 'OP_*' | ForEach-Object { $savedOpEnvironment[$_.Name] = $_.Value }
$savedConfiguration = $env:JULIA_VAULT_CONFIG
try {
  if ($Provision) {
    if (Test-Path -LiteralPath $bootstrapPath) { throw 'Julia runner bootstrap already exists; refusing to create another account.' }
    if (Test-Path -LiteralPath $provisionPath) { throw 'Julia runner provisioning was already attempted; inspect or revoke that account before any retry.' }
    # Exclusive, durable intent precedes the external write. An interruption
    # parks provisioning instead of silently creating a second valid account.
    $intent = @{ name = 'Julia Windows runner'; vaultId = $configuration.vaultId; startedAt = [DateTimeOffset]::UtcNow.ToString('o'); phase = 'creation-started' }
    $intentBytes = [System.Text.Encoding]::UTF8.GetBytes(($intent | ConvertTo-Json))
    $intentStream = [System.IO.FileStream]::new($provisionPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try { $intentStream.Write($intentBytes, 0, $intentBytes.Length); $intentStream.Flush($true) } finally { $intentStream.Dispose() }
    $created = @(& $configuration.opExecutable service-account create 'Julia Windows runner' --expires-in 90d --vault "$($configuration.vaultId):read_items" --raw 2>&1)
    if ($LASTEXITCODE -ne 0) { throw '1Password could not create the Julia runner account; no credential output was displayed.' }
    $token = ($created -join "`n").Trim()
    if (-not $token.StartsWith('ops_')) { throw '1Password returned an unexpected service-account response; no credential output was displayed.' }
    $secureToken = ConvertTo-SecureString -String $token -AsPlainText -Force
    $encryptedToken = ConvertFrom-SecureString -SecureString $secureToken
    [System.IO.File]::WriteAllText($bootstrapPath, $encryptedToken)
    $access = [System.Security.AccessControl.FileSecurity]::new()
    $access.SetAccessRuleProtection($true, $false)
    $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $access.SetOwner($currentSid)
    $access.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($currentSid, 'FullControl', 'Allow'))
    $access.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'), 'FullControl', 'Allow'))
    Set-Acl -LiteralPath $bootstrapPath -AclObject $access
    $token = $null
    $created = $null
    $configuration | Add-Member -NotePropertyName bootstrapPath -NotePropertyValue $bootstrapPath -Force
    $configuration | Add-Member -NotePropertyName bootstrapExpiresAfter -NotePropertyValue ([DateTimeOffset]::UtcNow.AddDays(90).ToString('o')) -Force
    $configuration | ConvertTo-Json | Set-Content -LiteralPath $ConfigurationPath
    $intent.phase = 'bootstrap-stored'
    $intent | ConvertTo-Json | Set-Content -LiteralPath $provisionPath
  }
  if (-not (Test-Path -LiteralPath $bootstrapPath)) { throw 'Julia runner bootstrap is not installed for this Windows user.' }
  $secureToken = Get-Content -LiteralPath $bootstrapPath -Raw | ConvertTo-SecureString
  Get-ChildItem Env: | Where-Object Name -like 'OP_*' | ForEach-Object { Remove-Item -LiteralPath "Env:$($_.Name)" }
  $env:OP_SERVICE_ACCOUNT_TOKEN = [System.Net.NetworkCredential]::new('', $secureToken).Password
  $env:OP_BIOMETRIC_UNLOCK_ENABLED = 'false'
  $env:JULIA_VAULT_CONFIG = $ConfigurationPath
  $visibleVaults = @(& $configuration.opExecutable vault list --format json 2>&1)
  if ($LASTEXITCODE -ne 0) { throw 'Restricted Julia runner authentication failed; no credential output was displayed.' }
  $vaults = ($visibleVaults -join "`n") | ConvertFrom-Json
  if (@($vaults).Count -ne 1 -or $vaults[0].id -ne $configuration.vaultId) { throw 'Julia runner access does not match the single configured vault.' }
  if ($Verify -or $Provision) {
    # Only presence flags leave the subprocess. No delivery or external service call.
    & $nodeExecutable (Join-Path $PSScriptRoot 'julia-vault.mjs') verify
  } else {
    & $nodeExecutable (Join-Path $PSScriptRoot 'julia-vault.mjs') init @JuliaArguments
  }
  if ($LASTEXITCODE -ne 0) { throw 'Julia vault subprocess failed; inspect its masked output.' }
} finally {
  Get-ChildItem Env: | Where-Object Name -like 'OP_*' | ForEach-Object { Remove-Item -LiteralPath "Env:$($_.Name)" }
  foreach ($entry in $savedOpEnvironment.GetEnumerator()) { Set-Item -LiteralPath "Env:$($entry.Key)" -Value $entry.Value }
  $env:JULIA_VAULT_CONFIG = $savedConfiguration
  $secureToken = $null
}
