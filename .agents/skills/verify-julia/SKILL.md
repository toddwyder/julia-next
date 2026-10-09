---
name: verify-julia
description: "Verify Julia's rendered home page and install manifest/assets in an isolated local browser session; use after changing either surface or when checking a candidate build."
---

# Verify Julia

Use this skill to verify the two existing public surfaces: the Julia home content and the install manifest with its PNG icons. It does not prove installation on a phone.

## Launch

Install exactly the locked candidate dependencies from the repository root when `node_modules` is absent or stale, then start the isolated Julia development server and capture its run record:

```powershell
npm ci
$run = node scripts/verify-julia.mjs launch | ConvertFrom-Json
$run | ConvertTo-Json | Set-Content -Encoding utf8 "$($run.evidenceDir)\launch.json"
```

The helper chooses an unused ephemeral localhost port and creates a unique run ID, Playwright session name, isolated Next.js output directory, and run-specific evidence directory returned as `$run.evidenceDir`. Launch waits until the assigned listener belongs to its Next.js process tree and `/api/health` returns `status: ok`; it does not return a merely assigned or open port. It records commit, dirty-tree digest, process identity, port, readiness result, and dependency versions, and redirects the server log into the evidence directory. Do not drive an existing or unidentified server. Keep `$run` in this PowerShell session; after opening a new shell, restore it from the active run record with `$run = Get-Content .artifacts/verify-julia/run.json -Raw | ConvertFrom-Json`.

## Doctor

Run before driving and after any unexpected failure:

```powershell
$doctorOutput = node scripts/verify-julia.mjs doctor 2>&1
$doctorExit = $LASTEXITCODE
$doctorOutput | Set-Content -Encoding utf8 "$($run.evidenceDir)\doctor.json"
if ($doctorExit -ne 0) { throw "Doctor failed with exit code $doctorExit" }
```

Doctor requires the current checkout, commit, dirty-tree digest, and Playwright version to match the launch record. It verifies the recorded Next.js command and process creation time, then confirms that the listener belongs to that process tree. It retries `/api/health` up to three times within six seconds to tolerate a Windows cold build. It reports the run ID, URL, session name, commit, digest, process/listener IDs, tool versions, attempt count, and health result. Any mismatch fails closed; clean up that run before starting another.

## Drive

Run the Playwright CLI only after Doctor passes. Use the unique session name returned in `$run.session`; the profile is in-memory, and the URL and session are isolated for this run. Never attach to or close another session. From the repo root:

```powershell
npx --no-install playwright cli "-s=$($run.session)" open $run.url
npx --no-install playwright cli "-s=$($run.session)" snapshot --filename "$($run.evidenceDir)\home-snapshot.yml"
```

Use the snapshot's current element refs or the targeted commands in the two feature recipes. Do not dump full DOM or console output into model context. The CLI's coding-agent skill is installed in the canonical `.agents/skills/playwright-cli` directory by the locked Playwright 1.63.0 CLI's `cli install --skills=agents` command.

## Evidence

Capture the action and resulting state in `$run.evidenceDir`:

```powershell
npx --no-install playwright cli "-s=$($run.session)" goto $run.url
npx --no-install playwright cli "-s=$($run.session)" screenshot --filename "$($run.evidenceDir)\home.png"
npx --no-install playwright cli "-s=$($run.session)" --raw eval "JSON.stringify({url: location.href, title: document.title, main: document.querySelector('main')?.innerText})" | Set-Content -Encoding utf8 "$($run.evidenceDir)\home.json"
```

Follow the two feature-map entries for the full proof. Retain the Playwright actions and result files, screenshot, focused observations, console errors, actual manifest/icon responses, Playwright Test output and exit code, plus `launch.json`, Doctor output, and server log. Record that home/manifest verification has no persistent household-data side effect. Do not claim that manifest/icon checks prove installation on a phone. Keep full snapshots, console output, and traces on disk and inspect only relevant portions.

## Cleanup

Close only this run's named CLI session, then stop only the verified Next.js process tree and remove only its isolated `.next` output:

```powershell
if (npx --no-install playwright cli list | Select-String -SimpleMatch $run.session) { npx --no-install playwright cli "-s=$($run.session)" close }
node scripts/verify-julia.mjs cleanup
Test-Path $run.evidenceDir
Get-Content "$($run.evidenceDir)\launch.json" -TotalCount 20
```

Cleanup can run even if server startup failed or the server has already exited. It checks the exact process command and launch time before stopping a live process; if the root exited, it only stops child processes whose command path, launch time, and recorded port identify this run. Unverified descendants and any unrelated port owner are left untouched. If descendants remain, the isolated output is preserved. Cleanup clears this run record and preserves `$run.evidenceDir`. Verify the path and `launch.json` are readable after cleanup. Never delete another run's artifact directory.

## Helpers

The executable lifecycle helper is `scripts/verify-julia.mjs`. Its supported commands are `launch`, `doctor`, and `cleanup`; invocation is shown above. Launch selects an ephemeral free port and writes the run record to `.artifacts/verify-julia/run.json`. `JULIA_VERIFY_URL` tells the existing Playwright config to use that exact running server and skip its default port-3000 webServer:

```powershell
$env:JULIA_VERIFY_URL = $run.url
$testOutput = npm exec -- playwright test e2e/home.spec.mjs --reporter=line 2>&1
$testExit = $LASTEXITCODE
$testOutput | Set-Content -Encoding utf8 "$($run.evidenceDir)\playwright-test.txt"
"exitCode=$testExit" | Add-Content -Encoding utf8 "$($run.evidenceDir)\playwright-test.txt"
Remove-Item Env:JULIA_VERIFY_URL
if ($testExit -ne 0) { throw "Playwright regression failed with exit code $testExit" }
```

The helper does not install packages, alter household data, create a browser session, or drive UI actions. Use the existing Playwright CLI for browser work. For repeat regression, run the existing browser specs against the Doctor-verified URL; the same scripts execute without an AI model call.

## Framework map

| Need | Framework feature | Documentation |
| --- | --- | --- |
| Drive the rendered page from a named browser session | Playwright CLI sessions, snapshot, and screenshot | https://playwright.dev/docs/getting-started-cli |
| Repeat the checked-in home and install-surface assertions | Playwright Test CLI | https://playwright.dev/docs/test-cli |

For routine repeat verification, use the scripted Playwright spec; it requires no model call. Use the CLI skill for bounded first-run exploration and evidence capture.

## Maintenance

Use `/maintain-verification-skill` when these surfaces or their entry points change.
