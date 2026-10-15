# Run an approved named-secret command

This feature launches one approved executable with only the explicitly named Julia vault fields;
the maintained real example reads a Linear card without exposing the Linear credential.

## Sub-features

- `named-secret-selection` rejects an empty or missing secret-name list.
- `bootstrap-removal` removes 1Password bootstrap state before the target starts.
- `linear-card-read` reads one real Linear card through the approved CLI entry point.

## How to get to it (user POV)

- Set `JULIA_VERIFY_CARD_ID` to the card chosen for this read-only proof.
- Run the restricted launcher with `LINEAR_API_KEY` and the repository's `linear-cli.mjs` command.
- Inspect the retained response and confirm it names the requested card.

## Driving it with julia-vault-windows.ps1 -RunArguments

Preconditions:

- Doctor passes and restricted vault verification succeeds.
- `JULIA_VERIFY_CARD_ID` names the real card authorized for this verification read.
- The drive performs no Linear mutation.

```powershell
$cardId = $env:JULIA_VERIFY_CARD_ID
if ($cardId -notmatch '^JUL-[1-9][0-9]*$') { throw 'JULIA_VERIFY_CARD_ID must name the selected card' }
$startedAt = Get-Date -Format o
$commandArguments = @('node', 'scripts/linear-cli.mjs', 'get-issue', $cardId)
$cardOutput = & .\scripts\julia-vault-windows.ps1 -SecretNames LINEAR_API_KEY -RunArguments $commandArguments 2>&1
$cardExit = $LASTEXITCODE
$cardOutput | Set-Content -Encoding utf8 (Join-Path $evidenceDirectory 'linear-card.json')
if ($cardExit -ne 0) { throw "real Linear card read failed with exit code $cardExit" }
$card = ($cardOutput -join "`n") | ConvertFrom-Json
if ($card.identifier -ne $cardId) { throw 'Linear returned a different card' }
[pscustomobject]@{
  feature = 'run-named-secret-command'
  command = "scripts/julia-vault-windows.ps1 -SecretNames LINEAR_API_KEY -RunArguments node,scripts/linear-cli.mjs,get-issue,$cardId"
  expected = "real Linear response for $cardId"
  observed = @{ identifier = $card.identifier; title = $card.title; state = $card.state.name }
  exitCode = $cardExit
  startedAt = $startedAt
  finishedAt = Get-Date -Format o
  sideEffects = 'read-only Linear query; no tracker or local configuration mutation'
} | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $evidenceDirectory 'drive.json')
```

- **Read the real card.** Observable success is exit code `0` and a parsed response whose identifier
  exactly equals `JULIA_VERIFY_CARD_ID`.
- **Limit exposure.** Evidence contains the card response and command but no credential or bootstrap
  value; the drive creates no tracker mutation.

## Gotchas

- `-SecretNames` and `-RunArguments` must be paired.
- Name only the field the target needs; do not expose unrelated Julia secrets.
- Reading a real card crosses an external boundary even though it is non-mutating.
- Do not turn this proof into a comment, state change, issue creation, or delivery start.
