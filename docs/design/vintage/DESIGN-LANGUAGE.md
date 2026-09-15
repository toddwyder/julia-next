# The Julia "vintage" design language

This document records, precisely enough to rebuild from, how the live Julia app
(https://julia-mu-green.vercel.app/) looks. It is the written companion to the
screenshots in this folder (`01-library.jpg` through `11-manual-entry.jpg`).

**Research date:** 2026-09-15. Ticket: JUL-22.

## Where these facts come from

Every claim below is tagged with one of these sources:

| Tag | Source | Trust |
|---|---|---|
| `[live-css]` | The two stylesheets the live site actually serves (`/_next/static/css/7a81de5bac8be33c.css` and `/_next/static/css/908f0aae06bdb653.css`, fetched 2026-09-15) | Highest: this is what the browser renders |
| `[layout.tsx]` | `app/layout.tsx` in the frozen repo `toddwyder/Julia` (commit `7581fd1`), which loads the fonts | Highest |
| `[vintage.css]` | `app/vintage.css` in the frozen repo: the colour tokens | Highest |
| `[component: X]` | A specific React component file in the frozen repo, which is where per-element styling lives | Highest |
| `[DESIGN.md]` | `DESIGN.md` at the root of the frozen repo: the *intended* vintage spec ("Vintage Culinary Archive") | High for intent, but the code sometimes diverges (noted where it does) |
| `[screenshot NN]` | Visual confirmation from the numbered screenshots in this folder | Confirms, never overrides code |

One important thing to know: the old repo contains **two** design systems. An older
"Warm Premium Culinary" system (`design-system/MASTER.md`, `app/globals.css`) and the
newer "Vintage Culinary Archive" (`DESIGN.md`, `app/vintage.css`). Both stylesheets
ship in the live app, but the vintage one is what every screen you see uses. The older
system is documented at the end only so its leftovers can be recognised and ignored.

---

## 1. Fonts

Four Google Fonts are loaded by `next/font/google` `[layout.tsx]`, each exposed as a
CSS variable and a Tailwind utility class `[live-css]`:

| Role | Family | Weights loaded | CSS variable / class | Where it is used |
|---|---|---|---|---|
| **Serif: the "voice of the chef"** | **Playfair Display** | 400, 500, 600, 700 | `--font-serif` / `.font-vintageSerif` | The default font for the whole page (set on `<body>`). Page titles ("Library", "Menu Planning Hub"), recipe titles, section headings ("The Ingredients", "Preparation"), the masthead line "THE JULIA COOKBOOK", ingredient names, instruction paragraphs, giant cook-mode step text, shopping-list category headers, small-caps eyebrow labels on the Lab page. `[layout.tsx]` `[component: RecipeContent, RecipeHeader, CookModeView, lab/page]` |
| **Sans: the "voice of the utility"** | **Inter** | variable (all) | `--font-sans` / `.font-vintageSans` | Nav tab labels, most buttons, form inputs and placeholders, field labels ("RECIPE TITLE"), metadata lines under recipe names ("40 MINS • 75 SERVINGS"), shopping list item text, descriptive body copy on Lab/Menus. `[component: VintageNav, page.tsx, new/page]` |
| **Mono: quantities and "typewriter" controls** | **Roboto Mono** | variable | `--font-mono` / `.font-vintageMono` / Tailwind `.font-mono` | Ingredient quantities ("2", "½"), Time and Serves values ("40 mins", "75"), the SCORE / GL badge, the recipe action buttons ("Start Cooking Mode", "Share Recipe", "Edit Recipe"), every button in cook mode, the "EXIT CART" pill, loading messages ("Loading recipe archive..."), the ingredient and instruction textareas on Edit/Manual Entry. `[component: NutritionBadge, RecipeContent, CookModeView, ShoppingListDisplay]` |
| **Script / handwriting** | **Caveat** | 400, 700 | `--font-cursive` / `.font-cursive` / `.font-vintageCursive` | Only the "Chef's Notes" block on a recipe (italic quotation signed "— Julia"). Not visible in any screenshot because the sample recipes have no notes. `[component: RecipeContent]` |

Fallback stacks declared in `[vintage.css]`: serif → `Georgia, serif`; sans →
`Helvetica, sans-serif`; mono → `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas`;
cursive → `Caveat, cursive`.

**The script "Julia" logo is an image, not a font.** `/public/assets/vintage-logo.png`
(1024×499 px) shows the word "Julia" in a dark-green brush-script hand next to an
engraved, cross-hatched mixing bowl with a whisk, on the cream background. It is rendered
at 128×64 px (144×72 px on tablet and up) `[component: RecipeHeader]`. The script style
is close to Caveat but is baked into the PNG; the rebuild should reuse the image.

**Type scale actually used** (Tailwind defaults, `[live-css]`):

| Class | Size / line height | Used for |
|---|---|---|
| `text-3xl` | 30 px / 36 px | Page titles ("Library", "Shopping List", "Edit Recipe"), recipe title on phone |
| `text-4xl` | 36 px | Recipe title on tablet and up; cook-mode step text |
| `text-2xl` | 24 px | "Prep Execution Engine", menu occasion title, section headings on tablet |
| `text-xl` | 20 px | Section headings ("Recipes", "The Ingredients", "Recipe Info"), library recipe names on tablet |
| `text-lg` | 18 px | Library recipe names on phone, "Import Recipe" / "New Item" labels, shopping category headers |
| `text-base` | 16 px | Inputs, ingredient rows, instruction paragraphs (tablet+) |
| `text-sm` | 14 px | Nav tabs (tablet+), instruction paragraphs (phone) |
| `text-xs` | 12 px | Nav tabs (phone), field labels, most buttons, metadata |
| `text-[10px]` | 10 px | "established 1961", bottom-nav labels, cook-mode step counter |

Note: the code also uses classes `text-2xs` and `text-3xs` (on the SCORE/GL badge and
the library metadata line) but **these are not defined in the shipped CSS**, so those
elements inherit their parent size instead `[live-css]`. Same for `shadow-xs`. The
rebuild should pick a real size (10–11 px reads right against the screenshots).

Letter-spacing values used with uppercase text `[live-css]`: `tracking-wide` 0.025em,
`tracking-wider` 0.05em, `tracking-widest` 0.1em. The Lab page uses inline
`letterSpacing: 2px–3px` on its 11 px serif eyebrow labels `[component: lab/page, EntryBriefForm]`.

---

## 2. Colours

### Core palette (the six you need)

| Role | Hex | Where seen | Source |
|---|---|---|---|
| **Cream page background** ("paper") | `#FDFCF7` | Every page, every card, every input, every outline-button fill, cook mode. Never pure white. | `[vintage.css]` `--color-vintage-bg`; `[DESIGN.md]` "paper-background" |
| **Ink** (body text) | `#333333` | All body copy, borders (at reduced opacity), the 1 px black rule around "typewriter" buttons | `[vintage.css]` `--color-vintage-text`; 57 uses in `[live-css]`, the most common colour |
| **Dark green: buttons and active states** | `#2D5A27` | "Import", "Edit Recipe", "NEXT STEP", "EXIT CART" fills; nav active-tab text and border; "Archive Menu" / "Generate Prep List" outlines; the Prep Execution Engine card border; low-GL badge fill; the "Begin Ideation" button when enabled | Hard-coded in components; 43 uses in `[live-css]`. Comment in `[component: NutritionBadge]` calls it "Heritage Forest Green" |
| **Forest green: headings** | `#2D4F36` | Page titles, section headings, recipe titles, "THE JULIA COOKBOOK", ingredient quantities, the "Import Recipe" label. Also the PWA theme colour. | `[vintage.css]` `--color-vintage-primary` (Tailwind `text-vintage-primary`); `[layout.tsx]` `themeColor`; `[DESIGN.md]` "forest-green" |
| **Terracotta accent** | `#C35231` | "Start Cooking Mode", "Import to Shopping List", "Add Recipes", "Nice Meal"/"Entrée" selected cards; "CART MODE" outline and fill; "Planned Dishes" and menu occasion title text; cook-mode recipe title; "Remove" links; high-GL badge fill; error banner text and border; the dashed empty-state box | Hard-coded in components; 42 uses in `[live-css]`. Comment in `[component: NutritionBadge]` calls it "Earthy Terracotta" |
| **Terracotta (token, lighter)** | `#D67D61` | Input focus border (`focus:border-vintage-accent`), shopping checkbox when ticked, skeleton-loader blocks, menu-tab active text, "New Menu" dashed outline, Chef's Notes text | `[vintage.css]` `--color-vintage-accent`; `[DESIGN.md]` "terracotta-accent". Only 3 direct uses in `[live-css]`; the components mostly bypass it with `#C35231` |

**A note on the green and terracotta pairs.** `DESIGN.md` intended one green (`#2D4F36`)
and one terracotta (`#D67D61`). The components were written with the older system's
hex values (`#2D5A27`, `#C35231`) hard-coded, so on screen you get *both*: slightly
bluer-green headings and slightly yellower-green buttons; a soft terracotta on focus
rings and a punchier terracotta on buttons. They are close enough that the eye reads
them as one green and one terracotta. The rebuild can legitimately choose either; if
you want to match the screenshots exactly, use `#2D4F36` for headings and `#2D5A27` for
buttons, and `#C35231` for anything terracotta that is a button or title.

### Supporting colours

| Role | Value | Where seen | Source |
|---|---|---|---|
| Divider / hairline | `rgba(51, 51, 51, 0.15)` | Rules under the masthead, under nav, between library rows (at 30 %), between ingredient rows (at 50 %), section dividers, input borders | `[vintage.css]` `--color-vintage-divider`; `border-[#333333]/15` in components |
| Stronger border | `rgba(51, 51, 51, 0.30–0.45)` | Menu cards, SCORE/GL badge frame (40 %), unchecked shopping circles (45 %), date/time inputs (40 %) | `[component: NutritionBadge, MenuHeaderEditor, CategoryGroup]` |
| Solid ink border | `#333333` at 100 % | Recipe action buttons, every cook-mode button and the cook-mode header/footer rules, offline banner, Lab profile box and ambition cards | `[component: RecipeContent, CookModeView, EntryBriefForm]` |
| **Pale green: active nav tab fill** | `#E2EBE2` | Behind the active nav tab ("Library" in `01`, "Lab" in `02`), active bottom-nav tab on phone, hover on green outline buttons | `[component: VintageNav, VintageBottomNav, menus/page]` |
| **Sage: disabled primary button** | `#9AA899` | "Begin Ideation →" when the spark box is empty `[screenshot 02]` | `[component: EntryBriefForm]` |
| Sage (via opacity) | `#2D5A27` at 50 % opacity over cream (≈ `#96AC94`) | "Import" and "Add" buttons when their input is empty `[screenshot 01, 03]`. These are `disabled:opacity-50`, not a separate colour. | `[component: page.tsx, AddItemInput]` |
| Sage (spec only) | `#768B73` | Named "sage-muted" in the spec for toggles and status; not found in any component | `[DESIGN.md]` |
| Warm grey: menu tab fill | `#EAE8E7` | Active menu pill ("End of summer" in `05`), archived-menus drawer, autocomplete hover | `[component: MenuSelectorDrawer, AddItemInput]` |
| Pale peach: error banner fill | `#FDF3EB` | Import / sync error banners (with `#C35231` text and border) | `[component: page.tsx, shopping/page, menus/page]` |
| Terracotta hover | `#A33E20` | Hover state of every solid terracotta button | components, 4 uses in `[live-css]` |
| Green hover / pressed | `#1E3C1A`, `#1E3D1B` | Hover of "EXIT CART" and "Begin Ideation" | `[component: ShoppingListDisplay, EntryBriefForm]` |
| Darker green (nutrition panel) | `#1E3E2B` heading, `#1B3B2B` button, on `#F7F5F0` panel with `#E5E0D8` border | The nutrition section below "Preparation" (not screenshotted) | `[component: RecipeNutritionSection]` |
| Ambiguous-ingredient text | `#C05C46` | Ingredient rows the parser was unsure about | `[component: RecipeContent]` |
| Validation red | `#D35400` | 2 px border and message on invalid form fields | `[component: new/page]` |

### Colours that ship but are *not* part of the vintage look

These come from the older system or from Tailwind defaults and should not be copied
`[live-css]`: `#f7e7b8` (the gold body colour visible *outside* the app frame in every
screenshot; it is the old `--color-bg` on `<body>`, immediately covered by the cream
container), `#FFFDD0` / `#228B22` / `#E2725B` ("julia-cream/green/terracotta" Tailwind
names from the old config), `#C4622D`, `#2D7A2D`, `#B8860B`, `#C0392B`. The "Sign in
with Google" button at the very top of every page uses default Tailwind greys
(`border-gray-300 bg-white text-gray-700`) and is not styled in the vintage language
`[component: RootLayoutClientWrapper]`.

---

## 3. Layout and spacing

- **Fixed content column: 800 px**, centred. `--container-max-width: 800px` in
  `[vintage.css]`; applied as `max-w-vintage-bound` on the outer container
  `[component: RecipeLayout]` and repeated as `max-w-[800px]` on each page's `<main>`.
  `[DESIGN.md]` explains why: "mimics the width of a printed book page".
- **Side padding:** 16 px on phone, 24 px on tablet and up (`px-4 md:px-6`).
  Vertical: 24 px top / 80 px bottom on phone (room for the bottom nav), 48 px top and
  bottom on tablet and up. `[component: RecipeLayout]`
- **Everything is one column.** `[DESIGN.md]`: "Multi-column layouts are prohibited for
  recipe content. The flow must be strictly linear." The only grids are the 3-up
  Servings / Prep / Cook inputs, the 3-up Date / Time / Guests on a menu, and the 2×2
  ambition cards on the Lab.
- **Vertical rhythm:** pages stack sections with 24 px gaps (`gap-6`); library rows are
  separated by 20 px plus a hairline with 16 px margins; ingredient rows have 10 px
  vertical padding; recipe sections are separated by a full-width hairline with 32 px
  margins (`SectionDivider`, `my-8`). `[component: page.tsx, RecipeContent]`
  `[DESIGN.md]` names the intent: `stack-lg` 48 px, `stack-md` 24 px, `stack-sm` 12 px.
- **Corners are square.** Nearly every button, input, card and badge has
  `rounded-none`. The exceptions: nav tab pills and menu tab pills (`rounded-md`, 6 px),
  the round ± serving buttons and shopping-list check circles, the Chef's Notes box
  (`rounded-sm`, 2 px) and the nutrition panel (`rounded-xl`). `[live-css]` `[components]`
- **No drop shadows** on cards or buttons in normal use. `[DESIGN.md]`: "This design
  system rejects digital shadows in favor of Tonal Layers and Bold Outlines." The only
  shadows are on floating things: the cook-mode ingredient drawer, the "EXIT CART" pill,
  toast banners, modals. (`shadow-xs` appears on several elements but is undefined in
  the CSS, so it renders as nothing.) `[live-css]`
- **Responsive breakpoint:** one that matters, `md` = 768 px. Below it: a fixed
  bottom nav appears and the top nav wraps. `[component: VintageBottomNav, VintageNav]`

---

## 4. Components

### 4.1 Masthead (every page)

`[component: RecipeHeader]` `[screenshot 01–08, 10, 11]`

Centred stack, 8 px top padding, 24 px bottom padding, then a full-width hairline
(`border-b border-vintage-divider`) and 32 px space before the nav.

1. The **logo image** (`vintage-logo.png`, 128×64 px, 144×72 on tablet+), 16 px below it:
2. **`❧ The Julia Cookbook ☙`** in Playfair Display, bold, uppercase, `tracking-widest`
   (0.1em), 12 px (14 px tablet+), forest green `#2D4F36`.
3. **`established 1961`** in Playfair Display, 10 px (12 px tablet+), regular weight,
   lowercase italic, `tracking-wide`, ink at 50 % opacity.
4. A tiny 64 px-wide centred hairline at half the divider opacity, 4 px below.

### 4.2 Navigation tabs

`[component: VintageNav]` `[screenshot 01–06]`

Five text links, centred, in Inter, `font-medium`, 12 px (14 px tablet+),
`tracking-wide`; 24 px between them (32 px tablet+); 8 px vertical padding; a
faint hairline below the row (`border-vintage-divider/30`) and 16 px margin under it.

- **Labels:** Library · Lab · Shopping List · Menus · Prep List.
- **Inactive:** ink at 80 % opacity; hover turns text `#2D5A27`. No underline.
- **Active:** a pill: background `#E2EBE2`, text `#2D5A27`, bold, 12 px horizontal
  padding, `rounded-md` (6 px), 1 px border `#2D5A27` at 40 %.
- On the recipe-detail and form pages (`07`, `10`, `11`) no tab is active.

**Phone bottom nav** `[component: VintageBottomNav]`: fixed, 64 px tall, cream with a
hairline top border; four items (Library, Shopping List, Menus, Prep List; no Lab) each
a Lucide icon (20 px) over a 10 px bold Inter label; active item gets the same pale-green
pill treatment. It slides away in cart mode.

### 4.3 Page titles and eyebrow labels

- **Page title:** Playfair Display 30 px, forest green `#2D4F36`; centred on Library,
  Edit and Manual Entry; left-aligned on Shopping List and Menus (with an action button
  on the right and a hairline beneath). Bold on Menus/Lab, regular elsewhere.
  `[component: page.tsx, shopping/page, menus/page, new/page]`
- **Subtitle under form titles:** 12–14 px italic, ink at 70 %, starts with `❧`
  ("❧ Enter recipe details below to save it manually to your vintage cookbook
  collection."). `[component: new/page, edit/page]` `[screenshot 10, 11]`
- **Lab eyebrow:** "RECIPE IDEATION LABORATORY" in Playfair 11 px, uppercase, 3 px
  letter-spacing, terracotta `#C35231`, above the title; the form section labels ("HOW
  AMBITIOUS ARE WE?", "WHAT'S YOUR SPARK?", "MEAL ROLE") use the same style in 11 px
  with 2 px spacing. `[component: lab/page, EntryBriefForm]` `[screenshot 02]`
- **Form field labels:** 12 px, bold, uppercase, `tracking-wider` ("RECIPE TITLE",
  "SERVINGS", "PREP TIME (MIN)"). `[component: new/page]` `[screenshot 10, 11]`
- **Shopping category header:** "BAKING & SPICES" in Playfair 18 px bold, uppercase,
  `tracking-wider`, forest green, with a hairline under it. `[component: CategoryGroup]`
  `[screenshot 03]`

### 4.4 Buttons

There are four recurring button styles. All are square-cornered unless noted.

| Style | Recipe | Examples | Source |
|---|---|---|---|
| **Solid green** | fill `#2D5A27`, cream text, 1 px border (`#2D4F36` or `#333333`), Inter 16 px regular or Inter/mono 12 px bold; hover `opacity-90`, press `scale(0.98)`, disabled `opacity-50` | Import; Edit Recipe; Add (shopping); NEXT STEP → (cook mode) | `[component: page.tsx, RecipeContent, CookModeView]` |
| **Solid terracotta** | fill `#C35231`, cream text, border `#C35231` (or `#333333` for the "typewriter" variant), Inter 12 px bold; hover `#A33E20` | Start Cooking Mode; Import to Shopping List; Add Recipes; Retry; Clear Search; IN CART MODE (active) | `[component: RecipeContent, menus/page, ActiveCartToggle]` |
| **Outline on cream** | fill `#FDFCF7`, 1 px border in the text colour, 12 px bold Inter; hover = 10 % tint of the border colour | Manual Entry (green `#2D4F36`); Archive Menu, Generate Prep List →, + Add Task (green `#2D5A27`, hover fill `#E2EBE2`); Share Menu, CART MODE (terracotta); Share Recipe, Share, Enable Voice, ← PREVIOUS STEP (ink `#333333`, mono) | `[component: page.tsx, MenuHeaderEditor, menus/page, prep/page, RecipeContent, CookModeView]` |
| **Typewriter** (mono, uppercase) | Roboto Mono 12 px bold, uppercase, `tracking-wider`; height 40 px (48 px in cook-mode footer); 1 px `#333333` border | All three recipe action buttons; every cook-mode control; "✕ EXIT CART" pill (green fill, **2 px terracotta border**, `tracking-widest`, 24 px horizontal padding, floating with `shadow-2xl`) | `[component: RecipeContent, CookModeView, ShoppingListDisplay]` |

Sizes: standard height 48 px (`h-12`) for Import / Manual Entry / Add next to inputs;
40 px (`h-10`) for recipe actions; small buttons are `px-3.5 py-2` (14 × 8 px padding)
at 12 px text. `[components]`

Other: "Remove" and "Edit Title" are plain terracotta / grey text links, 12 px bold,
underline on hover. The Lab's "Begin Ideation →" is Playfair 600, 1 px letter-spacing,
no border, green when enabled, `#9AA899` sage when disabled. `[component: EntryBriefForm]`

### 4.5 Inputs

`[component: page.tsx, AddItemInput, new/page]` `[screenshot 01, 03, 10, 11]`

- Height 48 px, 16 px horizontal padding, 16 px text, cream `#FDFCF7` fill, 1 px
  border ink at 15 %, square corners, Inter. Placeholder is the browser default grey.
- Focus: no outline; border turns terracotta `#D67D61`. (Menu date/time fields use a
  1 px `#C35231` ring instead.)
- Search box: same, with a 20 px magnifier icon at 45 % ink inset on the left
  (`pl-10`).
- Textareas on Edit / Manual Entry are **Roboto Mono** (they hold one ingredient or
  step per line). Numeric fields (Servings, Prep, Cook) are also mono.
- Invalid field: 2 px `#D35400` border, mono 12 px message prefixed `*`.
- Selects (Prep page): 14 px Inter, 1 px `#2D5A27` border, **white** fill (one of the
  few white elements).
- Lab "ambition" cards `[screenshot 02]`: 1 px `#333` border, cream fill; selected card
  fills `#C35231` with cream text. Title Playfair 600 14 px, description Inter 11 px at
  80 %. Meal-role chips are the same recipe in a single row with Inter 0.5 px spacing.

### 4.6 SCORE / GL badge

`[component: NutritionBadge]` `[screenshot 01]` (rendered right-aligned on each library row)

An inline strip, Roboto Mono throughout, 8 px horizontal / 4 px vertical padding, cream
fill, 1 px border ink at 40 %, square corners, no shadow. Contents left to right:

1. `SCORE` — bold, uppercase, `tracking-wider`, ink at 70 % (size class `text-2xs` is
   undefined, so it inherits; ~10 px reads right).
2. The score number, e.g. `~1` — bold, 12 px (14 px tablet+), green `#2D5A27`. The
   tilde prefix means "estimated".
3. A `•` separator, ink at 30 %, 2 px side padding.
4. `GL 2.7` — a sub-chip, bold uppercase `tracking-wider`, 6 px horizontal / 2 px
   vertical padding, coloured by glycemic-load category:
   - **low** (≤ 10): fill `#2D5A27`, cream text (e.g. "GL 2.7", "GL 9.7").
   - **medium** (11–19): cream fill, ink text, 1 px border ink at 30 % (e.g. "GL 17.8", "GL 16.5").
   - **high** (≥ 20): fill `#C35231`, cream text (e.g. "GL 25.4", "GL 23.7").

Hovering shows a title like "Nutrient Density: ~1/100 | Glycemic Load: 2.7 (low)".

Other small badges: the "Make Ahead" / "Single Block" chips on prep cards (pale green
fill) and the wake-lock badge ("💡 SCREEN WAKE LOCK ACTIVE": 12 px Inter semibold,
`#2D5A27` text, 10 % green fill, 1 px green border) `[component: prep/page]`
`[screenshot 06]`.

### 4.7 Cards

Cards are rare and deliberately flat `[DESIGN.md]`: cream fill, 1 px border, square,
no shadow.

- **Form section card** (Recipe Info / Ingredients / Instructions on `10`, `11`):
  16 px padding, border = divider at 30 %; heading Playfair 20 px forest green with a
  hairline (`#2D4F36` at 20 %) under it. `[component: new/page]`
- **Menu header card** (`05`): 20–24 px padding, border ink at 30 %; occasion title
  Playfair 24–30 px bold **terracotta**; a hairline row separating title/actions from
  the Date / Time / Guests grid. `[component: MenuHeaderEditor]`
- **Planned-dish card** (`05`): 16 px padding, border ink at 30 %; title Playfair 16 px
  bold ink; metadata Inter 12 px at 70 % with `•` separators. `[component: menus/page]`
- **Prep Execution Engine card** (`06`): 24 px padding, **1 px solid `#2D5A27`
  border**, 32 px bottom margin. `[component: prep/page]`
- **Empty / error states**: dashed 1 px terracotta border at 40 % on cream, centred
  Playfair heading in terracotta. `[component: page.tsx, menus/page]`
- **Cook-mode step-ingredients panel** (`09`): 10 % green fill, 1 px green at 30 %
  border, Playfair bold 20–24 px green text, items separated by 16 px, no commas.
  `[component: CookModeView]`

### 4.8 List rows

- **Library row** `[component: page.tsx]` `[screenshot 01]`: no card. Recipe name in
  Playfair 18–20 px bold forest green (turns terracotta on hover); the SCORE/GL badge
  floated right on the same line; beneath, a metadata line in Inter bold uppercase
  `tracking-wider`, ink at 60 %: `40 MINS • 75 SERVINGS` (optional italic note after
  another `•`). Rows separated by 20 px plus a hairline at 30 % with 16 px margins.
- **Ingredient row** `[component: RecipeContent]` `[screenshot 07]`: 10 px vertical /
  8 px horizontal padding, hairline bottom border at 50 %. Left: a small square
  ingredient illustration (AI-generated, "cut-out" style on white, sharp edges
  `[DESIGN.md]`), 12 px gap. Then the **quantity in Roboto Mono bold 16 px forest
  green** (`2`, `½`, `3`), a space, then unit + name + notes in Playfair 14–16 px ink
  ("cup all-purpose flour, (250g), plus more for kneading and rolling"). Units are
  lowercased.
- **Instruction step** `[component: RecipeContent]` `[screenshot 08]`: no numbers.
  Playfair 14–16 px, `leading-relaxed` (1.625), **justified**, 20 px between steps. If
  a step starts with a "Label:" prefix, that label is pulled out in Inter bold
  uppercase 12–14 px forest green.
- **Shopping item** `[component: CategoryGroup]` `[screenshot 03, 04]`: a 24 px round
  check circle (2 px border, ink at 45 %; ticked = filled `#D67D61` with a white tick),
  item text in Inter 14 px, and two small icon buttons (re-categorise, delete) at the
  right; hairline bottom border at 15 %. In **cart mode** the whole list becomes
  Inter bold 20–24 px green `#2D5A27` for at-arm's-length reading, the bottom nav
  hides, and the "✕ EXIT CART" pill floats at the bottom.

### 4.9 Recipe metadata strip

`[component: RecipeContent]` `[screenshot 07]`

Under the recipe title: a band with hairline top and bottom borders, 12 px vertical
padding, centred. Labels ("Time", "Serves") in Inter bold at 75 % ink; values ("40
mins", "75") in Roboto Mono bold 14–16 px ink; `•` separators at 40 %; round 28 px
`-`/`+` buttons (1 px ink at 30 % border) either side of the serving count; "Imperial /
Metric" toggle where the active word is green with a **terracotta underline** offset
4 px and the inactive one is at 45 % opacity. The three typewriter action buttons sit
on a second line inside the same band.

### 4.10 Cook mode (full screen)

`[component: CookModeView]` `[screenshot 09]`

A fixed, full-viewport cream layer (`z-50`) split into header / centre / footer, no
side column limit for the chrome but the text is capped at `max-w-3xl` (768 px).

- **Header:** cream, **1 px solid ink** bottom rule, 12 px vertical / 16–32 px horizontal
  padding. Left: a 40 px square `✕` button (1 px ink border), then the recipe title in
  Playfair bold 18–20 px **terracotta**, with a mono 10–12 px uppercase `tracking-wider`
  line under it: `STEP 1 OF 11 • 💡 WAKE LOCK ACTIVE` (green when the wake lock is on,
  terracotta when off). Right: outline typewriter buttons "Share" and "Enable Voice"
  (40 px tall; "Voice Active" fills green and pulses).
- **Centre:** vertically centred. Optional "ACTION: …" chip (10 % terracotta fill, 1 px
  terracotta border, Inter bold uppercase `tracking-widest`). Then the green
  step-ingredients panel (4.7). Then the **step text in Playfair bold, 24 px on phone
  rising to 48 px on desktop, `leading-relaxed`, `tracking-tight`, centred, ink**. If the
  step has a "Label:" prefix it is rendered in Inter bold uppercase terracotta.
- **Footer:** cream, 1 px ink top rule, 16 px vertical padding. Left: "🛒 STEP
  INGREDIENTS (9)" outline typewriter button (fills terracotta when its drawer is open).
  Right: "← PREVIOUS STEP" (outline, 30 % opacity when disabled) and "NEXT STEP →"
  (solid green). All 48 px tall.
- Swipe left/right, arrow keys, space, `i` (ingredients) and `Esc` (exit) are wired.
  The voice-command toast is a green full-width band with mono uppercase text.

---

## 5. Ornaments and voice

### Ornament characters

`[component: RecipeHeader]` and the census of every `.tsx` in the frozen repo:

| Glyph | Unicode | Name | Where |
|---|---|---|---|
| `❧` | U+2767 | ROTATED FLORAL HEART BULLET (a "hedera" / ivy leaf) | Left of "THE JULIA COOKBOOK"; the start of every helper sentence on forms ("❧ Enter recipe details below…", "❧ Review Required…", "❧ Add Ingredient Row", "❧ Caution: Unclear parsing", "❧ Kitchen Ledger Warnings", "❧ Minimize"). 17 occurrences. |
| `☙` | U+2619 | REVERSED ROTATED FLORAL HEART BULLET | Right of "THE JULIA COOKBOOK" (mirrors `❧`). 1 occurrence. |
| `•` | U+2022 | BULLET | Metadata separators: "40 MINS • 75 SERVINGS", "Time 40 mins • Serves 75 •", "STEP 1 OF 11 •". |
| `·` | U+00B7 | MIDDLE DOT | Separator inside the Lab "Kitchen Profile" line. |
| `→` `←` `✕` | | Arrows and cross | "Begin Ideation →", "Generate Prep List →", "Menus Hub →", "NEXT STEP →", "← PREVIOUS STEP", "✕ EXIT CART", the cook-mode close button. |

The masthead line is therefore exactly: `❧ THE JULIA COOKBOOK ☙` (uppercase comes from
CSS; the source text is "The Julia Cookbook"). `[DESIGN.md]` also asks for "diamond or
leaf glyphs in the center" of section dividers, but the shipped dividers are plain
hairlines `[component: RecipeContent SectionDivider]`.

### Voice and copy

The app speaks like a mid-century family cookbook `[DESIGN.md]`: "evokes the sensory
experience of leafing through a cherished, family-heirloom cookbook—specifically
capturing the era of Julia Child's 'The French Chef'"; "scholarly yet domestic".
Concretely, in the shipped copy:

- The masthead establishes a fictional institution: **"THE JULIA COOKBOOK / established
  1961"** (1961 is the year *Mastering the Art of French Cooking* was published; the
  code does not say so, but that is the evident reference).
- Sections are named like chapters: **"The Ingredients"**, **"Preparation"**,
  **"The Lab"**, **"Menu Planning Hub"**, **"Prep Execution Engine"**, **"Recipe Ideation
  Laboratory"**, **"Chef's Notes"** (signed "— Julia" in handwriting).
- Julia is addressed as a person: "Tell Julia what you're after, and she'll guide you
  through the creative process."; the empty-search state says **"I couldn't find that in
  my library."** / "Let's adjust the seasoning and try something else"; sync errors say
  "Hmm, we hit a snag organizing your list."
- Utility text is typewritten: uppercase mono for statuses ("WAKE LOCK ACTIVE", "STEP
  INGREDIENTS (9)", "EXIT CART", "CART MODE"), and loading states read like a librarian
  ("Loading recipe archive...", "Loading Occasion Menus...").
- Menus are "occasions"; a menu's dishes are "Planned Dishes"; the recipe list is the
  "Library" or "collection"; the master list is the "Master Cookbook".
- Emoji are used sparingly as icons in cook mode and prep (💡, 🛒, ⚠️, 👤), against
  the older system's rule of "No emoji as icons"; the rebuild can choose either way.

---

## 6. Things not determinable, and quirks to be aware of

- **Exact rendered pixel sizes of the SCORE/GL badge text and library metadata**: the
  classes `text-2xs` / `text-3xs` are undefined in the shipped CSS, so those sizes are
  whatever the parent gives. Judge from the screenshots (~10 px).
- **`--font-ui` and `--font-display`** are referenced by `globals.css` and by the Lab
  page's inline styles but are **never defined** `[layout.tsx]` `[live-css]`, so the Lab
  page's descriptive text and the "Edit" profile button fall back to the system
  sans-serif, not Inter. Treat that as a bug, not a design choice.
- **The mobile layout** was not screenshotted; the bottom-nav details above come from
  code only.
- **Ingredient illustrations**: the icons are per-ingredient PNGs fetched from a
  Firebase map (`public/data/ingredient_icon_map.json`) with a `vintage_fallback.png`;
  the drawing style (soft watercolour on white) is only visible in `07` and `06` and
  has no written spec beyond `[DESIGN.md]`'s "square aspect ratio with a subtle paper
  grain texture overlay… never have drop shadows".
- **Which green / terracotta is canonical** is a decision for the rebuild (see the
  note under Core palette). The live app uses both pairs.
- The "Sign in with Google" strip at the top of every screenshot is unstyled Tailwind
  grey and not part of the design.

---

## 7. Screenshot index

| File | Screen | Best for |
|---|---|---|
| `01-library.jpg` | Library (home) | Masthead, active nav pill, Import row, search, list rows, SCORE/GL badges in all three GL colours |
| `02-lab.jpg` | The Lab | Eyebrow labels, terracotta selected cards, meal-role chips, sage disabled button |
| `03-shopping-list.jpg` | Shopping List | Left-aligned title with outline "CART MODE" button, category header, check circles |
| `04-shopping-list-cart-mode.jpg` | Cart mode | Solid terracotta "IN CART MODE", bold list, floating "EXIT CART" pill |
| `05-menus.jpg` | Menu Planning Hub | Menu pills, header card with terracotta title, outline button pair, dish cards |
| `06-prep-list.jpg` | Prep List | Green-bordered engine card, timeline dots, task card with chips |
| `07-recipe-detail.jpg` | Recipe (top) | Recipe title, metadata band, typewriter buttons, ingredient rows with mono quantities |
| `08-recipe-detail-preparation.jpg` | Recipe (Preparation) | Justified Playfair instruction paragraphs |
| `09-cooking-mode.jpg` | Cook mode | Full-screen layout, ink rules, giant step text, footer controls |
| `10-edit-recipe.jpg` | Edit Recipe | Form section cards, uppercase labels, mono textareas |
| `11-manual-entry.jpg` | Enter a Recipe | Same as 10 with placeholders and the `❧` helper lines |
