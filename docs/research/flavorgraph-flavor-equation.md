# FlavorGraph and The Flavor Equation: what they are and how the Lab could use them

Research note for Linear JUL-25. Written 2026-09-15. Plain-language; sources at the end of each
section. Nothing here is built or decided; it is input to the Lab design.

## TL;DR

- **FlavorGraph** is a 2021 academic dataset + model from Korea University and Sony AI. It is a
  graph of ~6,650 ingredients and ~1,560 flavour molecules, built from a million recipes and a
  chemistry database, plus a 300-number "fingerprint" (embedding) per ingredient. It answers
  *"what goes with what"* (pairing) and *"what is similar to what"* (substitution). Data and
  model are free to download (Apache 2.0), small (about 5 MB of edges, 10 MB of embeddings),
  and easily usable offline in a small app.
- **The Flavor Equation** is Nik Sharma's 2020 cookbook. The "equation" is a conceptual framework,
  not maths: *Flavor = Emotion + Sight + Sound + Mouthfeel + Aroma + Taste*, with taste split into
  seven "flavor boosters": Brightness (sour), Bitterness, Saltiness, Sweetness, Savoriness (umami),
  Fieriness (heat) and Richness (fat). There is no data to download; the app would encode the
  lens itself as a small checklist / scoring rubric.
- **They fit together cleanly**: FlavorGraph (or Epicure) proposes *which* ingredients to add to a
  spark; the Flavor Equation checks whether the resulting dish is *balanced* and tells the user
  what is missing. Recommended first step is Option A below: ship FlavorGraph's ingredient
  neighbours offline + a hand-written flavour-booster rubric, and keep an AI model out of the
  critical path.

---

## 1. What FlavorGraph is

**One sentence**: a map of how ingredients relate to each other, learned from what cooks actually
put together in recipes and from the aroma molecules those ingredients share.

### The paper

*FlavorGraph: a large-scale food-chemical graph for generating food representations and
recommending food pairings*, Donghyeon Park, Keonwoo Kim, Seoyoon Kim, Michael Spranger, Jaewoo
Kang. Scientific Reports 11, 931 (2021). Open access, Creative Commons Attribution 4.0.
Park, Kim, Kim and Kang are Korea University; Spranger is Sony AI, which describes the project as
predicting "the pairing fit of two ingredients by combining information on the molecules in a
given ingredient with the way people have used that ingredient in the past."

### What is in the graph

Counts below are from the raw CSV files in the GitHub repo (`input/nodes_191120.csv`,
`input/edges_191120.csv`), which I downloaded and counted; they match the paper.

| Thing | Count | Where it came from |
|---|---|---|
| Ingredient nodes | 6,653 (416 "hub" ingredients that have chemistry data, 6,237 without) | Recipe1M (about 1 million scraped recipes) |
| Flavour-compound nodes | 1,561 | FlavorDB (IIIT-Delhi flavour-molecule database) |
| Drug-like compound nodes | 84 | HyperFoods |
| Ingredient–ingredient edges | 111,355, each with a 0..0.86 score | Co-occurrence in recipes, scored by NPMI (normalised pointwise mutual information: "these two appear together more than chance would predict"). An edge exists only if the pair co-occurred often enough (ingredient seen 20+ times, pair 5+ times) or NPMI ≥ 0.25. |
| Ingredient–flavour-compound edges | 35,440 (no score, just "contains") | FlavorDB |
| Ingredient–drug-compound edges | 384 | HyperFoods |

Every one of the 6,653 ingredients has at least one ingredient–ingredient edge, so the
co-occurrence part alone covers the full vocabulary.

Ingredient names are Recipe1M-style snake_case tokens and fairly noisy: `1%_fat_buttermilk`,
`10_inch_flour_tortilla`, `cedar_plank`, `dill` and `fresh_dill` as separate nodes, etc. Any
real use needs a cleanup / canonical-name pass (this is exactly what Epicure did, see §3.3).

### What the model adds

On top of the graph, the authors trained *FlavorGraph2Vec*: a 300-dimensional vector per node
using a modified metapath2vec random-walk method plus a "chemical structure prediction" layer that
pushes chemistry knowledge from the 416 hub ingredients out to the other 6,237. The pre-trained
embeddings are a 10 MB pickle file.

With embeddings you can do things the raw graph cannot:

