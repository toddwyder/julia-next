# 0006. A recipe is what was written, plus what Julia understood from it

Date: 2026-09-15

A recipe holds a title, a yield (a number and a word), prep and cook time, ingredient lines,
numbered steps, notes, and a source. Nothing else: no photo, tags, rating, or history.

An ingredient line and a step are stored as the text that was written. Alongside each line
Julia keeps the parts it understood (amount, unit, ingredient, preparation), which Todd can
correct. Julia never silently rewrites the written text. Everything else is derived on
display: total time, the other unit system, scaled amounts, badges, nutrition.

Scaling is a view: the stored recipe keeps its yield, scaled amounts last through cook mode
and the shopping list, then are forgotten. Units are stored as the source gave them and
converted on display with Julia's own table.

We chose "text plus understood parts" over free text (nothing downstream would work) and over
parts only (imports and parsing get things wrong, and the written line is the truth). We
chose a view for scaling over rewriting or copying because the recipe is the recipe and the
maths is for tonight.

## Consequences

- Recognising the ingredient part matters twice: for shopping and nutrition, and for the
  drawing beside each line.
- Cook mode and the prep list are built from steps, so imports must split into steps.
- Yield's word ("crackers", "loaf") is the unit nutrition is reported per.

Decided in [What a recipe is: its fields, what's derived, and how it scales](https://linear.app/julia-next/issue/JUL-12).
