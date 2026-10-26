# Julia verification map

Julia's user features. Each file says what the feature is, how a user reaches it, how to drive it and what proves it works. Each feature has one saved spec in `../tests/`.

| Feature | File | Spec |
| --- | --- | --- |
| Home page: name, version, welcome line | [home-content.md](home-content.md) | `tests/home.spec.mjs` |
| Recipes: add one and find it by title | [recipes.md](recipes.md) | `tests/recipes.spec.mjs` |
| Vintage look: fonts, colours, masthead | [vintage-look.md](vintage-look.md) | `tests/vintage.spec.mjs` |
| Install manifest and icons | [installation-metadata-assets.md](installation-metadata-assets.md) | `tests/install.spec.mjs` |

`tests/release.spec.mjs` is not a feature. It checks that production serves the merged commit, and skips unless `JULIA_SMOKE_COMMIT` is set.

## Before any feature

1. `node .agents/skills/verify-julia/verify-julia.mjs launch` (or `launch --url <address>` for a deployed build).
2. Load the run into the shell and define the browser shortcut:

   ```bash
   eval "$(node -e 'const r=require("./.artifacts/verify-julia/run.json");console.log(`RUN_URL=${r.url} RUN_SESSION=${r.session} EVIDENCE=${r.evidenceDir}`)')"
   pw() { npx --no-install playwright cli "-s=$RUN_SESSION" "$@"; }
   ```

3. `node .agents/skills/verify-julia/verify-julia.mjs doctor` must exit 0.
4. `pw open --browser chromium "$RUN_URL"`.

Use only `$RUN_URL` and `$RUN_SESSION`. Save every file under `$EVIDENCE`. Finish with `node .agents/skills/verify-julia/verify-julia.mjs cleanup`.

When you add a user-facing feature, add a file here with the same four sections (`Sub-features`, `How to get to it (user POV)`, `Driving it with Playwright CLI`, `Gotchas`), add its spec to `../tests/`, and add a row to the table.
