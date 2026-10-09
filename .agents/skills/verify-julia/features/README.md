# Julia verification map

This map covers Julia's two existing browser surfaces: home content and install metadata/assets. Read the index before driving the app, then use the matching feature file. This does not verify installation on Todd's phone.

## Baseline preconditions

- From the repository root, run `node scripts/verify-julia.mjs launch` and capture its JSON output as `$run`: `$run = node scripts/verify-julia.mjs launch | ConvertFrom-Json`.
- Run `node scripts/verify-julia.mjs doctor`, capture its output and exit code, and require success before driving. Require it to report this candidate commit, matching dirty-tree digest, exact Next process, listener ownership, and healthy response.
- Keep the same PowerShell session so `$run.url`, `$run.session`, and `$run.evidenceDir` stay available. If the shell is reopened, restore them with `$run = Get-Content .artifacts/verify-julia/run.json -Raw | ConvertFrom-Json`.
- Open only the browser session named in `$run.session`; it is unique to this run and uses an in-memory profile.

## Driving conventions

- Run every browser command from the repository root after Doctor passes.
- Use `$run.url` and `-s="$($run.session)"` for every CLI command. Never use an unrecorded port or another session.
- Prefer the `main` landmark and the manifest link from the rendered home page. Use current CLI snapshots for element refs.
- Save screenshots, snapshots, console output, manifest and icon observations, and test output under `$run.evidenceDir`.
- Keep full snapshots and logs in files; inspect only the targeted portions needed to decide the proof.
- The home/manifest journey has no persistent household-data side effect. Record `not applicable` rather than inventing one.

## Proof and skip reporting

- Capture the user-facing action and resulting state, not just the final screen.
- Home proof includes the navigation command, a focused home snapshot, the home screenshot, and the observed `main` text.
- Install-metadata proof includes the home page's same-origin manifest link, the live manifest response, and both icon responses with MIME type and decoded dimensions.
- Record candidate commit, dirty-tree SHA-256, Julia version, Playwright version, run ID, URL, process/listener identity, command exits, and console errors.
- Read the retained artifacts after cleanup. A manifest/assets result does not prove that a phone installed Julia.

## Features

- [Home content](./home-content.md) covers the rendered Julia name/version and welcome line.
- [Installation metadata and assets](./installation-metadata-assets.md) covers the linked web manifest, 192px/512px icons, and favicon.
