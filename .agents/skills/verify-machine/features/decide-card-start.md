# Inspect and cancel a card start

This feature reads one real Ready Linear card, shows saved four-role choices and accepted limits,
and accepts an explicit Cancel without dispatching delivery.

## Sub-features

- `init-inspect` returns `awaiting-decision` with choices and limits.
- `init-cancel` records a no-dispatch cancellation after the real card read.

## How to get to it (user POV)

- Set `JULIA_VERIFY_CARD_ID` to the identifier of the complete Ready card selected for this run,
  then run the exact inspection and Cancel commands below.
- Do not add `Start`; the adapted runner remains pending implementation and verification.

## Driving it with julia-vault-windows.ps1 init

Preconditions:

- Doctor passes, `JULIA_VERIFY_CARD_ID` names a current Ready card with every required section, and
  restricted Linear access resolves.
- The proof is read-only inspection or `Cancel`; verification alone never authorizes `Start`.

```powershell
$cardId = $env:JULIA_VERIFY_CARD_ID
if ($cardId -notmatch '^JUL-[1-9][0-9]*$') { throw 'JULIA_VERIFY_CARD_ID must name the selected Ready card' }
$inspectOutput = & .\scripts\julia-vault-windows.ps1 -JuliaArguments @('init', $cardId) 2>&1
$inspectExit = $LASTEXITCODE
$inspectOutput | Set-Content -Encoding utf8 (Join-Path $evidenceDirectory 'init-inspect.json')
if ($inspectExit -ne 0) { throw "card inspection failed with exit code $inspectExit" }

$cancelOutput = & .\scripts\julia-vault-windows.ps1 -JuliaArguments @('init', $cardId, 'Cancel') 2>&1
$cancelExit = $LASTEXITCODE
$cancelOutput | Set-Content -Encoding utf8 (Join-Path $evidenceDirectory 'init-cancel.json')
if ($cancelExit -ne 0) { throw "card cancellation failed with exit code $cancelExit" }
```

- **Inspect the card.** The observable success result is `status: awaiting-decision`, the selected
  identifier, four role choices, and accepted spend/time limits.
- **Cancel without dispatch.** Success looks like `status: cancelled` and the selected identifier,
  with no model dispatch, snapshot, tracker mutation, or product change.

## Gotchas

- A Linear read is a real external-service boundary even though Cancel makes no write.
- An incomplete or non-Ready card fails admission; do not bypass it with a fixture.
- Start/resume are pending and can spend money or mutate run state; they are not mapped as working.
- Cancel is the safe real drive because it proves access and routing without model dispatch.
