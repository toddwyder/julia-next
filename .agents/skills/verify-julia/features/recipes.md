# Julia recipes: add one and find it by title

The Library lists the recipes saved in this browser, newest first. Manual Entry adds one, and each recipe opens at its own address with the typed text unchanged.

## Sub-features

- `recipe-library-list`: `/recipes` shows a `ul` with `aria-label="Recipes"`, one link per recipe whose text is the recipe title, newest first.
- `recipe-search`: the input labelled `Search your collection` matches any part of a title in any case. An empty or whitespace-only search shows every recipe.
- `recipe-add`: `/recipes/new` has the fields `Recipe Title`, `Ingredients` and `Instructions`, the button `Save Recipe` and the link `Cancel`. A save opens the new recipe at `/recipes/<id>`.
- `recipe-cancel`: `Cancel` goes back to `/recipes` and writes nothing.
- `recipe-double-save`: saving the same form twice, by a double click or two submits in one task, still gives one recipe.
- `recipe-detail-verbatim`: `/recipes/<id>` shows the title, the ingredients and the steps exactly as they were typed, including leading and trailing spaces, blank lines and a trailing newline. The three elements carry `data-testid` `recipe-title`, `recipe-ingredients` and `recipe-steps`; the last two use `white-space: pre-wrap`.
- `recipe-reload`: a reload, a bookmark or a shared address of `/recipes/<id>` shows the same recipe, because the address is a real route and the recipe is read from this browser.
- `recipe-device-only`: the Library states `Recipes are saved only in this browser on this device.`

## How to get to it (user POV)

- Every page has the masthead at the top: the Julia logo (link named `Julia`) goes home, the `Library` tab goes to `/recipes`.
- On the Library, `Manual Entry` opens the form. A recipe row opens that recipe.
- Nothing leaves the device: recipes are stored in this browser under the `localStorage` key `julia.recipes.v1`, as `{ "version": 1, "recipes": [...] }` with the newest first. Clearing site data deletes them, and another browser or device shows an empty Library.
- `Back to the Library` returns to the list; the browser's own Back button works too.

## Driving it with Playwright CLI

Preconditions: the steps in [README.md](README.md#before-any-feature) are done and the browser is open at `$RUN_URL`.

- **Start from an empty Library.** Run `pw localstorage-clear`, then `pw goto "$RUN_URL/recipes"` and `pw snapshot --filename "$EVIDENCE/library-before.yml"`. The snapshot shows the Library heading, the search box, the `Manual Entry` link and no recipe rows.
- **Add a recipe.** Run `pw goto "$RUN_URL/recipes/new"` and `pw snapshot --filename "$EVIDENCE/new-form.yml"` to get the refs of `Recipe Title`, `Ingredients`, `Instructions` and `Save Recipe`. Fill them by ref, typing the values you will compare later, for example `pw fill <title-ref> "  Coq au Vin  "`, then `pw click <save-ref>`. Save the typed values to `$EVIDENCE/typed.json` yourself; the page is the thing being checked.
- **Read the recipe back.** The address is now `/recipes/<id>`. Run `pw reload`, then
  `pw --raw eval "JSON.stringify(['recipe-title','recipe-ingredients','recipe-steps'].map(id => [id, document.querySelector('[data-testid=\"' + id + '\"]').textContent]))" > "$EVIDENCE/recipe-detail.json"`.
  Compare that file with `$EVIDENCE/typed.json`: every string must be identical, character for character.
- **Find it by title.** Run `pw goto "$RUN_URL/recipes"`, `pw fill <search-ref> "COQ AU"` and `pw snapshot --filename "$EVIDENCE/library-search.yml"`. One row remains and its text is the whole title. Click the row and read the three elements again.
- **Cancel adds nothing.** Run `pw goto "$RUN_URL/recipes/new"`, fill all three fields, click `Cancel`, then run `pw localstorage-get julia.recipes.v1`. The address is `/recipes` again, there is no new row, and the key is missing or holds the same recipes as before.
- **Save twice quickly.** Run `pw eval "(f => { f.requestSubmit(); f.requestSubmit(); return 'submitted twice' })(document.querySelector('form'))"` on a filled form at `/recipes/new`, then `pw localstorage-get julia.recipes.v1`. The stored `recipes` array grew by exactly one.
- **Empty search order.** Add two recipes with different titles, search for spaces only, and read the row order with
  `pw --raw eval "JSON.stringify([...document.querySelectorAll('ul[aria-label=\"Recipes\"] a')].map(a => a.textContent))"`. The newest title comes first.
- **Screenshot.** Run `pw screenshot --filename "$EVIDENCE/recipe-detail.png"` on the detail page.
- **Console.** Run `pw console error > "$EVIDENCE/console-errors.txt"`. The file must list no errors.
- **Saved spec.** Run `node .agents/skills/verify-julia/verify-julia.mjs test .agents/skills/verify-julia/tests/recipes.spec.mjs`. It must end with `exitCode=0`.
- **Side effects.** The run writes to this browser's `localStorage` on the run's origin only. Record the key and the number of stored recipes, then run `pw localstorage-clear` so the next run starts empty.

## Gotchas

- Text fidelity is the whole feature. `toHaveText` in `@playwright/test` collapses whitespace, so the saved spec compares `textContent` strings instead. A trimmed comparison passes while the page is wrong.
- The recipe id is minted once, when the form mounts. That is what makes a double Save one recipe; re-minting it per submit would store two.
- Both pages read storage inside `useEffect`, because reading it during render would hydrate a different list than the server sent. The first paint says `Loading your collection…` or `Opening the recipe…`; wait for the `data-testid` elements before reading text.
- `localStorage` belongs to a browser profile and an origin. The Playwright CLI browser has its own copy of the recipes, so an empty Library there is not a bug, and a leftover recipe from an earlier run can make a count look right. Always `pw localstorage-clear` first.
- `pw --raw eval` prints the value as JSON, so files it writes hold quoted strings. Parse them before comparing.
- Unreadable or newer stored data throws instead of being overwritten, so a page that says it cannot read the library and still lists nothing has kept the data on purpose. Do not treat that as data loss.
