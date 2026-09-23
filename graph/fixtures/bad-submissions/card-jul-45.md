## Acceptance criteria

- [ ] A temporary rehearsal address opens, carrying the reviewed candidate.
- [ ] The change is visible there and is not on Real Julia.
- [ ] The controller, not the builder, does the deploying. The builder never holds GitHub write access or deploy credentials.
- [ ] A script walks the main path through the app on that address and reports each step's result. It is not a page-load check, and a test proves a site that merely answers does not pass.
- [ ] A failed walk moves the card back as unfinished work, naming the step that failed.
- [ ] A card whose work has nothing a person could look at skips this column, and the card records why.
- [ ] Proven on real work, not on a change made for the purpose.

## UAT plan

1. A card with a visible change reaches Staging and smoke test.
   *I should see:* a temporary address I can open, showing the change, and Real Julia unchanged.
2. I read the card.
   *I should see:* each step of the walk through the app, and whether it worked. Not "the site is up".
3. A walk fails.
   *I should see:* the card go back to a builder, naming the step that failed, and nothing published.
4. A documents-only card goes through.
   *I should see:* it skip this column, with one line saying why.
