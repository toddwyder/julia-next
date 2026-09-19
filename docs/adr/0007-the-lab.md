# 0007. The Lab is four pairing-graph variations, then an open conversation to a full draft

Date: 2026-09-16

Status: accepted; amended 2026-09-16 to name the pairing sources (see Consequences).

The Lab takes a spark and a time budget and answers with four variations, each a different use
of an ingredient-pairing graph: the spark's closest partners (Classic), a plausible but rarely
used partner (Adventurous), partners sharing aroma molecules (Chemistry), and partners chosen
to fill the tastes the spark lacks (Balanced, using Nik Sharma's seven: brightness, bitterness,
saltiness, sweetness, savouriness, heat, richness). Each variation is a card, not a draft.

From the cards an open conversation with an AI model shapes the recipe. "Write it" produces a
complete draft (ingredients with amounts, steps, yield, times) in the conversation, with a
one-line taste-balance note and a Keep button. Keep is the only way a Lab recipe enters the
library, the same rule as import. Riff sends an existing recipe into the Lab as the spark and
always produces a new recipe.

We chose an open conversation over a single guided choice of direction because a fixed menu
of three was too closed for the way Todd invents. We chose cards over four full drafts because
most drafts are thrown away unread. We chose a full draft over an ingredient set because a
result without steps is not a recipe, and the Lab is already online-only (ADR 0003).

## Consequences

- The Lab needs the pairing data and an AI model, so it needs a connection; nothing else in
  Julia does after sign-in.
- Sharma's framework is encoded as Julia's own rubric (ingredient to taste tags); the book's
  text is never reproduced.
- Two pairing sources, one per variation. FlavorGraph makes Classic, Adventurous and Chemistry;
  Epicure makes Balanced. Chosen after Todd scored twenty sparks side by side
  ([JUL-40](https://linear.app/julia-next/issue/JUL-40)): FlavorGraph won or tied Classic on
  17 of 20 and is the only source with molecule data; Epicure's taste readings were useful on all
  20 and it is the only source that has them. Both are bundled on the device: FlavorGraph under
  Apache 2.0 (its chemistry edges are non-commercial, fine for personal use), Epicure's model
  under CC BY 4.0 with attribution. FlavorGraph's names get a canonical pass before display and
  its generic-molecule artefact is filtered out of Chemistry; Epicure seeds the Balanced taste
  tags for a Western pantry, brightness is hand-tagged, and every tag is correctable by Todd.
  The Lab still reads each source through one seam so either can be swapped.
- A Lab recipe's source is "The Lab: <spark>", so Lab recipes are findable in the library.

Decided in [The Lab: what creating a new recipe should feel like](https://linear.app/julia-next/issue/JUL-26).
