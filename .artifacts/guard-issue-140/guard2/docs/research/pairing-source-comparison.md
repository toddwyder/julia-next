# Pairing sources side by side: FlavorGraph vs Epicure, twenty sparks

Research note for Linear JUL-39. Written 2026-09-15. Companion to
`docs/research/flavorgraph-flavor-equation.md` (JUL-25), which explains what the two sources are.
Nothing here is built or decided; it is a scoring sheet for Todd.

## How to score this

Each spark below has four small tables, one per Lab variation. Each table has two columns: what
**FlavorGraph** suggested and what **Epicure** suggested. Read the two lists as "if I were cooking
this spark, which list would I rather pull partners from?"

For each table, write one of: **FG**, **Epicure**, **both**, **neither**. If you like, circle a
partner that surprised you in a good way, and cross out any that is plainly wrong. Ten to fifteen
minutes for the whole sheet is plenty; first instinct is what we want.

The four variations, as they were defined for the Lab:

| Variation | Meaning | FlavorGraph can? | Epicure can? |
|---|---|---|---|
| **Classic** | the partners cooks most often put with the spark | Yes | Yes |
| **Adventurous** | plausible but rarely used: partners of the spark's partners, not of the spark itself | Yes | Yes (its "bridges" and side clusters) |
| **Chemistry** | partners that share aroma molecules with the spark | Yes, for the 400 "hub" ingredients that have molecule data | **No** (the live model has no molecule data) |
| **Balanced** | partners that add a taste the spark lacks (sweet, sour, bitter, salt, umami, heat, richness) | **No** (no taste data; would need hand tags) | Partly (it has taste axes, but two of them are unreliable; see §Balanced notes) |

Where a source cannot do a variation the cell says so instead of inventing a list.

### How the lists were made (short version)

- **FlavorGraph**: downloaded the raw node/edge files from the FlavorGraph GitHub repo and ran a
  small Python script (`fg.py`, in the session scratchpad, not committed). *Classic* = the
  ingredients with the highest co-occurrence score (NPMI) with the spark, summed across the spark's
  ingredients. *Adventurous* = ingredients that are strongly linked to at least three of the
  spark's top-20 partners but have a weak or no direct link to the spark ("bridges"). *Chemistry* =
  hub ingredients whose set of flavour molecules overlaps most (cosine) with the spark's set.
  Names were de-duplicated (`fresh_dill`/`dill_sprig` collapsed) and non-ingredients (`cedar_plank`)
  dropped; a few leftovers were tidied by hand and are noted.
- **Epicure**: called the Epicure MCP tools in this workspace. *Classic* = the eight "primary"
  partners from `find_pairings`. *Adventurous* = the "bridge" and secondary ingredients that
  `find_pairings` returns beneath the primaries (things that connect several primaries, or sit in
  a side cluster). *Balanced* = read the spark's main ingredient on six taste axes with
  `compare_on_axis`, then picked partners (from its own pairing list where possible) that Epicure
  rates high on the tastes the spark reads low on. Sourness could not be read (see below).
- **Dish and mood sparks** were decomposed by hand: *chicken piccata* = chicken + lemon + capers
  (the defining trio; butter, white wine, parsley are the sauce). *Something cozy for a rainy
  evening* = potato + onion + butter + cream + thyme (a warm, slow, buttery one-pot base; both
  sources got the same five). *Roast cauliflower*, *corn on the cob*, *duck breast*, *beef short
  rib*, *pork shoulder* were reduced to their ingredient; where Epicure's vocabulary lacked the cut
  (it has no *pork shoulder*, *short rib* or *duck breast*) the parent ingredient (*pork*, *beef*,
  *duck*) was used and that is flagged in the section.

Scores in brackets are the source's own numbers and are only there so we can trace a claim back;
ignore them when scoring.

---

## 1. Salmon and dill

Seeds: FlavorGraph `salmon` + `dill`; Epicure `salmon`, `dill`.

**Classic**

| FlavorGraph | Epicure |
|---|---|
| caviar (0.46, both) | olive oil (0.35) |
| halibut (0.35, both) | tarragon (0.35) |
| shiso (salmon) | black pepper |
| grape leaves (dill) | mayonnaise |
| parsley root (dill) | paprika |
| nori (salmon) | parsley |
| pickling cucumber (dill) | feta cheese |
| smoked trout (dill) | red onion |

**Adventurous**

| FlavorGraph | Epicure |
|---|---|
| creme fraiche | white wine (links 6 of 8 primaries) |
| vinegar | horseradish |
| mustard seed | mustard |
| chives | pickled cucumber |
| sake | balsamic vinegar |
| lemon | arugula |
| parsley | rosemary |
| pickled ginger | shallot |

**Chemistry**

| FlavorGraph | Epicure |
|---|---|
| fennel (135 shared molecules) | not available |
| carom seed (ajwain) | |
| parsnip | |
| parsley | |
| star anise | |
| nutmeg | |
| summer savory | |
| lovage | |

Note: FlavorDB gives salmon only 6 molecules and dill 200, so this is really "what shares dill's
chemistry" (the anise/parsley/carrot family).

**Balanced**

| FlavorGraph | Epicure |
|---|---|
| not available (no taste data) | Salmon reads: sweet very low, bitter low, umami high, heat moderate, richness high, salt high. Gaps: **sweet, bitter**. From its own list: arugula (bitter). Off-list carriers it rates high: honey, orange, apple (sweet); walnut, endive (bitter). Sourness: cannot read. |

---

## 2. Chicken piccata

Decomposed to chicken + lemon + capers. FlavorGraph `chicken` + `lemon` + `caper`; Epicure
`chicken`, `lemon`, `caper`.

**Classic**

