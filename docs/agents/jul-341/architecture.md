# Recipe display architecture

The library and detail routes currently read household text recipes through `HouseholdGate`. Mounting that gate can move a browser's old recipes into Firestore. A synthetic preview must choose its data before mounting the gate, not replace results after sign-in.

## Chosen shape

Both pages use one read-only display model. A server boundary selects either a synthetic preview provider or the existing household gate. Production always selects household access. A recipe distinguishes structured linked ingredients and steps from existing written text. Quantities in the full list and in step portions derive from the same immutable base ingredients.

Existing storage, save-once IDs, migration, and membership rules stay unchanged. Unknown household metadata remains unknown. Preview fixtures do not claim to enrich household recipes. Recipe reading position and recently opened history use separate UI storage keys, never the migration key.

## Alternatives

| Shape | Benefit | Rejection or choice |
| --- | --- | --- |
| Separate preview routes and copied views. | Small immediate change to household pages. | Rejected because a preview could pass while product pages remained old. |
| Shared display model with server-selected data. | The preview exercises the actual product components. | Chosen, with a read-only demo branch that never mounts household migration. |
| A generic read-and-write repository. | One interface for all operations. | Rejected because demo needs no write capability and save behavior already works. |

The two design workers agreed on server selection and explicit unknown real metadata. Their proposals differed on quantity representation and activity storage. Ordinary numeric base quantities and per-recipe UI records are enough for this card. An exact rational type and a general repository would add maintenance without a user-visible benefit.

## Compatibility

The alphabetical library intentionally replaces newest-first ordering. The new palette and typography intentionally replace the old visual assertions on the changed pages. Membership denial, manual saving, retry IDs, whitespace-preserving written text, cross-member access, and migration remain regression obligations.

Unbuilt commands remain honestly unavailable. This card does not add Lab, Menus, Prep List, Shopping List, import, editing, or recipe enrichment. It supplies their settled navigation positions without pretending those workflows exist.
