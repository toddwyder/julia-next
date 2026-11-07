---
version: 1
slug: "app-recipes-page-jsx"
primary_target: "app/recipes/page.jsx"
related_targets: []
---

Job: Todd at the desktop while planning; Tina occasionally, usable cold. Two jobs: find a known recipe by name; browse for something to cook. This is the home page.
Success: a known recipe found in seconds by typing; when browsing, each recipe judged by title, then ingredients.
Look: the recipe page's locked world (Apothecary 1750, palette 3; see .impeccable/surfaces/app-recipes-id-page-jsx.md). Old, engraved and hand-drawn; no photos. Visitor mode: Operate.
Scope: desktop first, adapts to phone. Main navigation: Library, Lab, Shopping List, Menus, Prep List. Import (link, paste, cookbook) and Add recipe reachable here. One alphabetical list; search across title, ingredients and source; Recently opened (5) when search is empty; Under 30 minutes switch; no folders, tags or categories. Score and glycemic load are not shown in the library (Todd, 6 Nov 2026: they spoil the look); they stay on the recipe page.
Ranges: 600+ recipes (coming from Samsung Food), so letter jumping and fast search are essential; titles 2 words to ~60 characters; 5–30 ingredients; search with no matches.
Layout: search box is the primary control, results update as you type; one column read straight down (never rows across, which slow scanning); each entry shows title, then key ingredients, then time and servings when known; tap opens the recipe.

## Selected layout (locked by Todd, 6 Nov 2026; seed:b5c9d9efefdbbeb1)
Locked sketch: .impeccable/mocks/decision/library-locked.html (desktop first screen, 1440x900; the composition the build matches).
- "Folded page": sage top bar with the main menu (Library, Lab, Menus, Prep List, Shopping List; current one underlined), Import (outline) and Add recipe (madder) at the right. The locked Julia logo sits at the left.
- Logo lock, 7 Nov 2026. The sage top bar is about 112px tall on desktop and 76px on phone. The locked logo sits at the left, with its aspect ratio preserved.
- Top-bar logo: `.impeccable/mocks/logo/final/julia-logo-cream-on-sage.png`.
- Browser-tab icon: `.impeccable/mocks/logo/final/julia-tab-icon.png`.
- Spare for parchment backgrounds: `.impeccable/mocks/logo/final/julia-logo-umber-on-parchment.png`.
- Search on top ("What shall we cook? Search titles, ingredients or source…") with the Under 30 minutes switch beside it.
- Recently opened is a page flap under the search that folds up and down, listing the last 5 recipes opened.
- One centred column of jar labels (sage double border, pointed ends, plain paper inside) under madder italic letter heads; title left, time and servings right; key ingredients on a second line in italic.
- A–Z strip down the right edge to jump by letter; letters with no recipes greyed.
- Rejected along the way: grids and multi-column layouts (scan across then back is slow), Score/GL on entries.

Settled (Todd, 6 Nov 2026): each entry shows 4 key ingredients, chosen as what makes the dish distinctive, never staples such as salt, eggs or sugar; fewer when a recipe has fewer. On phone the main menu (Library, Lab, Menus, Prep List, Shopping List) is a bar at the bottom of the screen, the top bar shows only the logo, and Import and Add recipe are buttons under the search box (they are commands, not navigation).

## Direction contract
THESIS: Find a known recipe in seconds by typing, or browse by title then ingredients. Refuses grids and cards.
OWN-WORLD: The recipe page's world and palette. Each recipe a jar label in one centred column under madder italic letter heads.
STORY: The visitor types and the list narrows as they type, or jumps by letter and picks by title and ingredients.
FIRST VIEWPORT (desktop): sage bar with logo, main menu (current underlined), Import (outline) and Add recipe (madder) at right; search on top with the Under 30 minutes switch; Recently opened flap; the column with title left, time and servings right, 4 distinctive key ingredients in italic beneath; A–Z strip on the right edge. Phone: main menu in a bottom bar; Import and Add recipe under the search box.
FORM: the locked sketch, seed:b5c9d9efefdbbeb1.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