| FlavorGraph | Epicure |
|---|---|
| skate (0.57, lemon+caper) | olive oil (0.46) |
| anchovy (caper) | thyme |
| artichoke (lemon+caper) | red pepper |
| flat-leaf parsley (lemon+caper) | red onion |
| tuna in oil (lemon+caper) | black pepper |
| cornichons (caper) | garlic |
| swordfish (lemon+caper) | oregano |
| | paprika |

Note: in FlavorGraph, chicken is in so many recipes that its co-occurrence scores are tiny, so lemon
and capers drive this list (it reads like a Mediterranean fish counter). Epicure's list is
generic "roast chicken" seasoning.

**Adventurous**

| FlavorGraph | Epicure |
|---|---|
| romaine lettuce | parsley (links all 8 primaries) |
| white wine vinegar | tomato |
| green beans (haricots verts) | white wine |
| hard-boiled egg | black olives |
| mayonnaise | red wine vinegar |
| roasted red pepper | mint |
| Kalamata olives | rosemary |
| | coriander |

**Chemistry**

| FlavorGraph | Epicure |
|---|---|
| mandarin orange (160 shared) | not available |
| lime | |
| orange | |
| coriander | |
| cardamom | |
| winter savory | |
| summer savory | |
| fennel | |

Note: lemon's 193 molecules dominate (chicken has 131, capers 99), so this is a citrus/spice list.

**Balanced**

| FlavorGraph | Epicure |
|---|---|
| not available | Chicken reads: sweet very low, bitter low, umami high, heat moderate, richness high, salt high. (Lemon and capers were not read separately; Epicure cannot read sourness anyway.) Gaps: **sweet, bitter**. Nothing in its own list is rated high on either. Off-list: honey, orange (sweet); arugula, endive, walnut (bitter). |

---

## 3. Lamb and apricot

FlavorGraph `lamb` + `apricot`; Epicure `lamb`, `apricot`.

**Classic**

| FlavorGraph | Epicure |
|---|---|
| prunes (0.53, both) | black currant (0.42) |
| tzatziki (lamb) | pear |
| black cardamom (lamb) | almond |
| ghee (lamb) | cherry |
| plum (apricot) | hazelnut |
| nectarine (apricot) | walnut |
| cardamom seed (lamb) | cardamom |
| cherry (apricot) | pistachio |

**Adventurous**

| FlavorGraph | Epicure |
|---|---|
| cumin seed | orange (links 6 of 8) |
| coriander seed | candied fruit |
| ginger paste | raisins |
| cloves | figs |
| bay leaf | honey |
| ginger-garlic paste | yogurt |
| garam masala | mint |
| red chilli powder | saffron |

Note: FlavorGraph walks straight into a North Indian braise; Epicure stays in the fruit-and-nut
(Middle Eastern / Moroccan) register.

**Chemistry**

| FlavorGraph | Epicure |
|---|---|
| plum (152 shared) | not available |
| quince | |
| gooseberry | |
| figs | |
| peach | |
| olives | |
| mango | |
| wheat (see artefact note, §Summary) | |

**Balanced**

| FlavorGraph | Epicure |
|---|---|
| not available | Lamb reads: sweet low, everything else moderate. Apricot reads very high on sweet, so the pair is already balanced on Epicure's terms. Umami/salt/richness are only moderate: from its list, yogurt and pistachio (not rated); off-list carriers it rates high: feta, parmesan (salt and umami), butter (richness). Sourness: cannot read. |

---

## 4. Pork shoulder

FlavorGraph `pork_shoulder` (chemistry via the `pork` hub). Epicure has no "pork shoulder", so
`pork` was used.

**Classic**

| FlavorGraph | Epicure (for *pork*) |
|---|---|
| hominy (0.35) | shiitake mushroom (0.40) |
| guajillo chiles | ginger |
| achiote paste | Shaoxing wine |
| garlic sausage | wood ear mushroom |
| veal shoulder | scallion (spring onion) |
| Dr Pepper (cola) | lotus root |
| sausage casings (x2, noise: the graph knows pork shoulder is what you make sausage from) | oyster sauce |
| | cooking oil |

Note: FlavorGraph goes to Mexican braises (pozole, carnitas). Epicure's corpus is about half
East Asian, and for pork it goes straight to a Chinese red-braise.

**Adventurous**

| FlavorGraph | Epicure |
|---|---|
| liquid smoke | soy sauce (light and dark) |
| bay leaf | tofu |
| white pepper | sesame oil |
| white onion | MSG |
| lime | leek |
| cumin | lard |
| ancho chiles | garlic |
| corn tortillas | chilli pepper, coriander |

**Chemistry**

| FlavorGraph (via `pork`, 157 molecules) | Epicure |
|---|---|
| chicken (69 shared) | not available |
| butter | |
| coffee | |
| beer | |
| beef | |
| milk | |
| peanut | |
| hazelnut | |

Note: cooked-meat chemistry is roasty/Maillard, so coffee, beer and nuts are real signals, not noise.

**Balanced**

| FlavorGraph | Epicure |
|---|---|
| not available | Pork reads: sweet very low, bitter moderate, umami moderate, heat high, richness low, salt low. Gaps: **sweet, richness, salt**. Its own list has lard and oyster sauce (not rated on those axes). Off-list carriers it rates high: apple, maple syrup, honey (sweet); butter, bacon (richness and salt); parmesan, olives (salt). |

---

## 5. Roast cauliflower

FlavorGraph `cauliflower`; Epicure `cauliflower`.

**Classic**

| FlavorGraph | Epicure |
|---|---|
| broccoli (0.41) | eggplant (0.32) |
| pickling onions | onion |
| French beans | chickpeas |
| turmeric | spinach |
| pickled onions | broccoli |
| mature cheddar | potato |
| brown mustard seed | artichoke |
| garam masala | cayenne pepper |

**Adventurous**

| FlavorGraph | Epicure |
|---|---|
| red lentils | carrot (links 5 of 8) |
| curry leaves | parsley |
| asafoetida | garlic |
| red chilli powder | zucchini |
| ghee | tomato |
| coriander leaf | peas |
| fenugreek seed | lentils |
| urad dal | prosciutto, pesto, Romano cheese (artichoke side cluster) |

