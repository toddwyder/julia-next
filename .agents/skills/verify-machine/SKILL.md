---
name: verify-machine
description: Verify Julia's Windows delivery-machine commands, restricted secret launcher, and installed prerequisites; use before relying on or changing the laptop delivery surface.
---

# Verify machine

This skill was generated with the project-local `create-verification-skill` workflow. Run it from
the repository root on Todd's Windows laptop. Read [`features/README.md`](features/README.md)
before choosing a drive. Never recreate or probe Mastra Factory, and never remove, rewrite,
uninstall, sign out of, or otherwise alter a permanent machine part.

## Launch

There is no server or shared session to launch. Use the checked-out candidate directly. If
`node_modules` or `ops/mastra-agents/reviewer/node_modules` does not match its lockfile, run the
applicable `npm ci` first. Create an isolated evidence directory for this run:

```powershell
$runId = "$(Get-Date -Format 'yyyyMMddTHHmmssfff')-$PID"
$evidenceDirectory = Join-Path '.artifacts/verify-machine' $runId
New-Item -ItemType Directory -Path $evidenceDirectory | Out-Null
```

No background process is created. Two verification runs can coexist because each uses its own
evidence directory. Commands that write Julia configuration need a deliberately isolated
`JULIA_CONFIG_DIRECTORY`; commands that read the provisioned operator configuration must not run
concurrently with a delivery.

## Doctor

Run Doctor before every drive and save its exact output. It checks all recorded permanent install
locations and binds the run to the candidate commit and dirty-tree digest. A missing or mismatched
part exits nonzero.

```powershell
$doctorOutput = node --experimental-strip-types ops/mastra-agents/reviewer/src/mastra/verify-machine.ts doctor 2>&1
$doctorExit = $LASTEXITCODE
$doctorOutput | Set-Content -Encoding utf8 (Join-Path $evidenceDirectory 'doctor.json')
if ($doctorExit -ne 0) { throw "verify-machine Doctor failed with exit code $doctorExit" }
```

If anything looks wrong, rerun Doctor. Do not drive when `ok` is false, its candidate identity
differs from the checkout being proved, or another delivery owns the real Julia configuration.

## Drive

Choose exactly one current feature from the map and follow its commands literally. The supported
drivers are `verify-machine doctor`, `julia-vault-windows.ps1 -Verify`, and the vault launcher's
canonical `connections`, `models`, and read-only or Cancel `init` arguments.

The full `verify-machine rehearsal` remains available for the existing JUL-225 route proof, but it
crosses live model services and may spend money. Run it only when the card explicitly requires all
three live routes and the accepted limits cover it:

```powershell
$rehearsalPath = Join-Path $evidenceDirectory 'rehearsal.json'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/julia-vault-windows.ps1 `
  -SecretNames COMMANDCODE_API_KEY,LINEAR_API_KEY `
  -RunArguments node,--experimental-strip-types,ops/mastra-agents/reviewer/src/mastra/verify-machine.ts,rehearsal,$rehearsalPath
if ($LASTEXITCODE -ne 0) { throw 'verify-machine rehearsal failed' }
```

Do not substitute fixtures, mocked providers, direct secret reads, test-only endpoints, or an
already-running unidentified process for a real drive.

## Evidence

Keep evidence under `$evidenceDirectory`. Every proof includes `doctor.json`, the exact action or
command, expected result, observed stdout and stderr, exit status, timestamp, relevant side effects,
and a second read when persistence is part of the feature. Doctor supplies the exact candidate
commit and dirty-tree digest. A real-service drive identifies the service but never its credential.

Use a transcript record for the selected drive:

```powershell
$startedAt = Get-Date -Format o
$output = & powershell -NoProfile -ExecutionPolicy Bypass -File scripts/julia-vault-windows.ps1 -Verify 2>&1
$exitCode = $LASTEXITCODE
[pscustomobject]@{
  feature = 'restricted-secret-launch'
  command = 'scripts/julia-vault-windows.ps1 -Verify'
  expected = 'restricted account resolves configured Julia references without revealing values'
  observed = $output -join "`n"
  exitCode = $exitCode
  startedAt = $startedAt
  finishedAt = Get-Date -Format o
  sideEffects = 'read-only; no account, credential, configuration, or permanent-part changes'
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $evidenceDirectory 'drive.json')
if ($exitCode -ne 0) { throw "restricted secret launch failed with exit code $exitCode" }
```

Passing tests guard the recipes; they do not replace a real drive.

## Cleanup

Stop only processes whose identities were captured by this run. Doctor and `-Verify` start no
persistent process. The rehearsal helper disconnects and reaps only the ACP processes it created.
Remove only a run-specific isolated `JULIA_CONFIG_DIRECTORY` or scratch files named by the selected
feature recipe. Never remove evidence, permanent parts, sign-ins, package installs, or the real
Julia configuration.

After cleanup, prove that the evidence survived:

```powershell
if (-not (Test-Path -LiteralPath $evidenceDirectory)) { throw 'verification evidence was removed' }
Get-Content -LiteralPath (Join-Path $evidenceDirectory 'doctor.json') -TotalCount 20
Get-Content -LiteralPath (Join-Path $evidenceDirectory 'drive.json') -TotalCount 20
```

## Helpers

`ops/mastra-agents/reviewer/src/mastra/verify-machine.ts` is the executable lifecycle helper. Its
supported commands are `doctor` and `rehearsal EVIDENCE_PATH`. `doctor` is read-only. `rehearsal`
writes the requested evidence and owns cleanup for the Antigravity and Claude ACP processes it
starts.

`scripts/julia-vault-windows.ps1` is the only Windows launcher for commands needing Julia vault
secrets. Its verification drive is `-Verify`; canonical Julia CLI calls use `-JuliaArguments`; an
explicit approved executable uses `-SecretNames ... -RunArguments ...`. It uses the provisioned
restricted Julia service account and masks secret output. Do not call `julia-vault.mjs` directly
for key operations on Windows.

The structural guard is `node --test --test-reporter=spec scripts/verify-machine-skill.test.mjs`.
The current machine suite is `node scripts/julia-runner-suite.mjs`.