- **Pairing score for any two ingredients** (cosine similarity), even ones that never co-occurred.
- **Neighbours**: "what is most like X". The paper does this for substitution-style questions.
- **Pair-with-a-set**: for several ingredients, the authors "simply summed the two vectors, and
  performed the similarity search on the summed result". That is the basic "given a spark, what
  else belongs" operation.

### Worked example from the raw edges (salmon and dill)

Top co-occurrence neighbours in the raw graph, no model needed:

- `salmon` → salmon_roe 0.36, shiso 0.33, sushi_rice 0.33, salmon_caviar 0.31, nori 0.30,
  cedar_plank 0.28, wasabi 0.27, dill 0.26
- `dill` → gravlax 0.38, smoked_salmon 0.34, dill_sprig 0.33, grape_leaf 0.33, parsley_root 0.31,
  pickling_cucumber 0.30, smoked_trout_fillet 0.29, salmon_caviar 0.29

So the graph "knows" salmon-dill is a real pairing (0.26, upper-middle for this graph) and
immediately surfaces two coherent directions: Japanese (shiso, nori, sushi rice, wasabi) and
Nordic/pickling (gravlax, cucumber, grape leaf). This is the raw material a Lab would build on.
It also shows the weaknesses: `dill_sprig`, `salmon_roe`/`salmon_caviar` and `smoked_salmon` are
all really "the same thing", and `cedar_plank` is a cooking vessel not an ingredient.

### What it does *not* know

- Nothing about taste dimensions (sour, salty, bitter, sweet, umami, heat, fat) as such. Those are
  only implicit in the vector geometry, which is what Epicure later dug out.
- Nothing about quantities, technique, cooking method, texture, or meal role.
- The paper's own limitations section: the pairing recommendations "have not yet been
  scientifically evaluated"; evaluation was by clustering quality (NMI 0.309 vs baselines) and
  case studies.

Sources:
- Paper (open access): https://www.nature.com/articles/s41598-020-79422-8 (DOI 10.1038/s41598-020-79422-8)
- Repo: https://github.com/lamypark/FlavorGraph (README lists the 209 MB training paths, 11 MB fingerprints and 10 MB pre-trained embeddings as Google Drive downloads)
- Raw node/edge files: https://raw.githubusercontent.com/lamypark/FlavorGraph/master/input/nodes_191120.csv and `.../edges_191120.csv`
- Sony AI write-up: https://ai.sony/blog/sony-ai-and-korea-university

---

## 2. What The Flavor Equation is

**One sentence**: a cookbook that explains cooking through the science of perception and gives the
cook a checklist of the components that make up flavour.

### The book

*The Flavor Equation: The Science of Great Cooking Explained in More Than 100 Essential Recipes*,
Nik Sharma, Chronicle Books, 27 October 2020, 352 pages, ISBN 9781452182698. Sharma trained as a
molecular biologist and worked in pharma before food writing.

### Is there an actual equation?

Only in the sense of a slogan. Sharma's own site states it as:

> "THE FLAVOR EQUATION = EMOTION + SIGHT + SOUND + MOUTHFEEL + AROMA + TASTE"

and in interviews as "six basic elements that constitute the all-important flavor of a dish:
emotion, sight (how a dish looks), sound (how it sounds when you eat it), mouthfeel (texture),
aroma, and taste." There are no weights, numbers or formulas; his own description of the method
is scientific *iteration*: "trying something, seeing if it works, and if it doesn't work out, you
try to figure it out through different iterations and experimentation."

### The seven "flavor boosters"

The recipe half of the book is organised into seven chapters, which the publisher and Sharma call
the taste elements / flavor boosters:

| Booster | What it means | Typical carriers (my paraphrase, not book text) |
|---|---|---|
| Brightness | Sourness / acidity | citrus, vinegar, tamarind, yogurt, fermented things |
| Bitterness | Bitter | coffee, cocoa, bitter greens, char, some spices |
| Saltiness | Salt | salt, soy, fish sauce, cured foods, cheese |
| Sweetness | Sugar and sweet aromatics | sugar, honey, ripe fruit, caramelisation |
| Savoriness | Umami | tomatoes, mushrooms, aged cheese, dashi, miso, meat |
| Fieriness | Heat / pungency (chilli, pepper, mustard, ginger) | chillies, black pepper, mustard, horseradish |
| Richness | Fat and its mouthfeel | butter, oils, cream, nuts, coconut milk |