**Chemistry**

| FlavorGraph | Epicure |
|---|---|
| broccoli (117 shared) | not available |
| Brussels sprouts | |
| then: pistachio, cashew, lentil, zucchini, chickpea, chestnut (all the "generic set" artefact, see §Summary) | |

**Balanced**

| FlavorGraph | Epicure |
|---|---|
| not available | Cauliflower reads: sweet very low, bitter high, umami high, heat low, richness high, salt high. Gaps: **sweet, heat**. From its list: garlic (heat, rated high); cayenne pepper is in its list but Epicure oddly rates cayenne *low* on heat. Off-list: chilli pepper, ginger (heat); raisins, apple (sweet). Its "richness high, salt high" for a raw vegetable is implausible; the axis tracks what it is cooked with. |

---

## 6. Mushrooms and thyme

FlavorGraph `mushroom` + `thyme`; Epicure `mushroom`, `thyme`.

**Classic**

| FlavorGraph | Epicure |
|---|---|
| rosemary (thyme) | parsley (0.49) |
| marjoram (thyme) | olive oil |
| sage (thyme) | rosemary |
| red wine (0.43, both) | oregano |
| Sauternes (both) | parmesan |
| red Burgundy (both) | black pepper |
| brown sauce (both) | basil |
| bay leaf (thyme) | white wine |

**Adventurous**

| FlavorGraph | Epicure |
|---|---|
| celery | red pepper (links all 8) |
| tomato paste | paprika |
| carrot | tomato |
| veal | red wine |
| parsley | cayenne pepper |
| whole chicken | sage |
| celeriac | sherry |
| | olives, pasta, bread |

**Chemistry**

| FlavorGraph | Epicure |
|---|---|
| lima beans (141 shared) | not available |
| beans / green beans | |
| turmeric | |
| coriander | |
| cardamom | |
| pecan | |
| summer savory | |

**Balanced**

| FlavorGraph | Epicure |
|---|---|
| not available | Mushroom reads: sweet very low, bitter very low, umami very high, heat moderate, richness high, salt high. Gaps: **sweet, bitter**. Nothing in its list is rated high on either (sherry and red wine are not rated). Off-list: pear, apple, honey (sweet); walnut, endive, arugula (bitter). |

---

## 7. Shrimp and garlic

FlavorGraph `shrimp` + `garlic`; Epicure `shrimp`, `garlic`.

**Classic**

| FlavorGraph | Epicure |
|---|---|
| andouille sausage (0.52, both) | black pepper (0.50) |
| seafood stock (both) | coriander (cilantro) |
| tasso ham (both) | cooking oil |
| crab boil (both) | salt |
| crawfish (both) | tomato |
| Creole seasoning (both) | shallot |
| mirliton / chayote (both) | onion |
| crab legs (both) | scallion |

Note: FlavorGraph lands squarely in New Orleans. Epicure's list is a generic stir-fry base.

**Adventurous**

| FlavorGraph | Epicure |
|---|---|
| oysters | chilli pepper (links 6 of 8) |
| dry white wine | bell pepper |
| saffron | bay leaf |
| crabmeat | MSG |
| bay leaf | ginger |
| cayenne | cumin |
| green bell pepper | bird's eye chilli |
| | white pepper, fish sauce, oregano |

**Chemistry**

| FlavorGraph | Epicure |
|---|---|
| chives (115 shared) | not available |
| leek | |
| shallot | |
| sweet potato | |
| endive | |
| mung bean | |
| chayote | |
| dates | |

Note: garlic's 143 molecules dominate (shrimp 76), so the top of the list is the onion family.

**Balanced**

| FlavorGraph | Epicure |
|---|---|
| not available | Shrimp reads: sweet very low, bitter low, umami moderate, heat high, richness low, salt moderate. Gaps: **sweet, richness**, umami/salt only moderate. From its list: tomato (umami high, salt very high). Fish sauce is in its list but Epicure rates it *low* on both umami and salt (a Western-tag bias, see §Summary). Off-list: butter, olive oil (richness); honey, orange (sweet). |

---

## 8. Beef short rib

FlavorGraph `beef_short_rib` (chemistry via `beef`). Epicure has no "short rib", so `beef` was used.

**Classic**

| FlavorGraph | Epicure (for *beef*) |
|---|---|
| red wine: Zinfandel, Cabernet, dry red (0.37) | onion (0.36) |
| Asian pear | black pepper |
| veal stock | oregano |
| dark beer | tomato |
| dried ancho chile | bay leaf |
| thyme | red onion |
| | garlic |
| | potato |

Note: FlavorGraph knows short rib specifically (Asian pear is the Korean galbi marinade; wine and
stock the French braise). Epicure only knows "beef" and gives a stew base.

**Adventurous**

| FlavorGraph | Epicure |
|---|---|
| oxtail | parsley (links 7 of 8) |
| lamb shank | bell pepper |
| pearl onions | cumin |
| juniper berries | olive oil |
| black peppercorns | paprika |
| chuck roast | shallot |
| venison | red wine vinegar |
| veal shank | carrot, cabbage, beans |

**Chemistry**

| FlavorGraph (via `beef`, 92 molecules) | Epicure |
|---|---|
| chicken (53 shared) | not available |
| pork | |
| cheddar | |
| milk | |
| butter | |
| beer | |
| egg | |
| blue cheese | |

**Balanced**

| FlavorGraph | Epicure |
|---|---|
| not available | Beef reads: sweet very low, bitter very low, umami very high, heat high, richness high, salt high. Gaps: **sweet, bitter**. Nothing in its list is rated high on either. Off-list carriers it rates very high on sweet: **pear** (FlavorGraph independently found Asian pear as a classic short-rib partner), apple, honey; walnut, endive (bitter). |

