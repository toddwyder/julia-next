# Vintage look: Library, Enter a Recipe and Recipe screens

The recipe screens use the type, colours and layout recorded in `docs/design/vintage/DESIGN-LANGUAGE.md`. The masthead and nav appear on every page.

## Sub-features

- **vintage-fonts**: Playfair Display, Inter and Roboto Mono are loaded (`document.fonts`), not just named in CSS.
- **vintage-colours**: cream paper, ink text, forest-green titles, dark-green buttons and active tab, pale-green tab fill, terracotta empty state. Each matches its row in DESIGN-LANGUAGE.md.
- **vintage-type-roles**: titles and recipe text are serif, inputs and buttons are sans, textareas and the back button are mono.
- **vintage-masthead**: Julia logo, "❧ THE JULIA COOKBOOK ☙", "established 1961", and a nav where Library is a pill on `/recipes`.

## How to get to it (user POV)

Open any page. The masthead is at the top. Go to Library, then Manual Entry, then save a recipe to see its page.

## Driving it with Playwright CLI

1. Run "Before any feature" in [README.md](README.md).
2. Visit `$RUN_URL/recipes`, `$RUN_URL/recipes/new`, and a saved recipe. Take a `pw screenshot` of each into `$EVIDENCE`.
3. Run the drift check: `JULIA_VERIFY_URL="$RUN_URL" npx playwright test .agents/skills/verify-julia/tests/vintage.spec.mjs`.
4. For side-by-sides against the references: `node .agents/skills/verify-julia/scripts/side-by-side.mjs "$RUN_URL" "$EVIDENCE/side-by-side"`. This writes `<screen>-julia-next.png` and `<screen>-side-by-side.png` for 01-library, 11-manual-entry and 07-recipe-detail. Open each one and look at it.

## Gotchas

- `side-by-side.mjs` clears localStorage and seeds six recipes. Run it only on an isolated launch.
- The spec reads each expected hex and font name from DESIGN-LANGUAGE.md by row label. If you rename a row there, update `designRow` labels in the spec.
- After `npm run build`, restart any `next start` already on the port. A stale server serves the old chunks and every client page shows "This page couldn't load". Side-by-sides from it look the same for different screens.
- Differences that are expected in this slice: no Sign in with Google strip, only the Library tab, no Import box, no SCORE/GL badges or time/servings metadata, no ingredient pictures or bold quantities, no Servings/Prep/Cook fields, no Start Cooking/Share/Edit buttons.
