# 0007. The Lab is four pairing-graph variations, then an open conversation to a full draft

Date: 2026-09-16

Status: accepted; the pairing source is not yet named (see below).

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
- The pairing source is chosen after Todd scores twenty sparks side by side from FlavorGraph
  and Epicure. Julia is personal use only, so FlavorGraph's non-commercial chemistry data is
  usable. The Lab is built so the source can be swapped; this ADR is amended with the name.
- A Lab recipe's source is "The Lab: <spark>", so Lab recipes are findable in the library.

Decided in [The Lab: what creating a new recipe should feel like](https://linear.app/julia-next/issue/JUL-26).