---

## 9. Tomatoes and basil

FlavorGraph `tomato` + `basil`; Epicure `tomato`, `basil`.

**Classic**

| FlavorGraph | Epicure |
|---|---|
| oregano (0.52, basil) | olive oil (0.53) |
| eggplant (0.43, both) | oregano |
| runner beans (both) | parsley |
| thyme (basil) | onion |
| lettuce (tomato) | garlic |
| Italian green beans (both) | red onion |
| sweet bell pepper (both) | black pepper |
| marjoram (basil) | bell pepper |

**Adventurous**

| FlavorGraph | Epicure |
|---|---|
| ground beef | paprika (links 7 of 8) |
| ricotta | red pepper |
| mozzarella | bay leaf |
| spinach | thyme |
| Italian seasoning | cayenne pepper |
| lasagne sheets | cumin |
| (also "spaghetti sauce", "pasta sauce": noise, products not ingredients) | bacon, parmesan, white wine |

Note: FlavorGraph's bridges are a lasagne; both sources stay Italian.

**Chemistry**

| FlavorGraph | Epicure |
|---|---|
| oregano (167 shared) | not available |
| carrot | |
| marjoram | |
| black currant | |
| nutmeg | |
| rosemary | |
| ginger | |
| winter savory | |

**Balanced**

| FlavorGraph | Epicure |
|---|---|
| not available | Tomato reads: sweet low, bitter moderate, umami high, heat low, richness high, salt very high. Gaps: **sweet, heat**. From its list: garlic (heat high); cayenne is in the list but Epicure rates it low on heat. Off-list: chilli pepper, ginger (heat); honey, orange (sweet). "Salt very high" for a raw tomato is the cooked-with bias again. |

---

## 10. Eggplant

FlavorGraph `eggplant`; Epicure `eggplant`.

**Classic**

| FlavorGraph | Epicure |
|---|---|
| zucchini (0.35) | zucchini (0.32) |
| yellow squash | cauliflower |
| caponata | tomato |
| tahini | spinach |
| marinara sauce | black pepper |
| ricotta salata | mint |
| ground lamb | fennel |
| fresh mozzarella | daikon |

**Adventurous**

| FlavorGraph | Epicure |
|---|---|
| cherry tomatoes | olive oil (links 6 of 8) |
| balsamic vinegar | onion |
| extra-virgin olive oil | garlic |
| pine nuts | carrot |
| Parmigiano-Reggiano | chickpeas |
| basil | feta, bread crumbs, rosemary |
| | lemon, pomegranate (mint side cluster) |
| | ginger, shiitake, mirin (daikon side cluster) |

**Chemistry**

| FlavorGraph | Epicure |
|---|---|
| zucchini, green and yellow (105 shared) | not available |
| then: pistachio, chickpea, cashew, lentil, chestnut, wheat (generic-set artefact) | |

**Balanced**

| FlavorGraph | Epicure |
|---|---|
| not available | Eggplant reads flat: sweet low, everything else moderate. Gaps: **sweet**, and umami/salt/richness are only moderate. From its own list: tomato (umami high, salt very high), feta (salt and richness very high), olive oil (richness very high), garlic (heat high); pomegranate (sweet, not rated). This is the spark where Epicure's balanced list looks most like a real dish. Sourness (lemon, pomegranate): cannot read. |

---

## 11. Sweet potato

FlavorGraph `sweet_potato`; Epicure `sweet potato`.

**Classic**

| FlavorGraph | Epicure |
|---|---|
| parsnip (0.30) | glutinous rice (0.30) |
| coconut milk | glutinous rice flour |
| cane syrup | red bean paste |
| white potato | yam |
| turnip | butterfly pea flower |
| purple potato | rice |
| mild curry paste | cabbage |
| yuca | brown sugar |

Note: Epicure goes to East Asian desserts (mochi, red bean); FlavorGraph to roast roots and curry.

**Adventurous**

| FlavorGraph | Epicure |
|---|---|
| leek | taro |
| red lentils | black sesame |
| acorn squash | meat floss |
| pearl barley | maple syrup |
| tempeh | oats |
| chickpeas | apple |
| mild curry powder | cranberry |
| | coconut oil, matcha |

**Chemistry**

| FlavorGraph | Epicure |
|---|---|
| **unusable**: FlavorDB gives sweet potato a generic set of 104 molecules that is shared almost identically by chayote, breakfast cereal, millet, bamboo shoot, biscuit, pasta and kale. | not available |

**Balanced**

