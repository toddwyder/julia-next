---
name: verify-recipes-formally
description: "Check the household recipe library's save-once and move-once promises against every ordering of saves, retries, interrupted moves and two tabs at once, using a TLA+ model and the TLC checker. Use when changing lib/recipes.js, app/recipes/new/page.jsx, app/recipes/household-gate.jsx, firestore.rules, or anything about when a recipe id is made, reused or when the browser's copy is removed."
---

# Verify the recipe library formally

Two promises the household library makes, and what breaking each costs:

- **Save-once.** One recipe form ends up as one document, however many times Save is pressed, and however many of those presses the library answered without the answer arriving. Broken, a dropped connection leaves the household with the same recipe twice.
- **Move-once / nothing lost.** A recipe already in this browser reaches the household library once, and the browser's copy is removed only after every upload has answered. Broken, an interrupted move either duplicates recipes or empties the browser and loses them.

The browser tests in `.agents/skills/verify-julia/tests/recipes.spec.mjs` check the orders someone thought to write down. These promises are about orders, so they are checked with a model in `formal/recipes/Recipes.tla` and TLC, which visits every reachable state.

## Run it

```
node scripts/check-recipes-model.mjs
```

Three lines come back, and the run only exits 0 when all three are `ok`:

```
ok   shipped.cfg                    the design in lib/recipes.js keeps both promises: both promises hold in every reachable state
ok   fresh-id-on-every-write.cfg    a new id on every write stores one recipe twice: SaveOnce catches it
ok   clear-before-upload.cfg        emptying the browser before the uploads answer loses recipes: NoLoss catches it
```

The two broken configurations are the point of the second and third lines: each models one regression of the real code, and the run fails if the checker ever stops catching it. The checker (java and `tla2tools.jar` 1.8.0, pinned by sha256) downloads once into `formal/.tools/`, which is git-ignored. Java is already on the server; elsewhere install any JDK 21. A run takes about five seconds.

Read a failing run with the pstack `/statechart` skill. It turns the checker's trace into the shortest path of steps in plain words, so you can see which save or clear put the library in the bad state.

## What is checked, and what is not

Checked over every reachable state, with two forms, two browser recipes, four document ids, one browser and two tabs: every order of opening a form, pressing Save, retrying, uploading a browser recipe, and removing the browser copy.

Assumed, and therefore outside the model:

- Firestore runs one transaction's read and its write as a single atomic, serialized step. `saveRecipe`'s check-then-write depends on that guarantee, and `lib/firestore-rules.test.mjs` tests the rules that back it.
- A stored recipe can never be updated or deleted; `firestore.rules` says so and its tests check it.
- Ids are unique: a new recipe gets a fresh UUID, a moved recipe keeps its own id. The model can pick any id, so it would rather over-report than miss a duplicate.
- The model is written by hand from the code. Nothing generates it, so "true to the code" is maintained by hand too, using the coverage record below.

## Coverage record

Confirmed to describe these files at commit `4a7831e`. Move that commit forward only after you have read the verification against the code at the new commit.

| Model part (`formal/recipes/Recipes.tla`) | Code it stands for |
| --- | --- |
| `WriteIds`, `Submit` | `app/recipes/new/page.jsx`: the id is made once by `useState(() => newRecipeId())` and reused by every submit; `lib/recipes.js` `saveRecipe` |
| `Create` | `lib/recipes.js` `saveRecipe` transaction: read the document, return it if it exists, otherwise create it |
| `Upload`, `WriteIds` under a move | `lib/recipes.js` `moveBrowserRecipes`: `saveRecipe(db, recipe.id, recipe, recipe.createdAt)` keeps each recipe's own id and date |
| `Clear` | `lib/recipes.js` `moveBrowserRecipes`: `storage.removeItem(LIBRARY_KEY)` runs only after the loop of uploads |
| `BrowserRecipes`, `tabs {1, 2}` | one browser's stored recipes, moved by `app/recipes/household-gate.jsx` after sign-in, from one or two tabs |
| `NoLoss`, `Stored` | `readBrowserRecipes` throws rather than returning data it cannot read, so a move never removes what it did not understand |
| `SaveOnce` | `firestore.rules`: `allow create` only, no `update` or `delete`, so the second writer cannot rewrite the first |

`lib/recipes.test.mjs` and `.agents/skills/verify-julia/tests/recipes.spec.mjs` pin the code to this model behaviourally. Two scratch breaks were used to confirm that: regenerating the id on every submit (`saveRecipe(db, newRecipeId(), fields)`) fails the browser test "two Save submissions in one task store one recipe" with 2 documents where 1 is wanted; moving `storage.removeItem(LIBRARY_KEY)` above the upload loop fails the store test "a browser recipe the library refuses keeps every browser recipe on the device". Both were reverted.

## When the check fails

1. Read the trace with `/statechart`, then find the step in the code listed above.
2. If the code is wrong, that is a bug: fix the code, not the model.
3. If the code changed on purpose, change the model in the same commit so it states the new design, and confirm the broken configurations still fail. A rewritten property that no configuration can break is a property that proves nothing.
4. If a configuration reports the wrong invariant, or the checker stops catching a break, the model has drifted from the code. Fix the mapping before trusting a pass.

## What this does not cover

Firestore's internals, the security rules' own behaviour (that is `lib/firestore-rules.test.mjs` on the emulator), sign-in and household membership, the screens, the text stored for a recipe, and the events sent to Sentry and Axiom. It says nothing about the app after a recipe is stored, only about how many copies of it the library ends up with.
