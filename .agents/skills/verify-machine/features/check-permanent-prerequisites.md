# Check permanent delivery prerequisites

This feature tells an operator whether the exact checkout and all permanent delivery-machine
prerequisites are healthy without changing the machine.

## Sub-features

- `doctor-identity` records the candidate commit and dirty-tree SHA-256.
- `doctor-inventory` checks every recorded permanent prerequisite.
- `doctor-fail-closed` exits nonzero when a recorded part is missing or version-mismatched.

## How to get to it (user POV)

- From the repository root, run the `verify-machine` helper's `doctor` command.
- Open the retained `doctor.json` in the run's evidence directory.

## Driving it with verify-machine doctor

Preconditions:

- The skill's run-owned evidence directory exists.
- The permanent inventory and installed parts remain read-only.

```powershell
$doctorPath = Join-Path $evidenceDirectory 'doctor.json'
$doctorOutput = node --experimental-strip-types ops/mastra-agents/reviewer/src/mastra/verify-machine.ts doctor 2>&1
$doctorExit = $LASTEXITCODE
$doctorOutput | Set-Content -Encoding utf8 $doctorPath
if ($doctorExit -ne 0) { throw "verify-machine Doctor failed with exit code $doctorExit" }
$doctor = Get-Content -Raw -LiteralPath $doctorPath | ConvertFrom-Json
if (-not $doctor.ok -or $doctor.checked -ne 5) { throw 'Doctor did not find five healthy prerequisites' }
if ($doctor.candidateCommit -ne (git rev-parse HEAD)) { throw 'Doctor candidate does not match HEAD' }
```

- **Check the machine.** Observable success is exit code `0`, `ok: true`, five checked parts, no
  missing part or version mismatch, and candidate identity matching the checkout.
- **Retain proof.** `doctor.json` remains readable after cleanup.

## Gotchas

- A clean and a dirty candidate can both have identities; the digest must match what is reviewed.
- Path existence alone is insufficient when an expected package version is recorded.
- Do not manufacture a failure by changing an installed prerequisite or the inventory.
- Doctor is both a prerequisite for another drive and a separately mapped feature.
