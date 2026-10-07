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
keep-screen-on) and the current cook-mode step belong to the device, not to a person. While
cooking, a device's current block and running timers are visible to the household's other
devices.
_Avoid_: Client, session, user

**Installed Julia**:
Julia added to a phone or tablet's home screen, opening with its own icon and no browser
bar. The expected way to use Julia on a phone or the kitchen tablet; the way "share to Julia"
reaches it. On the desktop Julia is a Chrome tab.
_Avoid_: PWA, native app, the app (as if there were a store version)

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

**Voice add**:
Saying "Hey Google, add X to the shopping list" and having X appear on Julia's list a few
minutes later with no further action. Julia reads the household's Google Keep list through a
second Google account that exists only for that.
_Avoid_: Voice input, dictation, mic button, Keep sync (in anything Todd reads)

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

**Library**:
The household's whole collection of recipes, one alphabetical list with a search box that
matches title, ingredients, and source, a Recent strip on top, and one Under 30 minutes
switch. There is no other grouping: no folders, tags, or categories.
_Avoid_: Collection, recipe box, catalogue, cookbook (that's an import)

**Recent strip**:
The five recipes most recently added or edited, shown above the alphabetical list when the
search box is empty.
_Avoid_: Recently viewed, history, favourites

**Import**:
Bringing a recipe into Julia from a link or pasted text. Read exactly when the page publishes
a machine-readable recipe; otherwise by Julia's own on-device reader, then by a model only for
what the reader can't handle. Neither ever rewrites the text.
_Avoid_: Scrape, fetch, parse (in anything Todd reads)

**Cookbook**:
The plain-text export of a book the household owns, imported whole: every recipe found in it
lands in the library with the book as source. Book recipes can't be shared.
_Avoid_: Book upload, batch import, scan

**Clipper**:
The Chrome button that sends the page as the browser sees it, plus its address, into Import.
On phones the same job is done by sharing a link to Julia.
_Avoid_: Extension (in anything Todd reads), bookmarklet, web clipper

**Keep screen**:
The imported recipe shown as it would look, with Keep and Discard. The only way an import
enters the library.
_Avoid_: Preview, review form, draft

**Lab**:
Where a new recipe is invented: a spark and a time budget go in, four variations come back,
and an open conversation shapes one of them into a full draft that is kept or not. Online
only; one Lab conversation at a time, remembered on the device.
_Avoid_: Generator, ideation, AI chef, wizard

**Spark**:
What the Lab starts from: an ingredient or two, a dish name, a mood, or (via Riff) a whole
existing recipe. Becomes part of the kept recipe's source.
_Avoid_: Prompt, query, seed, input

**Variation**:
One of the four cards the Lab answers a spark with, each built from the pairing data a
different way: Classic, Adventurous, Chemistry, Balanced. A card carries a working title, a
menu-style description, the key ingredients, and one line on why they belong together.
_Avoid_: Option, suggestion, direction, result

**Riff**:
The button on a recipe that sends the whole recipe into the Lab as the spark. The outcome is a
new recipe; the original is never changed.
_Avoid_: Remix, improvise, fork, duplicate

**Score**:
The nutrient-density number on every recipe, 0 to 100 per serving: protein and fibre raise it,
saturated fat, added sugar, and sodium lower it. A "~" in front means an estimate.
_Avoid_: Health score, rating, grade, NRF

**Glycemic load**:
The per-serving number beside the score, from each ingredient's carbohydrate and glycemic
index. Low at 10 or under, medium to 19, high at 20 and over; the badge colour follows.
_Avoid_: GI (that's the ingredient's index, not the recipe's load), sugar score, carb count

**Nutrition panel**:
The per-serving block on the recipe page: score, glycemic load, calories, total fat, saturated
fat, carbs, sugars, protein, fibre, sodium. Always an estimate, worked out on the device from
the ingredient parts; tapping it lets you fix a wrongly matched ingredient.
_Avoid_: Nutrition facts, label, macros

**Shared page**:
The read-and-print page anyone with the link can open, showing a recipe or a whole menu as it
currently stands, no sign-in. The only thing in Julia the outside world can see; Stop sharing
removes it. Book recipes never appear on one in full.
_Avoid_: Public link, published recipe, export

## Delivery

**Journey**:
One thing a person sets out to do in Julia, start to finish, on a named device. The unit the
spec is written in and the unit Todd accepts.
_Avoid_: Feature, story, epic, screen

**Evidence**:
The checkable proof each step of a card leaves behind, tied to the exact change under test: the
failing test, the passing run, the guard check, both code-review reports, and the adversarial
review's verdict on every acceptance criterion. No evidence means not done, whatever an agent
says.
_Avoid_: Demo, proof of work, "it works"

**Adversarial review**:
A review by a different model maker than the builder's that tries to break the work rather
than confirm it, giving a verdict on every acceptance criterion or naming the evidence that is
missing.
_Avoid_: Second opinion, sign-off, approval

**Gate**:
The checks a pull request passes before merge: CI on GitHub's runners and Factory's different-maker
review, both on the same head. A failed gate bounces the work back to the builder.
There is no pre-merge Todd approval.
_Avoid_: Review, QA, approval

**Bounce**:
A gate or Todd sending work back to its builder, through Factory, with the reason it failed.
_Avoid_: Rejection, fail, kickback

**Backlog**:
Factory's Intake column. Cards wait there, including issues an agent opens, until Todd taps one
to start it.
_Avoid_: Queue, inbox, ready list

**Plan**:
The builder's written approach for one card, approved automatically and saved in the pull
request. It always names the seams and the failing tests written first, and the lasting
observability the change adds. Both reviewers check the work against it.
_Avoid_: Design, spec, ticket

**Coding standards**:
`CODING_STANDARDS.md`, the rules Factory's code review checks against. Grows one line at a time,
added in the same pull request as the fix that showed the rule was needed.
_Avoid_: Style guide, conventions, lint rules

**Exceptions list**:
The one list of every place we built our own piece instead of using Factory's, Mastra's, or
GitHub's, each with the gap it fills, its approval evidence, and when it can go. It records
existing approved pieces; the rejection check that would enforce it is not built yet.
_Avoid_: Workarounds, patches, customisations

**Rehearsal copy**:
A Julia website built for one proposed change, running on the test data. Todd follows the
card's steps on it before he accepts. Real Julia is never involved.
_Avoid_: Preview, staging, test environment

**UAT**:
Todd testing the Vercel preview before merge the way a household member would, following the
Linear card's steps, then accepting or sending it back. Only things a user would do: tap, type,
read the screen.
Never a console, log, terminal, developer tool, or copying between tools. Technical checking
is the robot's job and happens before UAT.
_Avoid_: QA, testing, verification (for Todd's part)

**Mastra Factory**:
The existing Factory code and server service. It is **PAUSED**, not removed: leave it in place but
do not start new cards through it. The intended replacement route is the adapted JUL-122 runner,
started on Todd's Windows laptop with `$init JUL-nnn`; both that runner and its route are pending
implementation and verification.
_Avoid_: Retired, deleted, active card runner

**Delivery ownership**:
New Julia and machine cards live in Linear. Linear owns cards, requirements, acceptance criteria,
and status. GitHub owns code, commits, pull requests, and CI. Run files own execution state. The
adapted JUL-122 runner, started on Todd's Windows laptop with `$init JUL-nnn`, is the intended
route. The adapted runner and `$init` wrapper are pending implementation and verification. This
documentation checkpoint does not authorize starting delivery through them. The adapted runner's
complete test suite must pass on Todd's Windows laptop before it is used for delivery.

**Test data**:
The one permanent set of Julia data that every rehearsal copy shares. Set up once; never
Real Julia's data.
_Avoid_: Staging database, sandbox, throwaway data

**Needs attention**:
Factory's own list of cards that are stuck, stalled, or waiting on someone, rechecked every five
minutes. How Todd tells a slow card from a dead one. A phone alert waits until this proves not
to be enough.
_Avoid_: Stuck alert, heartbeat, ping, alarm

**Real Julia**:
The one Julia the household actually uses. Only accepted changes reach it.
_Avoid_: Production, prod, live

**Monday note**:
The weekly summary the delivery system sends Todd, never written by him: what was accepted, what
each card cost in model spend including failed attempts, how long cards took, and every time Todd
was pulled in. Costs come from Mastra's traces, not agent reports. Quiet weeks say so.
_Avoid_: Report, dashboard, metrics (in anything Todd reads)

**Done by Factory**:
The per-card line, read from Factory's own audit records, saying whether every step was done by
Factory's agents or by Todd. Anything else means someone went around the product.
_Avoid_: Compliance, audit trail (in anything Todd reads)

**Model job**:
A role a model fills in Factory: the builder, the reviewer helper, or the memory model. Cards,
docs and code name the job, never the model. Each job's model is a setting in Factory or
Mastra, changed with no card, code or install, because models change all the time.
_Avoid_: Naming a specific model anywhere but the settings

**Builder**:
The model that writes a card's code. Chosen when the card starts, from how much quota each
connection has left; one setting has the default.
_Avoid_: Coder, worker model

**Reviewer helper**:
The model Factory's review hands the adversarial review to. Always from a different company
than the builder.
_Avoid_: Second reviewer, review model

**Reviewer list**:
The ranked list of models the reviewer helper is chosen from. Whenever the builder changes, the
reviewer helper becomes the first model on the list from a different company than the builder.
Edit the list to add, drop or reorder models; the rule stays.
_Avoid_: Reviewer pairing table

**Memory model**:
The cheap model Factory uses to summarize long sessions.
_Avoid_: OM model, observer model

**Connection**:
An account Factory may send model calls to: a subscription sign-in or a provider's key. Held in
Factory's own settings, never in the repository.
_Avoid_: Provider config, key file

**Backup**:
The folder in Todd's Google Drive that mirrors the household: a readable text file per
recipe, menus and the shopping list as text, and one machine file for restoring. Refreshed
overnight on days something changed; only changed files are touched.
_Avoid_: Export, dump, snapshot, sync
