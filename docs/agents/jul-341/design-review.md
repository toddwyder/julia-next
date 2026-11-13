# JUL-341 design judge

Both reports recommend the same whole shape: one display model behind a server-selected demo or household provider. The choice is therefore about contract details, not route shape.

## Scores (1–5)

| Rubric | A | B | Basis |
| --- | --- | --- | --- |
| 1. Preserve household data and auth | 4.5 | 4.5 | Both freeze `lib/recipes.js`, save, migration, and the shared shell. A always adapts household storage to `written` and forbids parsing prose into invented metadata. B defaults to household and forbids fixture fallback on auth/read errors. |
| 2. Isolate preview demo | 4.5 | 5 | Both gate demo on the server and reject URL, localStorage, and `NEXT_PUBLIC` authority. B adds an approved isolated-preview deployment identity, rejects invalid enabled-demo config, and states the no-fallback rule for empty, auth, and read-error cases. |
| 3. One amount source for list and step labels | 5 | 3.5 | A derives every step amount from one ingredient base amount and a share; shares must total one; one `projectAmounts` call feeds list and labels; recomputation starts from base, never rounded output. B's `Portion` carries its own authored amount beside the ingredient total and only enforces agreement by validation, so there are two sources. |
| 4. Minimize presentation API | 4.5 | 3.5 | A's `AmountProjection` is exactly what the views render, and ingredient rows know nothing about demo, Firebase, or environment flags. B adds per-ingredient `iconPath`, which the card replaces with one engraved basket for every ingredient, and its `scaleRecipe` returns a whole rescaled `DisplayRecipe`, mixing catalog and view. |
| 5. Browser-verifiable behavior | 4 | 5 | B's verification handoff enumerates browser checks: 600+ entries, search by title/ingredient/source/encoded apostrophe, inactive letters, five recents across reload, restored step, 1/4/75 servings, split portions, no-ingredient step, denied storage, no Firebase or network calls, no URL activation, no fixtures in the household path, and identity change. A names the key checks but fewer. Both flag the newest-first and vintage spec conflicts. |

**Total: A 22.5, B 21.5.**

## Base

**Design A.** It wins on the card's core contracts: one amount source, a narrow presentation model, and the card's single-basket rule (which overrides the briefs' per-ingredient pictures). It also names the root-shell, manifest, and sign-in preservation constraints explicitly. Its weak point is the thinner browser-verification checklist.

Correction A already flags: bind `useRecipeHistory` to the active recipe id, not only the scope.

## Strongest graft

Take B's **verification handoff** into A. It is the strongest part of B and closes A's rubric-5 gap: reload-based recents, 1/4/75 servings, split portions, no-ingredient step, storage denial, no-network assertions, and identity-change history isolation.

Also graft B's isolation posture into A's gate section: default to household, reject invalid enabled-demo configuration, and no fixture fallback on empty, auth, or read error. Carry B's framing that mounting `HouseholdGate` can itself perform migration writes, which is why demo cannot mount it.

Do **not** graft B's `Portion.amount` model or `iconPath`; the first weakens rubric 3, the second contradicts the card's basket override. Keep A's separate opened/step storage keys over B's single per-recipe record, which risks lost updates across tabs.

Both reports stop before implementation and Shipping; neither ran a browser suite. No code, agents, GitHub, or Linear writes were used here.
