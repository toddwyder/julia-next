# Julia

Julia is an offline-first culinary management tool for one household: recipe intake, menu
planning, shopping lists, kitchen prep, and full-screen cook mode.

## Language

**Household**:
The group of people who cook together and share one collection of recipes, menus, shopping
list, and pantry. There is exactly one household; every piece of data in Julia belongs to it,
never to an individual.
_Avoid_: Account, family, user group, workspace

**Household account**:
One of the two Google accounts Julia accepts at sign-in. Being signed in with one means being
in the household; Julia never distinguishes between them.
_Avoid_: User, member, login, profile

**Front door**:
The screen a signed-out device shows: the logo and a single "Sign in with Google" button. The
only way into Julia; there is no public part.
_Avoid_: Login page, landing page, splash screen

**Device**:
A phone, tablet, or computer signed into the household. Screen preferences (text size,
keep-screen-on) belong to the device, not to a person.
_Avoid_: Client, session, user

## Kitchen

**Recipe**:
A titled set of ingredient lines and steps with a yield, prep and cook time, notes, and a
source. Stored as written; everything else (total time, conversions, scaling, badges,
nutrition) is derived on display.
_Avoid_: Dish, card, entry

**Ingredient line**:
One line of a recipe's ingredients as the cook wrote it, plus the parts Julia understood from
it: amount, unit, ingredient, preparation. The written line is the truth; the parts are the
understanding.
_Avoid_: Item, row

**Ingredient**:
The named thing an ingredient line is about ("all-purpose flour"), independent of amount or
preparation. What the shopping list, nutrition, and the drawing beside the line key on.
_Avoid_: Product, item, food

**Step**:
One numbered action in a recipe's method, as written. Cook mode shows one at a time; the prep
list is built from them.
_Avoid_: Instruction, paragraph, direction

**Yield**:
What a recipe makes: a number and a word ("4 servings", "75 crackers", "1 loaf"). Scaling
changes the number; nutrition is per one of the word.
_Avoid_: Servings (as the field name), portions, makes

**Source**:
Where a recipe came from: a web address, a book and page, or a person.
_Avoid_: Origin, URL, author

**Menu**:
One sitting: a title, an optional date and serving time, a guest count, and its dishes. Past
menus move to a Past list by themselves.
_Avoid_: Meal plan, event, occasion, week

**Dish**:
A recipe placed on a menu with a multiplier (1×, 1½×, 2×) that Julia proposes and Todd can
change. A recipe appears at most once per menu.
_Avoid_: Planned recipe, course, item

**Cook mode**:
The full-screen view of one recipe or block, one step at a time with that step's ingredients,
screen kept awake. Moved through by tap zones or, when enabled, voice. Timers come from the
step text.
_Avoid_: Cooking mode, step mode, kitchen view

**Prep list**:
The timeline Julia proposes from a menu: make-ahead days, then the day, ordered back from
serving time. Todd ticks, drags, adds tasks, and pins; regenerating keeps his changes.
_Avoid_: Prep engine, schedule, plan

**Block**:
One piece of one dish on the prep list, with its own steps, ingredient lines, and time: a mini
recipe. A dish may split into a make-ahead block and a day-of block. Opens in cook mode.
_Avoid_: Task (that's a hand-added item), card, stage

**Shopping list**:
The household's one list of things to buy, one line per ingredient, grouped by aisle. Fed by
menus, recipes, typing, and voice.
_Avoid_: Grocery list, cart, basket

**Staple**:
An ingredient the household always has. Left unticked when a menu goes to the shopping list;
ticked only when running low. No stock is tracked.
_Avoid_: Pantry item, inventory, essential

**Store**:
A name an item can carry ("Costco") so the list can be filtered to where you are. Remembered
per ingredient after the first tag.
_Avoid_: Shop, vendor, location

**Cart Mode**:
The shopping list during a trip: big targets, screen on, ticked items sink. Exit Cart clears
what was bought.
_Avoid_: Shopping mode, checkout

**Import**:
Bringing a recipe into Julia from a link or pasted text. Read exactly when the page publishes
a machine-readable recipe; otherwise by Julia's own on-device reader, then by a model only for
what the reader can't handle. Neither ever rewrites the text.
_Avoid_: Scrape, fetch, parse (in anything Todd reads)

**Clipper**:
The Chrome button that sends the page as the browser sees it, plus its address, into Import.
On phones the same job is done by sharing a link to Julia.
_Avoid_: Extension (in anything Todd reads), bookmarklet, web clipper

**Keep screen**:
The imported recipe shown as it would look, with Keep and Discard. The only way an import
enters the library.
_Avoid_: Preview, review form, draft

## Delivery

**Journey**:
One thing a person sets out to do in Julia, start to finish, on a named device. The unit the
spec is written in and the unit Todd accepts.
_Avoid_: Feature, story, epic, screen

**Evidence**:
What a builder hands over for a journey: one recording of it on the deployed Julia plus the
journey's checklist with a proof per line.
_Avoid_: Demo, proof of work, test results

**Gate**:
The check that evidence passes before it reaches Todd: code for what code can verify, a
reviewing agent for what needs the recording watched.
_Avoid_: Review, QA, approval

**Rehearsal copy**:
A temporary Julia, website and data, created for one proposed change. Evidence is recorded
there; it's thrown away once the change is accepted or dropped.
_Avoid_: Preview, staging, test environment

**Real Julia**:
The one Julia the household actually uses. Only accepted changes reach it.
_Avoid_: Production, prod, live
