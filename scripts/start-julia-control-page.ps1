$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$serverPath = Join-Path $repoRoot 'ops\mastra-agents\reviewer\src\mastra\control-server.ts'
Push-Location $repoRoot
try {
  & (Join-Path $PSScriptRoot 'julia-vault-windows.ps1') `
    -SecretNames @('LINEAR_API_KEY', 'COMMANDCODE_API_KEY') `
    -RunArguments @($nodeExecutable, '--experimental-strip-types', $serverPath)
} finally {
  Pop-Location
}
