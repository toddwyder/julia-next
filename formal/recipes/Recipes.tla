----------------------------- MODULE Recipes -----------------------------
\* A model of the two promises the household library makes with Firestore.
\*
\*   saveRecipe (lib/recipes.js, app/recipes/new/page.jsx) — one form, one
\*   recipe. The form's own id is fixed when the page opens, so a save that is
\*   answered by the library but whose answer never arrives can be tried again
\*   and still leaves one recipe.
\*
\*   moveBrowserRecipes (lib/recipes.js) — each recipe this browser already
\*   holds keeps its own id, and the browser copy is removed only after every
\*   upload has answered, so a move that is interrupted, and run again, or run
\*   from two tabs at once, neither duplicates a recipe nor loses one.
\*
\* Assumed, and therefore not checked here:
\*   - Firestore runs one transaction's read and its write as a single atomic,
\*     serialized step. saveRecipe's check-then-write relies on exactly that.
\*   - A stored recipe can never be updated or deleted (firestore.rules).
\*   - Ids are unique: a new recipe's id is a fresh UUID, and a moved recipe's
\*     id is the id it already had.
\* The model checks the order of the app's own steps, not Firestore's internals.
EXTENDS Naturals, FiniteSets, Sequences, TLC

CONSTANTS Forms,               \* text of each recipe the open form can submit
          BrowserRecipes,      \* ids of the recipes this browser stored before sign-in
          DocumentIds,         \* every id the library could hold a document under
          FreshIdOnEveryWrite, \* broken: pick a new id on every write instead of reusing it
          ClearBeforeUpload    \* broken: empty the browser before the uploads answer

VARIABLES library,   \* the household library, a sequence of documents [id |-> , text |-> ]
          form,      \* the recipe text the open form submits
          uploads,   \* per tab, the browser recipes that tab has uploaded
          browser,   \* browser recipes not yet moved
          cleared    \* the browser's copy has been removed

vars == <<library, form, uploads, browser, cleared>>

Documents(s) == {s[i] : i \in 1..Len(s)}

Has(id) == \E d \in Documents(library) : d.id = id

\* Firestore's create-if-absent: an id that already holds a document keeps it.
Create(id, text) ==
  IF Has(id) THEN library ELSE Append(library, [id |-> id, text |-> text])

\* The id a write lands on. The shipped code reuses the id it already has; the
\* broken variant picks any id, which is what a regenerated id amounts to.
WriteIds(text) == IF FreshIdOnEveryWrite THEN DocumentIds ELSE {text}

Init ==
  /\ library = <<>>
  /\ form \in Forms
  /\ uploads = <<{}, {}>>
  /\ browser = BrowserRecipes
  /\ cleared = FALSE

\* A new recipe page opens with its own form.
OpenForm ==
  /\ form' \in Forms
  /\ UNCHANGED <<library, uploads, browser, cleared>>

\* Pressing Save. A second Submit under the same form is the retry after an
\* answer that never arrived; the write may already have landed the first time.
Submit ==
  \E id \in WriteIds(form) :
    /\ library' = Create(id, form)
    /\ UNCHANGED <<form, uploads, browser, cleared>>

\* Moving one of this browser's recipes into the library, under its own id.
Upload(tab) ==
  \E r \in browser :
    \E id \in WriteIds(r) :
      /\ library' = Create(id, r)
      /\ uploads' = [uploads EXCEPT ![tab] = @ \cup {r}]
      /\ UNCHANGED <<form, browser, cleared>>

\* Removing the browser's copy. The shipped code only gets here once every
\* upload has answered; the broken variant does it first.
Clear(tab) ==
  /\ IF ClearBeforeUpload THEN TRUE ELSE uploads[tab] = browser
  /\ browser' = {}
  /\ cleared' = TRUE
  /\ UNCHANGED <<library, form, uploads>>

Next ==
  \/ OpenForm
  \/ Submit
  \/ \E tab \in {1, 2} : Upload(tab)
  \/ \E tab \in {1, 2} : Clear(tab)

Spec == Init /\ [][Next]_vars

Stored(text) == \E d \in Documents(library) : d.text = text

\* Save-once and move-once: one document per recipe, however many times Save is
\* pressed, however often the move is run, and from however many tabs.
SaveOnce == \A d1, d2 \in Documents(library) : d1.text = d2.text => d1 = d2

\* Nothing is lost: once the browser's copy is gone, every recipe it held is in
\* the household library.
NoLoss == cleared => \A r \in BrowserRecipes : Stored(r)

=============================================================================
