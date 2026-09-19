# Which nutrition and glycemic-index tables can Julia carry on the device?

Research for [JUL-41](https://linear.app/julia-next/issue/JUL-41). Decided by
[JUL-28](https://linear.app/julia-next/issue/JUL-28). Written 2026-09-15.

## The short answer

Bundle four small tables, all built once and shipped inside the app:

| Table | What it is | Rows | Size on device | Terms |
| --- | --- | --- | --- | --- |
| A. Nutrition | USDA SR Legacy rows trimmed to household ingredients: calories, fat, saturated fat, carbs, sugars, protein, fibre, sodium, plus cup/tablespoon/teaspoon/piece weights | ~2,000 (1,500 to 2,500) | ~400 KB as JSON, ~80 KB compressed | Public domain (CC0) |
| B. Glycemic index | One GI number per carbohydrate-bearing row in Table A, taken from the 2021 international tables, plus a default per food group | ~200 | under 20 KB | Published measurements, cited per row |
| C. Names | Julia's own list of the words cooks write ("AP flour", "EVOO", "cheddar") pointing at a Table A row, plus a household default for bare generic words ("flour", "oil", "cheese") | ~1,500 aliases | ~50 KB | Julia's own |
| D. Fallback weights | The handful of generic weights used when a row has no portion of its own (1 cup of liquid = 240 g, 1 tbsp = 15 g, 1 tsp = 5 g) | ~20 | negligible | Julia's own |

Total well under half a megabyte raw and about 150 KB over the wire, the size of one
photograph. It fits in the offline cache without a second thought.

The "~" mark should appear on a recipe's Score and glycemic load when at least one ingredient
line that could move the number was worked out by a fallback rather than a match: no row was
found, only a bare generic word matched, the amount had no usable weight, or a carb-bearing
row had no GI of its own. Exact definition in [the "~" rule](#when-the--mark-appears).

## 1. Nutrition: USDA FoodData Central

### Terms

USDA states on the API guide: "USDA FoodData Central data are in the public domain and they
are not copyrighted. They are published under CC0 1.0 Universal (CC0 1.0). No permission is
needed for their use, but we request that users list FoodData Central as the source of the
data." Suggested citation: "U.S. Department of Agriculture, Agricultural Research Service.
FoodData Central, 2019. fdc.nal.usda.gov."
([FDC API guide](https://fdc.nal.usda.gov/api-guide)). The dataset's entry on data.gov carries
the US public-domain label
([catalog.data.gov](https://catalog.data.gov/dataset/fooddata-central)). Julia can bundle it,
trim it, and reshape it freely; an "Nutrition data: USDA FoodData Central" line somewhere in
the app is the polite thing to do.

### The two candidate datasets

FoodData Central has several data types. Two matter here
([data types](https://fdc.nal.usda.gov/data-documentation),
[downloads](https://fdc.nal.usda.gov/download-datasets)):

**SR Legacy** (Standard Reference). 7,793 foods. "The final release of the Standard Reference
data type. These data will not be updated" (April 2018). CSV download is 6.7 MB zipped.
I downloaded the CSV and counted:

- Calories, total fat, carbohydrate and protein: present on all 7,793 foods.
- Saturated fat on 7,450; fibre on 7,231; sodium on 7,709; total sugars on 6,007.
- **Added sugars: on none.** SR Legacy has no "Sugars, added" values (the nutrient exists
  in the dictionary, but zero rows carry it). See [added sugar](#the-added-sugar-gap).
- Portion weights: 7,533 foods have at least one, 14,449 portion rows in all. Each row is a
  household measure and its gram weight, for example "Wheat flour, white, all-purpose,
  enriched, bleached: 1 cup = 125 g" and "Oil, olive, salad or cooking: 1 tablespoon = 13.5 g,
  1 cup = 216 g, 1 tsp = 4.5 g". The commonest measures are oz (3,166 rows), cup (1,691),
  tbsp (548 + 91 spelled out), fl oz (492), lb (281), tsp (171), slice (186), piece (147),
  and "medium"/"large" for produce and eggs.
- Descriptions are comma-separated, most general word first: "Cheese, cheddar", "Oil, olive,
  salad or cooking", "Wheat flour, white, all-purpose, enriched, bleached". 917 distinct first
  words across the 7,793 rows.

**Foundation Foods**. About 395 foods (the April 2026 download has 395; the API reports 394
today). Newer, lab-analysed, updated twice a year. But it is thin for our purpose. Counting
the same download:

- Only 95 of 395 carry a plain "Energy (kcal)" value (322 carry an Atwater-computed one).
- Saturated fat on 124, total sugars on 149, fibre on 198, sodium on 349.
- Portion weights on only 83 foods. Three all-purpose flour rows have none at all.
- "Oil, olive, extra virgin" has saturated fat and total fat but no calories, no sodium.

So Foundation Foods alone cannot fill the nutrition panel. SR Legacy is the workhorse; it is
frozen, but wheat flour and olive oil have not changed since 2018. Foundation Foods can top up
individual rows later if a value is missing, without changing the design.

The other data types (FNDDS survey foods, Branded foods) are dishes-as-eaten and supermarket
labels: hundreds of thousands of rows, wrong shape for ingredients. Not needed.

### Size of a trimmed table

Measured on the real SR Legacy CSV, keeping per row: id, name, food group, the eight nutrients
per 100 g, and its portion weights, as minified JSON:

| Rows | JSON | gzipped |
| --- | --- | --- |
| All 7,793 | 1.59 MB | 307 KB |
| 1,000 | 209 KB | 40 KB |
| 2,000 | 411 KB | 79 KB |
| 3,000 | 619 KB | 118 KB |

About 200 bytes per row raw, 40 bytes compressed. Even the whole of SR Legacy would be
affordable; a trimmed table is a convenience for matching, not a necessity for size.

**Which rows to keep.** Drop the food groups that are not ingredients: Baby Foods (345), Fast
Foods (312), Restaurant Foods (109), Meals/Entrees (81), Snacks (176), Breakfast Cereals (195),
American Indian/Alaska Native foods (165), and Quality Control Materials. Collapse the 960
"Beef, ..." cut-by-cut rows and 464 lamb/veal/game rows to a few dozen cuts a home cook buys.
What is left is roughly 1,500 to 2,500 rows across Dairy and Egg, Spices and Herbs, Fats and
Oils, Poultry, Pork, Fish, Fruits, Vegetables, Legumes, Nuts and Seeds, Cereal Grains and
Pasta, Baked Products, Sweets, Beverages, and Soups/Sauces. The trimming is a one-off script
kept in the repo, so the table can be rebuilt.

### The added-sugar gap

The Score lowers for added sugar (glossary: "saturated fat, added sugar, and sodium lower
it"), but SR Legacy only knows total sugars. A banana's sugar and a spoon of honey's sugar
look the same. The old app solved this by hand: only sweeteners carried an `addedSugarG`
value. Julia should do the same, explicitly: Table A gets a one-bit flag, "this row's sugar
counts as added", set on sugars, syrups, honey, jams, chocolate, sweetened condensed milk,
soft drinks, and the Sweets and Baked Products groups. Everything else (fruit, milk,
vegetables) counts as intrinsic sugar and does not lower the Score. This is a judgement, and it
should be written down as one.

## 2. Glycemic index: there is no public-domain source

USDA carries no GI values. The options:

**University of Sydney GI database** ([glycemicindex.com](https://glycemicindex.com/about-gi/)).
The reference database, searchable one food at a time, each result with GI, serving size,
carbs per serve, GL and the study behind it
([GI Search](https://glycemicindex.com/gi-search/)). The site does not publish a food count;
second-hand sources say over 4,000 entries. The record on Research Data Australia says "© 2011
The University of Sydney. All rights reserved"
([researchdata.edu.au](https://researchdata.edu.au/international-glycemic-index-gi-database/11115)).
The site's copyright page allows copying GI News material with attribution but says permission
is needed to include content "in advertising or a product for sale" or to modify it
([copyright and permission](https://glycemicindex.com/copyright-and-permission/)). No bulk
download, no API. **Not bundleable as a table.** Usable as the place to look up a single value
when curating.

**The 2021 international tables** (Atkinson, Brand-Miller, Foster-Powell, Buyken, Goletzke,
*Am J Clin Nutr* 2021;114(5):1625-1632, [doi:10.1093/ajcn/nqab233](https://doi.org/10.1093/ajcn/nqab233),
[PMID 34258626](https://pubmed.ncbi.nlm.nih.gov/34258626/)). Over 4,000 items, a 61% increase
on 2008: about 2,100 measured by the ISO method (Supplemental Table 1, "the most reliable
glycemic index values, with a full description of the food as well as cooking method,
processing and composition") and about 1,900 by less rigorous methods (Supplemental Table 2).
The American Society for Nutrition says "the tables are freely available to all readers
regardless of subscription status"
([ASN announcement](https://nutrition.org/ajcn-publishes-international-tables-of-glycemic-index-and-glycemic-load-values-2021-a-systematic-review/));
Europe PMC lists the article itself as not open access, copyright the journal. The right way
to use it: take a couple of hundred measured numbers, cite the paper per row. That is citing
published measurements, not republishing the tables.

**The 2008 tables** (Atkinson, Foster-Powell, Brand-Miller, *Diabetes Care* 2008;31:2281-2283,
[doi:10.2337/dc08-1239](https://doi.org/10.2337/dc08-1239)). 2,480 items; Europe PMC records
the licence as CC BY-NC-ND. The one open GitHub dataset,
[glycemic-index/glycemic-index.github.com](https://github.com/glycemic-index/glycemic-index.github.com)
(MIT-labelled, 891 rows in `data.csv`, with GI, GL, serving, reference food and available
carbs), is a transcription of this paper's Table A1. Handy as a cross-check; superseded by 2021.
The [figuringOutDiabetes GI database](https://fodhub2026.github.io/fod-gi-database/) (666
foods, web only, no download) is another secondary compilation.

### How many GI values a household table needs

Far fewer than 4,000. GI only matters where there are carbohydrates to load. Meat, fish, eggs,
oils, butter, and hard cheese have no available carbohydrate, so their GI contributes nothing
whatever number is stored; non-starchy vegetables and herbs contribute almost nothing. What
needs a real value: flours, breads, pasta, rice and other grains; potatoes and starchy
vegetables; legumes; fruit and juices; milk and yogurt; sweeteners; sweets and baked goods.
That is roughly 150 to 250 rows, each pointing at a Table A row, plus one default per food
group for carb-bearing rows without their own value (for example "other fruit: 40", "other
legumes: 30", "white bread and crackers: 75"). When the group default is used, the line is
marked "~" (see below).

### The maths, as the sources define it

Glycemic load: "GL = (GI x the amount of carbohydrate) divided by 100", with GI bands low
≤ 55, medium 56–69, high ≥ 70 ([Sydney FAQ](https://glycemicindex.com/faqs/)). GL bands: low
10 or less, medium 11–19, high 20 or more
([Illinois Extension](https://extension.illinois.edu/diabetes/glycemic-load-and-glycemic-index)),
which is what the glossary already says. "Amount of carbohydrate" means available carbohydrate:
in SR Legacy terms, carbohydrate by difference minus fibre.

## 3. Turning an ingredient name into a row

### What others have found

The one peer-reviewed treatment of exactly this problem
([Nutritional Profile Estimation in Cooking Recipes, 2020](https://arxiv.org/abs/2004.12286))
matched recipe ingredients to USDA SR rows by word overlap with three tricks: treat the first
comma-term of the USDA description as the important one, add "raw" when the recipe gives no
state, and score by overlap over the recipe's words rather than the union, so that "skimmed
milk" does not match "Milk shakes, thick chocolate". It matched 94.5% of unique ingredient
names; on 5,000 hand-checked frequent cases 71.6% were judged correct; the resulting
per-serving calorie error averaged 36 kcal, "roughly one teaspoon of butter".

The most developed open library, [ingredient-parser](https://github.com/strangetom/ingredient-parser)
(MIT), ships a subset of FoodData Central and matches offline using a keyword ranker (BM25)
fused with word-embedding similarity, and explicitly keeps "a list of overrides that map simple
ingredient names to the relevant FDC entry" because "the foundation food matching process can
sometimes struggle with simple ingredient names" (its
[design note](https://github.com/strangetom/ingredient-parser/blob/master/docs/source/explanation/foundation.rst)).
It is Python and "roughly 20x slower" with matching on; not something to run in a phone
browser, but its conclusion is the useful part: clever matching still needs a hand list for
the common words.

Julia already has a 1,790-name canonical ingredient vocabulary in the Epicure pairing model
that the Lab uses; its names ("fresh ginger" mapping to one canonical name) are a ready seed
for Table C's alias list.

### The failure cases, measured

Counting SR Legacy rows whose first word is the bare generic term:

| Cook writes | SR Legacy rows starting with that word | Does the choice matter? |
| --- | --- | --- |
| "flour" | 22 "Wheat flour, ..." rows (103 mention flour) | Little: all-purpose, bread and cake flour are all ~360 kcal, 73–77 g carbs, 10–13 g protein |
| "oil" | 75 "Oil, ..." rows | For saturated fat, a lot: olive ~14 g/100 g, coconut over 80 g. Calories identical (884) |
| "cheese" | 81 "Cheese, ..." rows | A lot: cheddar vs cottage vs parmesan differ several-fold in fat, saturated fat and sodium |
| "milk" | 48 | Some: whole vs skim halves the fat |
| "beef" | 960 | Some for fat; the cut matters |
| "sugar" | 4 "Sugars, ..." rows | No |

So a bare generic word can always be resolved to *a* row, and the Score will be roughly right
for flour and sugar, but wrong-by-design for oil, cheese, and dairy unless the household
default is the right one. Hence the rule: Table C carries one household default per generic
word (for this household plausibly flour → all-purpose, oil → olive, cheese → cheddar, milk →
whole, butter → salted, sugar → granulated, rice → white long-grain), and a match by bare
generic word is marked "~" until Todd taps the panel and fixes it, which the glossary already
promises ("tapping it lets you fix a wrongly matched ingredient").

### Amounts to grams

Order of preference for one ingredient line:

1. Weight units (g, kg, oz, lb): exact conversion. Not an estimate.
2. Volume or piece units where the matched row has that portion (cup, tbsp, tsp, fl oz,
   slice, medium, large): the row's own gram weight from SR Legacy `food_portion`. Not an
   estimate.
3. Volume units where the row has no such portion: Table D generic weights (1 cup = 240 g for
   liquids and 1 tbsp = 15 g, 1 tsp = 5 g; 1 cup = 150 g for dry goods, the old app's number).
   Marked "~".
4. Counts with no piece weight on the row ("2 onions" when the row has no "medium"): a
   per-row or per-group fallback. Marked "~".
5. No amount at all ("salt to taste", "a handful"): 0 g if the ingredient is in the
   negligible set, otherwise the old app's 100 g fallback and marked "~".

## 4. The old app's hand table, and its maths

Fetched from the frozen repo: `lib/nutrition/ingredientLookup.ts` (130 lines) and
`lib/nutrition/scoringEngine.ts` (151 lines) in
[toddwyder/Julia](https://github.com/toddwyder/Julia/tree/main/lib/nutrition).

**Coverage.** 39 ingredients, per 100 g, seven values each: protein, fibre, saturated fat,
added sugar, sodium, available carbs, glycemic index. Grains and flours (9), proteins (6),
dairy and oils (4), produce (8), sweeteners and condiments (4). No calories, total fat or
total sugars are stored.

**Matching.** Lower-case, strip a few preparation words (chopped, diced, sliced, minced,
fresh, raw, cooked, organic, peeled, drained), then take the first table key that is a
substring of the name or of which the name is a substring. So "olive oil" matches; so does
"rice" (to whichever of "white rice"/"brown rice" comes first in the file). A miss returns a
made-up average food (protein 2, fibre 1, sat fat 0.5, sodium 50, carbs 10, GI 30) and sets
`isEstimated`.

**Weight.** g/kg/oz/lb exact; tbsp = 15 g, tsp = 5 g, and **1 cup = 150 g for everything**
(real: flour 125 g, sugar 200 g, oil 216 g, water 237 g). Counts: egg 50 g, onion 110 g,
chicken breast 200 g, avocado 150 g. Anything else: quantity × 100 g, and `isEstimated`.
The 150 g cup was never flagged as an estimate, though it was the biggest single error.

**Calories** were approximated as protein × 4 + (carbs + fibre) × 4 + saturated fat × 9.
Because only saturated fat was stored, olive oil came out at 124 kcal per 100 g instead of
884 and butter at about 460 instead of 717. Table A fixes this by carrying USDA's own calorie
value.

**Score** (`calculateNutritionFromMacros`), per serving:

```
score = clamp(0, 100, round(
          %DV(protein) + %DV(fibre)
        - %DV(saturated fat) - %DV(added sugar) - %DV(sodium) ))
```

with Daily Values protein 50 g, fibre 28 g, saturated fat 20 g, added sugar 50 g, sodium
2,300 mg, which are the FDA's current label Daily Values
([FDA Daily Value reference](https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels)).
Percentages are not capped at 100. Servings default to 1 when missing.

The code calls this NRF9.3, but it is not: Drewnowski's NRF9.3 sums nine nutrients to
encourage (protein, fibre, vitamins A, C, E, calcium, iron, magnesium, potassium) minus three
to limit ([Drewnowski 2010](https://doi.org/10.3945/ajcn.2010.28450d)). The old app's is a
2-minus-3 score. That is fine, and it is what the glossary describes ("protein and fibre raise
it; saturated fat, added sugar, and sodium lower it"), but the new code should call it Score,
as the glossary already insists, and not NRF.

**Glycemic load**: per ingredient, available carbs (g) × GI ÷ 100, summed over the recipe,
divided by servings, rounded to one decimal; low ≤ 10, medium ≤ 19, high ≥ 20. Same as the
sources above and the glossary.

**To reproduce the score consistently** from the new bundle: same five Daily Values, same
per-serving basis (recipe total ÷ yield number), same uncapped percentages, round then clamp.
Two things will legitimately shift old numbers: calories become real, and added sugar comes
from the Table A flag rather than four hand entries. Neither changes the Score formula.

## When the "~" mark appears

The glossary says the nutrition panel is "always an estimate" and that "~" in front of the
Score "means an estimate". The precise rule proposed: **"~" means at least one ingredient line
that could move the number was worked out by a fallback rather than a match.** A line is a
fallback line when any of these is true:

1. **No row.** The ingredient part matched nothing in Table C, so a food-group or generic
   profile was used.
2. **Bare generic word.** The ingredient part matched only a generic word with a household
   default (flour, oil, cheese, milk, butter, cream, sugar, rice, beef, chicken, fish, and the
   like listed in Table C), and Todd has not yet confirmed or fixed the match.
3. **No usable weight.** The amount was a volume the row has no portion weight for (Table D
   generic weight used), a count with no piece weight, or no amount at all on a
   non-negligible ingredient.
4. **No GI.** For the glycemic load only: the row has 5 g or more of available carbohydrate
   per 100 g and no GI of its own, so a food-group default was used.

And a line does *not* mark the panel when:

- it matched a specific row and its amount was a weight or a portion the row carries;
- it is in the negligible set (salt, pepper, herbs, spices, water, vinegar, leavening,
  extracts): these can be unmatched or unweighed without marking anything, because they
  cannot move the number;
- Todd fixed the match by tapping the panel: a fixed line is a matched line.

One rule for the whole panel: the "~" is on the Score and the glycemic load (the two numbers
that get badges); the plain nutrient lines (calories, fat, ...) inherit the same mark. Missing
yield defaults to 1 serving and marks the panel, since dividing by the wrong number moves
everything.

## Recommendation

1. **Table A** from SR Legacy, about 2,000 rows, eight nutrients plus portion weights and an
   added-sugar flag, built by a script kept in the repo. CC0; credit USDA in the app.
2. **Table B**, about 200 GI values keyed to Table A rows plus food-group defaults, each value
   cited to the 2021 international tables (Supplemental Table 1 where possible, checked
   against the Sydney search). Not a copy of anyone's database. If Julia is ever sold, ask
   Sydney for permission first; today it is a household tool.
3. **Table C**, Julia's alias list seeded from the Epicure vocabulary and the old 39-entry
   table, with one household default per bare generic word.
4. **Table D**, a dozen generic weights for the cases Table A does not cover.
5. Keep the old Score formula and Daily Values exactly; call it Score; use real calories.
6. Apply the "~" rule above, with the negligible set so that "salt to taste" never marks a
   recipe.

Not recommended: Foundation Foods as the base (too many holes), FNDDS or Branded (wrong
shape, huge), copying the Sydney database (not permitted), or the 2008 GitHub CSV as the GI
source (superseded, non-commercial no-derivatives origin).

## Sources

- USDA FoodData Central, [API guide](https://fdc.nal.usda.gov/api-guide) (public domain,
  CC0 statement and citation); [data types](https://fdc.nal.usda.gov/data-documentation);
  [download datasets](https://fdc.nal.usda.gov/download-datasets) (SR Legacy CSV April 2018,
  Foundation Foods CSV 30 April 2026, both downloaded and counted for this note);
  [FAQ](https://fdc.nal.usda.gov/faq) ("SR Legacy ... is the final release of this data type
  and will not be updated"); [data.gov record](https://catalog.data.gov/dataset/fooddata-central).
- University of Sydney GI database: [About GI](https://glycemicindex.com/about-gi/),
  [GI Search](https://glycemicindex.com/gi-search/), [FAQs](https://glycemicindex.com/faqs/),
  [Copyright and permission](https://glycemicindex.com/copyright-and-permission/),
  [Research Data Australia record](https://researchdata.edu.au/international-glycemic-index-gi-database/11115).
- Atkinson FS, Brand-Miller JC, Foster-Powell K, Buyken AE, Goletzke J. International tables
  of glycemic index and glycemic load values 2021: a systematic review. Am J Clin Nutr
  2021;114(5):1625-1632. [doi:10.1093/ajcn/nqab233](https://doi.org/10.1093/ajcn/nqab233);
  [ASN announcement](https://nutrition.org/ajcn-publishes-international-tables-of-glycemic-index-and-glycemic-load-values-2021-a-systematic-review/).
- Atkinson FS, Foster-Powell K, Brand-Miller JC. International tables of glycemic index and
  glycemic load values: 2008. Diabetes Care 2008;31:2281-2283.
  [doi:10.2337/dc08-1239](https://doi.org/10.2337/dc08-1239).
- [glycemic-index/glycemic-index.github.com](https://github.com/glycemic-index/glycemic-index.github.com)
  (891-row CSV transcribed from the 2008 Table A1);
  [figuringOutDiabetes GI database](https://fodhub2026.github.io/fod-gi-database/).
- GL bands: [University of Illinois Extension](https://extension.illinois.edu/diabetes/glycemic-load-and-glycemic-index).
- Ingredient matching: [Nutritional Profile Estimation in Cooking Recipes (arXiv 2004.12286)](https://arxiv.org/abs/2004.12286);
  [strangetom/ingredient-parser](https://github.com/strangetom/ingredient-parser) and its
  [foundation foods design note](https://github.com/strangetom/ingredient-parser/blob/master/docs/source/explanation/foundation.rst);
  [EduardoAC/food-ingredients-database](https://github.com/EduardoAC/food-ingredients-database)
  (Apache 2.0, FDC sync with per-100 g values, no matching layer).
- Score: Drewnowski A. The Nutrient Rich Foods Index helps to identify healthy, affordable
  foods. Am J Clin Nutr 2010;91:1095S-1101S.
  [doi:10.3945/ajcn.2010.28450d](https://doi.org/10.3945/ajcn.2010.28450d);
  [FDA Daily Values](https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels).
- Old app: [toddwyder/Julia lib/nutrition](https://github.com/toddwyder/Julia/tree/main/lib/nutrition)
  (`ingredientLookup.ts`, `scoringEngine.ts`).
