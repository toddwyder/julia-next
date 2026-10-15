# Check permanent prerequisites

This feature checks that every recorded permanent delivery-machine prerequisite exists at the
expected installed location and binds the observation to the exact candidate.

## Sub-features

- `doctor-identity` records the candidate commit and dirty-tree digest.
- `doctor-inventory` checks every recorded permanent prerequisite without changing it.
- `doctor-fail-closed` exits nonzero for a controlled missing or mismatched entry.

## How to get to it (user POV)

- From the repository root, run the `verify-machine` helper's `doctor` command.
- Read the retained `doctor.json` in the run's evidence directory.

## Driving it with verify-machine doctor

Preconditions:

- The skill's isolated evidence directory exists.
- No permanent prerequisite or inventory file is being changed.

```powershell
$doctorOutput = node --experimental-strip-types ops/mastra-agents/reviewer/src/mastra/verify-machine.ts doctor 2>&1
$doctorExit = $LASTEXITCODE
$doctorOutput | Set-Content -Encoding utf8 (Join-Path $evidenceDirectory 'doctor.json')
if ($doctorExit -ne 0) { throw "verify-machine Doctor failed with exit code $doctorExit" }

npm --prefix ops/mastra-agents/reviewer run test:jul-225
if ($LASTEXITCODE -ne 0) { throw 'controlled Doctor guard test failed' }
```

- **Check the machine.** The observable success result in `doctor.json` is `ok: true`, a
  40-character candidate commit, a `sha256:` dirty-tree digest, and no missing or mismatched entry.
- **Confirm the negative guard.** The temporary-inventory test passes without changing a real part.

## Gotchas

- Clean and dirty digests are both valid identities; the digest must match the candidate proved.
- A path existing is insufficient when an expected package version is recorded.
- Do not manufacture a failure by changing an installed prerequisite or the real inventory.
- Doctor is a prerequisite for another drive and independently observable here.
