---
version: 1
slug: "app-recipes-id-page-jsx"
primary_target: "app/recipes/[id]/page.jsx"
related_targets: []
---

Job: Todd cooks at the stove on phone or tablet, sometimes reads or preps first; Tina occasionally, usable cold. Visitor mode: Read.
Success: one glance at the current step shows what to do and how much of each ingredient; no scrolling between ingredients and steps.
Look: locked 6 Nov 2026 (see Selected direction). Used, well-loved vintage cookbook, homage to Julia Child ("established 1961" = Mastering the Art of French Cooking); light paper, not monotone; no photos; no dark backgrounds; no pink; no forest green with terracotta; large high-contrast text readable from arm's length. Not the cream-paper-plus-serif default.
Scope: this page, phone and tablet first; Cook mode stays. Keep servings stepper, imperial/metric, Start Cooking Mode, Import to Shopping List, nutrition panel (score and glycemic load always shown as estimates), Share, Edit, Riff. Cooking content leads; nutrition, Share, Edit, Riff sit out of the way. The top bar uses the locked Julia logo.
Ranges: 5–30 ingredients, 3–20 steps; every recipe is linked; servings 1 to 75+, amounts rescale; long titles and steps; notes and source. Text arrives with HTML entities ("it&#8217;s") that must display as characters.
Layout: every recipe shows its complete ingredient list at the top, so browsing sees everything without scrolling into the steps. Each step also shows its own ingredients and amounts above its instruction (never in a narrow left column); the repetition is intended.
Taste evidence: liked boxed steps, a warm paper background, paper over dark; disliked black backgrounds, all-same looks, forest green/terracotta, pink, monotone, modern feel.

## Selected direction (locked by Todd, 6 Nov 2026; seed:c5295090e4f5cfb5)
Locked sketch: .impeccable/mocks/decision/recipe-page-locked.html (phone first screen and first steps; the composition the build matches).
- World: "Apothecary, 1750". An 18th-century household receipt book; vintage means old, engraved and hand-drawn, never 1950s/60s or pop.
- Palette 3, taken from the old Julia ingredient drawings: parchment ground (#f6f1e6), umber ink and frames (#2e2119 / #5a3e2e), faded madder red (#a24f3f) for step numbers, Start cooking and US/Metric selection, sage (#6f7c5a) for the top bar, section heads, ornaments and step-label borders. Ingredient list on a parchment panel (#efe2cf). No pink, no blue.
- Logo lock, 7 Nov 2026. The sage top bar is about 112px tall on desktop and 76px on phone. The locked logo sits at the left, with its aspect ratio preserved.
- Top-bar logo: `.impeccable/mocks/logo/final/julia-logo-cream-on-sage.png`.
- Browser-tab icon: `.impeccable/mocks/logo/final/julia-tab-icon.png`.
- Spare for parchment backgrounds: `.impeccable/mocks/logo/final/julia-logo-umber-on-parchment.png`.
- Type: IM Fell English (1600s) for titles and labels only; Libre Caslon Text for all reading text, one arm's-length size.
- Signature: each step's ingredients and amounts sit in a hand-drawn jar label (cartouche) above the instruction: plain paper inside, sage double border, pointed ends, step number in madder italic.
- Full ingredient list at the top uses the old Julia engraved ingredient pictures (toddwyder/julia public/icons/*.webp, via public/data/ingredient_icon_map.json); blank space where an ingredient has none. Amounts in a right-aligned column with true fractions.
- "You stopped here": the step last open carries a madder ring outside its sage label and a small note, and is still marked on return.
- Reading text sits on clean paper; decoration lives only in the frame (top bar, section heads, labels).
- Removed at Todd's request: the step-number marker on each ingredient in the full list.

Settled (Todd, 6 Nov 2026): nutrition sits open at the bottom of the page, after the steps. Every recipe is linked (steps carry their ingredients), so the page has no unlinked case. On phone the main menu is a bottom bar (see the library brief).

## Direction contract
THESIS: A cooking page where every step carries its own ingredients and amounts, so the cook never scrolls between list and step. Refuses the default of one list on top and bare steps below.
OWN-WORLD: Apothecary, 1750, a used household receipt book. Parchment ground, umber ink, madder for step numbers and Start cooking, sage for top bar, heads and label borders. Each step's ingredients in a jar label: sage double border, pointed ends, plain paper inside. IM Fell English titles; Libre Caslon Text reading text at arm's-length size. Engraved ingredient pictures in the full list. No photos, no dark backgrounds.
STORY: At a glance the cook sees what this step needs and how much, scaled to the chosen servings, and where they stopped.
FIRST VIEWPORT (phone): sage bar with logo; back to Library; title; servings stepper; US/Metric; Start cooking (primary); Add to shopping list; full ingredient list on a parchment panel with pictures and right-aligned amounts; then steps, each label above its instruction, "you stopped here" marked. Nutrition open at the bottom. Main menu in a bottom bar.
FORM: the locked sketch, seed:c5295090e4f5cfb5.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
