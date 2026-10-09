# Julia home content

The home page presents Julia's name and application version together with its welcome line.

## Sub-features

- `home-name` displays Julia's name on the home page.
- `home-version` displays the version from the checked-out application package.
- `home-welcome` displays the welcome line in the main content.

## How to get to it (user POV)

- Open Julia's root page at the URL printed by the verification Launch command.
- When Julia is already installed as a web app, opening Julia returns to the same root page; this recipe verifies the rendered page, not a device installation.

## Driving it with Playwright CLI

Preconditions:

- `$run` contains the JSON returned by `node scripts/verify-julia.mjs launch` in this same PowerShell session.
- `node scripts/verify-julia.mjs doctor` passes immediately before driving.
- The CLI session is opened with `npx --no-install playwright cli -s="$($run.session)" open $run.url`.

- **Navigate to Julia.** Open the root page in the named browser. Run `npx --no-install playwright cli -s="$($run.session)" goto $run.url`. The page URL equals `$run.url` and the `main` landmark is visible.
- **Capture the page structure.** Save a focused accessibility snapshot. Run `npx --no-install playwright cli -s="$($run.session)" snapshot main --filename "$($run.evidenceDir)\home-snapshot.yml"`. The snapshot identifies the main content without dumping the whole document into model context.
- **Check home text.** Read the visible main text and compare its version to this checkout. Run `$package = Get-Content package.json -Raw | ConvertFrom-Json; $homeJson = npx --no-install playwright cli "-s=$($run.session)" --raw run-code "async page => await page.locator('main').innerText()"; $homeText = $homeJson | ConvertFrom-Json; $homeText | Set-Content -Encoding utf8 "$($run.evidenceDir)\home-main.txt"; $expectedHome = "Julia $($package.version)`n`nwhat are we cooking today?"; if ($homeText -ne $expectedHome) { throw 'Rendered home text does not match this candidate package version and welcome line' }`. The saved text proves the visible Julia version and welcome line match the candidate.
- **Capture visible result.** Take a screenshot. Run `npx --no-install playwright cli -s="$($run.session)" screenshot --filename "$($run.evidenceDir)\home.png"`. The image shows the same home content captured in `home-main.txt`.
- **Repeat regression.** Run the existing browser assertions against this exact recorded server: set `$env:JULIA_VERIFY_URL = $run.url`; capture `$testOutput = npm exec -- playwright test e2e/home.spec.mjs --reporter=line 2>&1`; capture `$testExit = $LASTEXITCODE`; save with `$testOutput | Set-Content -Encoding utf8 "$($run.evidenceDir)\playwright-test.txt"`; add `"exitCode=$testExit" | Add-Content -Encoding utf8 "$($run.evidenceDir)\playwright-test.txt"`; then `Remove-Item Env:JULIA_VERIFY_URL`. Both home and manifest/assets tests must pass without starting a second server or making a model call. A nonzero exit is a failed proof.
- **Console.** Capture only browser errors. Run `npx --no-install playwright cli -s="$($run.session)" console error | Set-Content -Encoding utf8 "$($run.evidenceDir)\console-errors.txt"`. Inspect the file; it must be empty or contain only errors with a documented explanation.

## Gotchas

- The welcome line is the exact text `what are we cooking today?`; whitespace or punctuation changes are user-visible changes.
- The version comes from `package.json`. Avoid hardcoding the version in assertions when it changes.
- A healthy `/api/health` response alone does not prove that the correct checkout is serving the page; Doctor also checks the run's process, listener, commit, and dirty-tree digest.
- Do not run the Playwright spec without `JULIA_VERIFY_URL` during this proof; its default config would start another server on port 3000.