| FlavorGraph | Epicure |
|---|---|
| not available | Sweet potato reads: sweet moderate, bitter high, umami low, heat low, richness moderate, salt low. Gaps: **umami, heat, salt**. Nothing in its own list is rated (meat floss, salted duck egg would qualify in a cook's view but Epicure has no reading). Off-list carriers it rates high: bacon, parmesan (umami and salt), chilli pepper, ginger (heat). FlavorGraph's curry paste / coconut milk route covers heat and richness by co-occurrence alone. |

---

## 12. Scallops

FlavorGraph `scallop`; Epicure `scallop`.

**Classic**

| FlavorGraph | Epicure |
|---|---|
| crab legs (0.44) | snow peas (0.34) |
| shrimp | king oyster mushroom |
| mussels | shimeji (crab) mushroom |
| clams | broth |
| squid | matsutake mushroom |
| fish stock | nameko mushroom |
| haddock | soy sauce |
| | white pepper |

Note: FlavorGraph = a seafood platter; Epicure = a Japanese/Chinese mushroom hot-pot.

**Adventurous**

| FlavorGraph | Epicure |
|---|---|
| dry white wine | bok choy (links 4 of 8) |
| lemon | enoki mushroom |
| linguine | sesame oil |
| cockles | fried tofu puff |
| fish bones (stock) | udon |
| Dungeness crab | choy sum |
| | ginger, scallion, bonito flakes, bamboo shoot |

**Chemistry**

| FlavorGraph (41 molecules) | Epicure |
|---|---|
| shrimp (24 shared) | not available |
| clams | |
| "meat" (generic node) | |
| cheese, Camembert, Roquefort | |
| squid | |
| crab | |

Note: the cheese hits are real (scallops and aged cheese share sulphur/butter molecules) but the
set is small.

**Balanced**

| FlavorGraph | Epicure |
|---|---|
| not available | Scallop reads: sweet very low, bitter low, umami moderate, heat high, richness low, salt high. Gaps: **sweet, richness, bitter**. Nothing in its list is rated on sweet; sesame oil is in the list but Epicure rates it *very low* on fat (wrong). Off-list: butter, cream (richness); orange, apple (sweet). FlavorGraph's white wine and lemon add brightness, which Epicure cannot assess. |

---

## 13. Duck breast

FlavorGraph `duck_breast`. Epicure has no "duck breast", so `duck` was used.

**Classic**

| FlavorGraph | Epicure (for *duck*) |
|---|---|
| foie gras (0.41) | dried tangerine peel (0.36) |
| kumquat | rice wine |
| endive | taro |
| port | daikon |
| pomegranate molasses | cordyceps flower |
| star anise | ginger |
| dark soy sauce | lion's mane mushroom |
| | tofu skin |

Note: FlavorGraph gives the bistro duck breast (port, endive, citrus) with a nod to Chinese
braising. Epicure gives a Cantonese tonic soup.

**Adventurous**

| FlavorGraph | Epicure |
|---|---|
| veal stock | Shaoxing wine (links 5 of 8) |
| Thai basil | shimeji mushroom |
| Shaoxing wine | tea tree mushroom |
| frisee | shiitake |
| quail | winter melon |
| Bosc pear | angelica root |
| galangal | five spice, rock sugar, monk fruit |
| Sichuan peppercorn | bird's eye chilli |

**Chemistry**

| FlavorGraph | Epicure |
|---|---|
| **not available**: duck has no molecule data in FlavorGraph (not a hub). Chicken would be a poor stand-in. | not available |

**Balanced**

| FlavorGraph | Epicure |
|---|---|
| not available | Duck reads: sweet low, bitter high, umami moderate, heat high, richness **very low** (plainly wrong for duck), salt low. Gaps by its own reading: sweet, salt, richness. From its list: rock sugar, monk fruit (sweet, not rated). Off-list: orange, apricot (sweet; also the classic duck partners), bacon, olives (salt). |

---

## 14. Chickpeas

FlavorGraph `chickpea`; Epicure `chickpea`.

**Classic**

| FlavorGraph | Epicure |
|---|---|
| tahini (0.50) | lentils (0.40) |
| couscous | quinoa |
| harissa | squash |
| Moroccan seasoning | tomato |
| pita | tahini |
| ground coriander | nutritional yeast |
| | chorizo |
| | fava beans |

**Adventurous**

| FlavorGraph | Epicure |
|---|---|
| cucumber | olive oil (links 4 of 8) |
| red lentils | brown rice |
| hot chilli powder | kale |
| cayenne | goat cheese |
| coriander | sherry vinegar |
| ground lamb | spinach, arugula, yogurt |
| fresh mint | cumin, curry, fenugreek, paprika, parsnip |

**Chemistry**

| FlavorGraph | Epicure |
|---|---|
| **unusable**: lentil, pistachio, cashew, zucchini, chestnut, hazelnut, wheat all score 0.96 to 0.99 because FlavorDB gave eleven unrelated plant foods the same generic set of ~100 molecules. | not available |

**Balanced**

| FlavorGraph | Epicure |
|---|---|
| not available | Chickpea reads: sweet moderate, bitter very high, umami low, heat very low, richness very high (implausible), salt moderate. Gaps: **umami, heat**. From its list: tomato (umami high), chorizo and goat cheese (not rated but obviously qualify), paprika (heat, rated only moderate). Off-list: chilli pepper, ginger (heat). FlavorGraph's harissa / chilli powder / cayenne cover heat by co-occurrence. |

---

## 15. Corn on the cob

FlavorGraph `corn`; Epicure `corn`.

**Classic**

| FlavorGraph | Epicure |
|---|---|
| black beans (0.40) | lettuce (0.35) |
| taco seasoning | chicken |
| lima beans | carrot |
| cotija cheese | bell pepper |
| peas | tomato |
| crawfish | chicken broth |
| crab boil | coriander (cilantro) |
| yuca | shrimp |

Note: FlavorGraph = Tex-Mex plus a Louisiana boil (elote, succotash). Epicure = a generic
salad/soup.

**Adventurous**

| FlavorGraph | Epicure |
|---|---|
| canned tomatoes with green chiles (Ro-Tel) | black pepper (links 7 of 8) |
| chilli powder | garlic |
| black-eyed peas | onion |
| ground beef | shiitake |
| Mexican cheese blend | scallion |
| enchilada sauce | avocado, cabbage, ham, cucumber |
| ground turkey | chilli powder, cumin, oregano |
| (Velveeta: dropped) | |

**Chemistry**

| FlavorGraph | Epicure |
|---|---|
| wheat, Brazil nut, figs, cashew, zucchini, pistachio, walnut: mostly the generic-set artefact, though corn has 200 molecules of its own so the nut hits (roasty, sweet) are partly real. | not available |

**Balanced**

| FlavorGraph | Epicure |
|---|---|
| not available | Corn reads: sweet low (odd), bitter/umami/heat/richness moderate, salt high. Gaps: **sweet, richness, umami**. From its list: tomato (umami high, salt very high), shrimp and ham (not rated). Off-list: **butter** (richness very high; the obvious partner Epicure's pairing list missed), chilli, ginger (heat). |

---

## 16. Cod

FlavorGraph `cod` (not a hub); Epicure `cod`.

**Classic**

| FlavorGraph | Epicure |
|---|---|
| tartar sauce (0.39) | chilli garlic sauce (0.30) |
| fish stock | hot-pot base |
| mussels | barbecue seasoning |
| malt vinegar | shimeji mushroom |
| saffron | dumplings |
| seafood seasoning | radish |
| scallops | chervil |
| Old Bay | white wine vinegar |

Note: FlavorGraph = fish and chips plus a bouillabaisse. Epicure's top cluster is Chinese hot-pot;
only the small chervil / white-wine-vinegar cluster is the French cod a Western cook expects.

**Adventurous**

| FlavorGraph | Epicure |
|---|---|
| lobster | garlic scapes (links 5 of 8) |
| halibut | udon |
| squid | yu choy, wood ear, tofu skin |
| red snapper | arugula |
| shrimp | sherry vinegar |
| crab | asparagus, tarragon, fish stock, fennel |
| | celtuce |

**Chemistry**

| FlavorGraph | Epicure |
|---|---|
| **not available**: cod has no molecule data in FlavorGraph; the generic `fish` hub has only 47. | not available |

**Balanced**

| FlavorGraph | Epicure |
|---|---|
| not available | Cod reads: sweet very low, bitter/umami/heat/richness moderate, salt high. Gaps: **sweet, richness**. Nothing in its list is rated on either. Off-list: butter, olive oil (richness), honey, orange (sweet). Brightness (malt vinegar, lemon, white wine vinegar): cannot read. |

---

## 17. Pears

FlavorGraph `pear`; Epicure `pear`.

**Classic**

| FlavorGraph | Epicure |
|---|---|
| Stilton (0.30) | apple (0.42) |
| grapes | apricot |
| Sauternes | raspberry |
| Gorgonzola | peach |
| Roquefort | almond |
| apple | dates |
| butter | ginger ale |
| blue cheese | figs |

Note: FlavorGraph = the cheese board; Epicure = the fruit bowl. Neither is wrong; they answer
different questions.

**Adventurous**

| FlavorGraph | Epicure |
|---|---|
| walnut oil | honey (links 4 of 8) |
| arugula | cherry |
| cantaloupe | orange |
| Belgian endive | walnut |
| honeydew melon | strawberry |
| kiwi | cinnamon |
| ruby port | black currant, candied fruit |
| pineapple | maple syrup, nectarine, liqueur |

**Chemistry**

| FlavorGraph | Epicure |
|---|---|
| mostly the generic-set artefact (pistachio, cashew, lentil, zucchini, chickpea, chestnut, wheat); **hazelnut** is the one plausible hit. | not available |

**Balanced**

| FlavorGraph | Epicure |
|---|---|
| not available | Pear reads: sweet very high, bitter high, umami low, heat low, richness low, salt very low. Gaps: **umami, salt, richness, heat**. From its list: walnut, almond (richness high). Off-list carriers it rates very high on salt and umami: parmesan, feta, blue cheese, bacon (which is exactly FlavorGraph's classic list); ginger (heat very high; Epicure's own list has ginger ale). |

---

## 18. Dark chocolate

FlavorGraph `dark_chocolate` (chemistry via the `cocoa` hub, 294 molecules; the `chocolate` hub has
only 13 and gives junk). Epicure resolved "dark chocolate" to `chocolate`.

**Classic**

| FlavorGraph | Epicure (for *chocolate*) |
|---|---|
| double / thickened cream (0.39) | cocoa powder (0.56) |
| caster sugar | vanilla |
| hazelnut (meal, butter) | coffee |
| praline paste | cacao |
| sponge fingers | baking powder |
| Copha (coconut shortening) | almond |
| | gelatin |
| | raspberry |

Note: FlavorGraph's `dark_chocolate` node is clearly built from Australian/UK recipes (caster
sugar, Copha, thickened cream). Epicure's list is a generic baking aisle.

**Adventurous**

| FlavorGraph | Epicure |
|---|---|
| sultanas | strawberry (links 5 of 8) |
| soft brown sugar | ice cream |
| black treacle | milk |
| shortcrust pastry | graham cracker |
| passion fruit | coffee liqueur |
| (bicarbonate of soda, cornflour: dropped) | cherry, hazelnut, orange |
| | peppermint, cocoa butter, blueberry |

**Chemistry**

| FlavorGraph (via `cocoa`) | Epicure |
|---|---|
| peanut (156 shared) | not available |
| pecan | |
| beans / green beans | |
| soybean | |
| bread | |
| sesame | |
| barley | |

Note: all roasted/toasted things; this is the Maillard signature and is a genuinely useful
"chocolate goes with roasted nuts, seeds and malt" answer.

**Balanced**

| FlavorGraph | Epicure |
|---|---|
| not available | Chocolate reads: sweet high, bitter high, umami low, heat low, richness high, salt very low. Gaps: **salt, heat, umami**. Nothing in its list is rated on those. Off-list carriers it rates high: chilli pepper, ginger (heat, both classic with chocolate); salt itself is in Epicure's vocabulary but has no taste reading. |

---

## 19. Strawberries

FlavorGraph `strawberry`; Epicure `strawberry`.

**Classic**

| FlavorGraph | Epicure |
|---|---|
| blueberries (0.40) | raspberry (0.48) |
| kiwi | ice cream |
| raspberries | gelatin |
| blackberries | peach |
| rhubarb | vanilla |
| shortcake | cream |
| angel food cake | banana |
| | blueberry |

**Adventurous**

| FlavorGraph | Epicure |
|---|---|
| nectarine | rum (links 7 of 8) |
| whipped cream | cocoa powder |
| plum | white chocolate |
| papaya | blackberry |
| red grapes | orange |
| (berry, Cool Whip: dropped) | almond, cherry |
| | cookie, butter, pineapple, marshmallow |

**Chemistry**

| FlavorGraph | Epicure |
|---|---|
| apple (188 shared) | not available |
| pineapple | |
| plum | |
| gooseberry | |
| apricot | |
| banana | |
| peach | |
| cranberry | |

Note: strawberry has 257 molecules, so this list is real fruit-ester chemistry, not the artefact.

**Balanced**

| FlavorGraph | Epicure |
|---|---|
| not available | Strawberry reads: sweet very high, bitter high, umami low, heat low, richness low, salt very low. Gaps: **richness, salt, heat**. From its list: cream, butter, almond (richness). Off-list: black pepper (heat, rated moderate; the classic pairing), feta or parmesan (salt). Balsamic vinegar is the cook's answer and Epicure cannot rate it. |

---

## 20. Something cozy for a rainy evening

Decomposed to potato + onion + butter + cream + thyme. Both sources got all five.

**Classic**

| FlavorGraph | Epicure |
|---|---|
| stewing beef (0.67, potato+onion+thyme) | parsley (0.56) |
| clams (0.67, four of five seeds) | paprika |
| bay leaf | white wine |
| carrot | olive oil |
| swede / rutabaga | black pepper |
| celery | oregano |
| smoked streaky bacon | cayenne pepper |
| | cheese |

Note: FlavorGraph reads the five seeds as a beef stew or a clam chowder, which is a fair reading of
"cozy". Epicure reads them as a seasoning rack.

**Adventurous**

| FlavorGraph | Epicure |
|---|---|
| cannellini beans | bacon (links all 8) |
| split peas | bay leaf |
| parsley | lemon |
| parmesan rind | tomato |
| browning sauce (Kitchen Bouquet) | parmesan |
| pork fat / lardo | nutmeg |
| (cocoa, dark chocolate: noise, via "sweet biscuit") | sage |
| | red pepper |

**Chemistry**

| FlavorGraph | Epicure |
|---|---|
| With five seeds the union is 442 molecules and the answer is "everything" (tea, tomato, green beans, soybean, mango, pecan, peanut, mushroom). Not useful for a mood spark. | not available |

**Balanced**

| FlavorGraph | Epicure |
|---|---|
| not available | Potato (the main seed) reads: sweet low, bitter moderate, umami high, heat moderate, richness high, salt high; butter and cream cover richness in any case. Gaps: **sweet**, and brightness (which Epicure cannot read). From its list: lemon (a cook's brightness answer; Epicure gives no reading), carrot and onion (sweet by cooking, not rated). Off-list: apple (sweet very high). |

---

## Summary: what each source could and could not do

### Coverage of the four variations

| | FlavorGraph | Epicure |
|---|---|---|
| Classic | 20 of 20 sparks | 20 of 20, but three sparks fell back to a parent ingredient (pork shoulder to pork, short rib to beef, duck breast to duck) and one to a sibling (dark chocolate to chocolate) |
| Adventurous | 20 of 20 | 20 of 20 |
| Chemistry | 14 of 20 usable; 2 not possible (duck, cod: no molecule data); 4 unusable because of the FlavorDB "generic set" artefact (sweet potato, chickpea, pear, and mostly cauliflower, eggplant, corn) | 0 of 20: the live model has no molecule data |
| Balanced | 0 of 20: no taste data | 20 of 20 readings, but see reliability below |

### What FlavorGraph did well and badly

- **Specific cuts and named dishes** (short rib to Asian pear and Zinfandel; pork shoulder to
  hominy and guajillo; duck breast to port and kumquat; shrimp and garlic to andouille and crab
  boil). Its 6,650-name vocabulary is noisy but it *knows* short rib is not just beef.
- **Adventurous bridges are the strongest thing it produced**: creme fraiche and sake for salmon;
  cumin and coriander seed for lamb-apricot; oysters, saffron and white wine for shrimp; walnut oil
  and endive for pears. These read like a cook's second thought.
- **Chemistry is half real, half artefact.** Where the spark has its own rich molecule set
  (strawberry, dill, lemon, cocoa, tomato, garlic) the answers are interesting (cocoa to peanut,
  pecan and barley; strawberry to apple, pineapple and apricot). But FlavorDB gave eleven
  unrelated plant foods (chickpea, lentil, pistachio, cashew, chestnut, hazelnut, wheat, zucchini,
  macadamia, Brazil nut) the *same* generic set of about 100 molecules, so any spark that overlaps
  that set gets those eleven back at the top. This is detectable and can be filtered out.
- **Bias**: Recipe1M is mostly English-language US and UK/Australian sites (caster sugar, Copha,
  Dr Pepper). Noisy names need a canonical-name pass before any UI shows them.

### What Epicure did well and badly

- **Clean names and clusters.** Everything comes back in plain words, grouped, with bridges
  labelled. No cleanup needed.
- **Strong East Asian pull.** The model's corpus is "roughly half East Asian and a tenth
  Mediterranean" (its own model card). For pork, scallops, duck, cod and sweet potato the top
  cluster was Chinese or Japanese (Shaoxing wine, hot-pot base, glutinous rice, tonic-soup herbs).
  For a Western cook those lists are less useful than FlavorGraph's, unless the Lab lets the user
  steer by cuisine (Epicure has cuisine axes and a `morph` tool that could do that).
- **Generic seasoning-rack answers for common proteins.** Chicken, beef, shrimp, mushrooms and
  tomatoes all came back with olive oil / black pepper / parsley / onion / garlic near the top.
  Correct but not inspiring.
- **Vocabulary gaps for cuts.** No pork shoulder, short rib or duck breast; 1,790 names total.
- **Taste axes: mixed reliability.** I checked each axis against ingredients a cook would call
  archetypal before using it:

| Axis (Epicure name) | Archetypes read correctly | Archetypes read wrongly | Verdict |
|---|---|---|---|
| sweet (`cf_sweet`) | honey, apple, maple, orange, pear, apricot, raisin all high or very high; meat and fish very low | none found | reliable |
| heat (`cf_spicy`) | chilli, ginger very high; garlic high | mustard very low; horseradish, cayenne low; black pepper moderate | reads chilli/ginger/garlic pungency only |
| umami (`cf_savory`) | parmesan, bacon, mushroom very high; tomato, anchovy high | soy sauce, fish sauce, MSG, oyster sauce, shiitake all *low* | Western umami only |
| bitter (`cf_bitter`) | endive, walnut very high; radicchio, kale, arugula, chocolate high | coffee, grapefruit, cocoa only moderate; beer very low | usable with care |
| richness (`usda_total_fat_g`) | butter, olive oil, mayo, feta, bacon very high; cream, nuts high | sesame oil very low; duck very low; chickpea very high | mostly reliable for Western pantry |
| salt (`usda_sodium_mg`) | feta, parmesan, olives, anchovy, bacon very high; capers high | soy sauce moderate, fish sauce low | Western salt only |
| sour (`cf_sour`) | (none) | lemon and lime *very low*, tamarind low, vinegars only moderate, salmon "high" | **unusable** |

  The taste axes are directions learned from recipe co-occurrence plus Western sensory tags
  ("Cooks Foundry" tags), not measurements, so they read "what this is usually cooked with"
  rather than "what this tastes like" (a raw tomato reads *very high* on salt). For the Lab's
  Balanced variation that means: Epicure can seed sweet/heat/richness/salt/umami tags for a
  Western pantry, but **brightness (sour) must be hand-tagged**, and every reading should be
  correctable by Todd. This confirms the JUL-25 recommendation (hand-tag, seeded from data).

### Where the two agree

Both sources converge on: rosemary/sage/marjoram for mushrooms and thyme; oregano and eggplant for
tomato-basil; zucchini for eggplant; blueberries/raspberries for strawberries; apple for pears;
tahini and coriander for chickpeas; almond/hazelnut/walnut/cardamom for lamb-apricot; pear as a
sweet partner for beef. Where they disagree the cause is almost always corpus (US/UK vs East
Asian) or vocabulary (cut vs parent ingredient), not "one is wrong".

## Epicure terms of use and export

**Terms.** The public MCP server (`https://epicure-mcp.kaikaku.ai/mcp`, no key, read-only) ships
a `TERMS.md` in its GitHub repo. The operative sentences: you "agree to use it lawfully and not
attempt to disrupt, overload, reverse engineer protected infrastructure, or circumvent security
and rate limits"; "KAIKAKU.AI Limited may change, rate-limit, suspend, or discontinue the public
service"; results are provided "as is" with no warranty and are not food-safety, allergen, medical
or nutritional advice; KAIKAKU is "not liable for indirect, incidental, special, consequential, or
lost-profit damages". Nothing in the terms restricts commercial or personal use or requires
attribution for MCP results. Rate limit defaults in the server code are 60 requests per minute
with a burst of 10. The server code itself is MIT licensed. The privacy policy says there are no
accounts, tool arguments are never logged, and telemetry is a daily-rotating pseudonymous IP hash
kept in a 2 x 2 MiB rolling log. The website's own pages (`/agents`, `/privacy`) add nothing beyond
this; I found no separate terms page on the site.

**Export: yes.** The exact model behind the MCP (`"model": "cooc"` in every tool response) is
published on Hugging Face as `Kaikaku/epicure-cooc` under **CC BY 4.0** (the model card's
`license: cc-by-4.0` field and a `LICENSE` file). It contains `embeddings.safetensors` (1,790 x
300 float32, about 2.1 MB), `vocab.json`, the mode atlas, the factor poles and the
`supervised_poles.json` that `compare_on_axis` uses, plus a `epicure.py` loader. Two sibling
models (`epicure-core`, blended with chemistry, and `epicure-chem`, chemistry only) and a
`epicure-corpus-resources` dataset sit next to it. CC BY 4.0 permits offline bundling in Julia,
commercial or not, with attribution. The model card also states the corpus imbalance quoted above
and that only 523 of the 1,790 ingredients are chemistry hubs (relevant only to the core/chem
siblings). The May 2026 write-ups saying "weights not released" predate the Hugging Face release
and are out of date.

So the earlier open question in JUL-25 ("online-only unless Kaikaku allows exporting vectors") is
closed: Epicure's vectors can be bundled offline on the same footing as FlavorGraph's, with a
cleaner licence (CC BY 4.0 vs Apache 2.0 plus the FlavorDB non-commercial caveat on the molecule
edges).

## Sources

- FlavorGraph raw data: https://raw.githubusercontent.com/lamypark/FlavorGraph/master/input/nodes_191120.csv and `edges_191120.csv` (downloaded 2026-09-15; 6,651 ingredient nodes, 111,355 ingredient-ingredient edges, 35,440 ingredient-molecule edges; 400 hubs with molecule data, median 94 molecules).
- FlavorGraph background and licences: `docs/research/flavorgraph-flavor-equation.md` (branch `research/flavorgraph-flavor-equation`).
- Epicure MCP tools called in this workspace: `find_pairings`, `compare_on_axis`, `list_targets`, `list_factors`, `flavour_correlations` (all responses report `model: cooc`).
- Epicure MCP server repo and terms: https://github.com/KAIKAKU-AI/epicure-mcp (MIT), `TERMS.md`, `PRIVACY.md`.
- Epicure site: https://epicure.kaikaku.ai/ , `/agents`, `/privacy`.
- Epicure model on Hugging Face: https://huggingface.co/Kaikaku/epicure-cooc (CC BY 4.0; README fetched 2026-09-15). Siblings: `Kaikaku/epicure-core`, `Kaikaku/epicure-chem`; dataset `Kaikaku/epicure-corpus-resources`.
- Epicure paper: Radzikowski and Chen, *Epicure: Navigating the Emergent Geometry of Food Ingredient Embeddings*, arXiv 2605.22391 (May 2026, CC BY 4.0).
