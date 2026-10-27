# 0025. The recipe library lives in Firestore, and the rules are the only door

Date: 2026-10-27

Status: Accepted (JUL-208). Replaces the "We don't use the Firestore emulator" paragraph of [0010](0010-firestore-for-data.md); the rest of 0010 stands.

## Context

The household has two Google accounts, [toddwyder@gmail.com](mailto:toddwyder@gmail.com) and [katinawyder@gmail.com](mailto:katinawyder@gmail.com). Recipes lived in one browser's `localStorage`, so the other device and the other account saw nothing. The card asks for one library both accounts open from any device, every other identity turned away including requests sent straight at storage, one recipe per save however many times Save is pressed, and browser recipes joining the library exactly once.

The card also asks for stock Firebase first, with custom code only where none exists. That rules out the obvious alternative: Firebase has no built-in "these two emails only" switch.

## Decision

**Storage and the door.** Recipes are documents in the `recipes` collection of the Julia Firebase project. `firestore.rules` allows a document only when the caller is signed in with a Google account whose email is in the `household/members` list and whose email Google has verified. The rules read that list with a `get()` on a document no household member can write, so adding or removing a household account is done in the Firebase console, not by the app. Nothing in the app decides who is in the household; the app asks, the rules answer. A signed-in stranger's read is denied, which the UI shows as "not part of this household" and then signs them out.

**One recipe per save.** The id is made when the form opens (`newRecipeId()`, a UUID) and reused by every press of Save on that form. `saveRecipe` runs a transaction that returns the stored document if one already exists and otherwise writes it, and the rules allow `create` but not `update` or `delete`. A retry after a lost answer, a double tap or a second device saving the same id therefore leaves exactly one document, and a stored recipe cannot be changed or removed afterwards by anyone holding the app's credentials.

**Move once, lose nothing.** `moveBrowserRecipes` reads the old `julia.recipes.v1` browser list, saves each recipe under its own id and its original `createdAt`, and calls `removeItem` only after every save has succeeded. An interrupted or repeated move finds the documents already there and leaves them alone. Unreadable browser data is left in place and reported rather than deleted.

**Rules are tested on the emulator.** `@firebase/rules-unit-testing` works only against the Firestore emulator, and rules cannot be exercised at all against a real project because a real project always enforces them. So `lib/firestore-rules.test.mjs` and the recipe store tests start the Auth and Firestore emulators on `127.0.0.1:9099` and `127.0.0.1:8080`, and the browser specs in `verify-julia` sign in to the emulators' fake Google page as fake household accounts. That reverses 0010's "we don't use the Firestore emulator", whose reason was Java overloading the runner; one emulator pair now starts in about 20 seconds and takes Java 21, which `scripts/firebase-emulators.mjs` picks for itself. Testing the app's own paths against a second real Firebase project stays the plan for anything the emulator cannot mimic, and real accounts on real devices stay Todd's UAT.

**What records the household's use.** Sign-in, save and move send one event each to Axiom, and a failed save is also captured in Sentry, through `/api/recipe-events`. The event carries an action, an outcome and Firebase's error code; it never carries recipe text or an email address, and neither Sentry nor Axiom receives either.

## Consequences

- The Firebase project, its Google sign-in, the `household/members` list and the service account are Todd's to create; until they exist the app cannot reach a real library.
- Only two local verifications can run at once on this server, because the emulator ports are fixed. A run that finds both emulators already answering reuses them and leaves them running.
- Vercel needs the Firebase web config in its environment; the browser holds no key that grants anything on its own, because the rules and not the key decide access.
- Adding a third person to the household is a console edit of one document, not a deploy.
