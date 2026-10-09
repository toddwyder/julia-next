# JUL-204 Slice 3 handoff

## Entry points

- Verification workflow: `.agents/skills/verify-julia/SKILL.md`
- Feature index and two feature recipes: `.agents/skills/verify-julia/features/README.md`
- Lifecycle helper: `scripts/verify-julia.mjs`
- Existing browser assertions: `e2e/home.spec.mjs`
- Per-run URL and isolated Next output: `playwright.config.mjs`, `next.config.mjs`

## Verified operator commands

From the repository root in PowerShell, install the locked dependencies if needed, then launch and retain the run record:

```powershell
npm ci
$run = node scripts/verify-julia.mjs launch | ConvertFrom-Json
$run | ConvertTo-Json | Set-Content -Encoding utf8 "$($run.evidenceDir)\launch.json"
node scripts/verify-julia.mjs doctor
```

Launch returns only after its unique URL is served by the recorded Next process tree and `/api/health` reports `ok`. After Doctor passes, drive only `$run.url` with the named `$run.session` using the Playwright CLI. The feature recipes contain the exact home and manifest/icon commands. Repeat the checked-in assertions against the same server with:

```powershell
$env:JULIA_VERIFY_URL = $run.url
npm exec -- playwright test e2e/home.spec.mjs --reporter=line
Remove-Item Env:JULIA_VERIFY_URL
```

Close only the named CLI session, then clean up:

```powershell
npx --no-install playwright cli "-s=$($run.session)" close
node scripts/verify-julia.mjs cleanup
```

Cleanup preserves evidence. If the server root has exited, it only terminates child processes verified by candidate Next path, launch time, and run port; it leaves unverified processes untouched and preserves the isolated build output if descendants remain.

## Artifacts and scope

Each run's durable evidence is written to `.artifacts/verify-julia/<run-id>/evidence/` (launch and Doctor records, browser snapshot/screenshot, focused observations, test output, console results, and server log). The isolated Next build goes under `.next/verify-julia/<run-id>/` and is removed by cleanup when safe. These directories are local and ignored by Git.

The verified scope is the existing Julia home content and same-origin install manifest/icons; the proof does not claim installation on a phone. No persistent household data is changed.