Note that this is the classic five basic tastes plus two things Sharma promotes to first-class
status (heat and fat). Aroma, texture, sight, sound and emotion sit outside the seven as the other
terms of the "equation".

### Is any of it data?

No. There is no dataset, API or structured file. It is a **conceptual lens**, and it is Sharma's
copyrighted expression. The safe and practical approach for Julia is:

- Encode the *framework* (the seven boosters + texture/aroma/appearance) as our own small
  vocabulary and rubric. Frameworks and ideas are not copyrightable; the book's text, recipes and
  charts are, so we do not reproduce those.
- Hand-tag a few hundred common ingredients with which boosters they carry (this is a modest
  spreadsheet, and Todd's own culinary judgement is a feature, not a bug).
- Credit Sharma as the inspiration in the UI/docs.

Sources:
- Publisher page: https://www.chroniclebooks.com/products/the-flavor-equation
- Author's page, with the equation quote: https://niksharmacooks.com/the-flavor-equation/
- Author on emotion and taste: https://niksharmacooks.com/the-flavor-equation-emotion-taste/
- Silicon Valley ACS talk description (six elements quote): https://www.siliconvalleyacs.org/event/the-flavor-equation/
- Modern Farmer interview (iteration quote): https://modernfarmer.com/2020/10/nik-sharma-blends-science-and-food-in-the-flavor-equation/
- Milk Street interview: https://www.177milkstreet.com/stories/11-2020-nik-sharma-milk-street-radio

---

## 3. Can we actually use them?

### 3.1 FlavorGraph: yes, cheaply

| Question | Answer |
|---|---|
| Downloadable? | Yes. Node/edge CSVs are in the GitHub repo; embeddings via a Google Drive link in the README. |
| Licence | Repo (code + shipped data files) is **Apache License 2.0**. Paper is CC BY 4.0. |
| Upstream licences to be aware of | FlavorDB (the compound data) is **CC BY-NC-SA 3.0**, i.e. non-commercial + share-alike. Recipe1M was scraped from cooking websites by MIT for research; I could not find an explicit licence text on the im2recipe site. FlavorGraph only ships *derived* statistics (co-occurrence scores, embeddings), not recipes, and the authors chose Apache 2.0, but the FlavorDB-derived 35,440 ingredient–compound edges are the part most clearly encumbered. For a personal, non-commercial tool this is fine; if Julia were ever sold, drop or replace the compound edges and take advice. |
| Size | nodes CSV 343 KB; edges CSV 5.2 MB (111k ingredient pairs); embeddings ~10 MB (6,653 + 1,645 nodes × 300 floats). All of this fits in an offline-first PWA, in IndexedDB or as a static JSON/binary asset. The 209 MB training paths and the PyTorch/CUDA toolchain are only needed to *retrain*, which we would not do. |
| Compute needed at run time | Trivial. Cosine similarity over ~6.6k × 300 floats is a few milliseconds in JavaScript; top-N over the edge list is a table lookup. No server, no GPU, no AI model. |
| Format | Pickle (Python) for embeddings. One-off conversion script to JSON / Float32Array, done at build time, not in the app. |
| Freshness / maintenance | The repo is a 2020–2021 research artefact (Python 3.5, PyTorch 1.0). Treat the data as frozen; do not depend on the code. |
| Quality caveats | Noisy ingredient vocabulary (duplicates, brand-ish names, non-ingredients like `cedar_plank`); pairings reflect the Recipe1M corpus (mostly English-language US recipe sites); no quantities or technique. A canonical-name mapping is the main work item. |

### 3.2 The Flavor Equation: no data, but nothing to license either

The framework is a few dozen words; encoding it is a design task, not a data task. Effort is in
tagging ingredients with boosters, which can start small (the ingredients the Lab actually
suggests) and grow.

### 3.3 Epicure (the MCP tool already in this workspace)

Epicure is a ready-made candidate for the "what pairs with what" half, and it is directly lineal
to FlavorGraph.

- The April 2026 arXiv paper (Radzikowski & Chen, *Epicure: Multidimensional Flavor Structure in
  Food Ingredient Embeddings*, CC BY 4.0) took FlavorGraph's 300-d embeddings **without
  retraining**, used an LLM-assisted cleanup to collapse the 6,653 noisy ingredients to 1,032
  canonical ones, and showed that at least fifteen interpretable directions can be read out of the
  vectors: five tastes (sweet, salty, sour, bitter, umami), six textures (hardness, viscosity,
  crunchiness, chewiness, moisture, fattiness), Scoville heat, NOVA processing level, climate zone,
  and cuisine cluster. Curation improved every axis.
- The MCP server in this workspace describes itself differently: 1,790 ingredients, 300-d,
  "trained on a 4.14M-recipe multi-language corpus", with tools for `find_pairings`,
  `pairing_score`, `neighbors`, `compare_on_axis` (named axes such as `cf_sweet`, `cf_savory`,
  `cuisine:Japanese`, `usda_protein_g`, `nova`, `diet`), 20 emergent ICA flavour factors, GMM
  "modes", a 2-D UMAP atlas, `morph` (rotate an ingredient toward a target) and `pareto_navigate`.
  The public site (epicure.kaikaku.ai, by Kaikaku) says 1,790 ingredient embeddings and 30,000+
  recipes mapped and mentions "MCP for agents". So the live tool is a **newer, retrained model**,
  not the paper's artefact. I did not call it (out of scope for this ticket).
- **Why it matters for the Lab**: Epicure's taste/texture/heat/fat axes are almost exactly
  Sharma's seven boosters, read out of the embedding rather than hand-tagged. That could replace
  or seed the hand-tagging in §3.2.
- **What it would need to be evaluated against FlavorGraph** before we lean on it:
  1. Licence and terms of use for the *live* model and MCP (the site shows none; the paper is
     CC BY but the 1,790-ingredient model is not the paper's model). Can we download the vectors
     for offline use, or is it online-only?
  2. Coverage: does its 1,790-ingredient vocabulary cover the ingredients Todd actually cooks
     with? FlavorGraph has 6,653 (noisy) names; Epicure traded breadth for cleanliness.
  3. A side-by-side on 20–30 sparks Todd cares about (salmon+dill, lamb+apricot, etc.): do the
     suggested pairings feel right, and do the taste-axis readings agree with a cook's judgement?
  4. Determinism and availability: the MCP is described as deterministic and read-only, which is
     good, but an offline-first PWA cannot depend on a remote tool at cook time.

Sources:
- FlavorGraph licence: https://github.com/lamypark/FlavorGraph/blob/master/LICENSE (Apache 2.0)
- FlavorDB licence statement: https://cosylab.iiitd.edu.in/flavordb2/ ("Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License")
- Recipe1M: https://im2recipe.csail.mit.edu/ (no licence text found on page; flagged as an open question)
- Epicure paper: https://arxiv.org/abs/2604.22776
- Epicure product: https://epicure.kaikaku.ai/ ; data explorer https://epicure-data.kaikaku.ai/
- Epicure MCP tool descriptions: read from the tool schemas exposed in this workspace (not called)

---

## 4. How the Lab could combine them

The Lab's input is a **spark** (one or two ingredients), an **ambition level**, and a **meal
role**. The natural division of labour:

- **Pairing engine** (FlavorGraph or Epicure): expands the spark into candidate ingredients, in
  coherent clusters (the salmon example splits into a Japanese and a Nordic direction by itself).
- **Balance lens** (Flavor Equation rubric): looks at a candidate ingredient set and reports which
  of the seven boosters (plus texture and aroma) are present, missing, or over-represented, and
  suggests the *kind* of ingredient that would fill a gap ("this has richness and savoriness but
  no brightness: add an acid").
- **Ambition** maps to how far from the spark's nearest neighbours we roam (top-5 neighbours vs.
  deliberately picking a lower-ranked but still-plausible "bridge" ingredient) and how many
  boosters we insist on covering.
- **Meal role** filters obvious mismatches (dessert vs. main) and biases which boosters matter
  (a side can be one-note; a main should hit four or five).

### Option A: Offline "flavour compass" (no AI model)

Ship FlavorGraph's ingredient–ingredient edges (or the embeddings) plus a hand-written booster
tagging of a few hundred ingredients inside the PWA. The Lab is a guided picker: spark → three
clusters of suggested partners → user picks → balance meter shows gaps → suggestions to fill gaps
→ user names the dish and writes/edits the method. Output is a structured ingredient list and a
balance card, not prose.

- **Pros**: fully offline, deterministic, no cost per use, no licensing surprises beyond §3.1,
  fits the vintage/analogue UI direction. Todd's judgement stays in the loop, which suits a
  non-technical owner who is a good cook.
- **Cons**: no method/technique text; noisy FlavorGraph vocabulary needs a one-off curation pass
  (or use Epicure's curated 1,032/1,790 list if it can be exported); booster tags are manual work.
- **Best for**: the first version. Everything below builds on it.

### Option B: Offline compass + AI writer

Same engine as A, but once the ingredient set and balance card exist, hand them to an LLM
(online, opt-in) with a tight prompt: "Write a {meal role} recipe at {ambition} using exactly these
ingredients; here is the balance analysis; do not add ingredients." The structured data does the
creative constraint; the model does the prose and technique.

- **Pros**: gets real recipes with steps; the grounding data keeps the model from wandering; still
  works offline for the exploration part, degrading gracefully (no prose) without a connection.
- **Cons**: requires an API key and a network at authoring time; model output still needs Todd to
  check quantities and cook times; cost per recipe (small).
- **Best for**: version two, once A proves the pairing quality is worth it.

### Option C: Epicure-as-a-service (online pairing engine)

Skip bundling FlavorGraph and call the Epicure MCP/API for pairings, axis readings, and `morph`
("make this dish more Japanese", "less sweet"). The Flavor Equation rubric still lives in the app,
but its booster readings could come from Epicure's `compare_on_axis`/factors rather than hand tags.

- **Pros**: cleaner vocabulary, richer operations (cuisine steering, texture axes, Pareto
  trade-offs), no curation work, likely better than raw FlavorGraph.
- **Cons**: online-only unless Kaikaku allows exporting vectors; licence/terms unknown for the
  live model; a third-party dependency for a core feature of an offline-first app; the axis
  readings are statistical, not a cook's judgement, and need the evaluation in §3.3.
- **Best for**: an experiment behind a flag, or as the *source* for a one-off curated offline
  dataset if the terms permit.

### Trade-off summary

| | Offline | Licence risk | Needs AI model | Recipe text | Build effort |
|---|---|---|---|---|---|
| A: FlavorGraph + rubric | Yes | Low (personal use); FlavorDB NC caveat | No | No | Medium (curation + tagging) |
| B: A + LLM writer | Exploration yes, prose no | As A + LLM provider terms | Yes, opt-in | Yes | A + small |
| C: Epicure online | No | Unknown terms | No (deterministic) | No | Low, but a dependency |

Recommendation: **A first, with the data layer behind an interface so that the pairing source
(FlavorGraph edges, FlavorGraph embeddings, or an Epicure export) is swappable**, then B when a
recipe-writing step is wanted. Evaluate C in parallel on the 20–30 sparks in §3.3 before deciding
whether it replaces FlavorGraph as the bundled data.

---

## 5. Open questions for Todd

1. **Commercial intent.** Is Julia ever going to be sold or offered to others? If yes, the
   FlavorDB-derived compound edges (CC BY-NC-SA) should be excluded from the bundled data and we
   should look at Recipe1M's terms properly. If it stays personal, use everything.
2. **Booster tagging: who does it?** The Flavor Equation half only works with ingredient → booster
   tags. Are you happy to tag a few hundred ingredients yourself (your palate is the point), or
   should we seed it from Epicure's taste axes and have you correct it?
3. **What does "ambition" mean to you?** Two candidate meanings: (a) how unusual the pairings are
   (nearest neighbours vs. adventurous bridges), (b) how much technique the recipe demands. The
   pairing data can only drive (a); (b) needs an AI writer (Option B) or a technique library.
4. **Does the Lab need to produce a full recipe, or an ingredient set + balance card + your
   notes?** This decides whether Option B (an online AI step) is in scope for v1.
5. **Epicure evaluation.** Would you spend an hour scoring 20–30 spark → pairing suggestion lists
   from FlavorGraph vs. Epicure? That is the cheapest way to pick the data source.
6. **Which of Sharma's non-taste terms matter in the UI?** Texture and aroma are easy to add to
   the rubric; sight, sound and emotion are real but hard to make actionable. Suggest: texture
   yes, aroma yes, the other three as an optional "notes" prompt.
7. **Cuisine steering.** The salmon example shows the data naturally forks by cuisine. Should the
   Lab expose that (choose a direction) or hide it (just pick partners)?
