// seat-table.mjs -- JUL-77: one place to choose each seat's tool and model,
// with an ordered backup. No secrets live here -- entries name a launch
// route (see scripts/julia-run.mjs and ops/service-dropbox/run-pi-seat.mjs
// for how each route actually authenticates).
//
// Rule enforced by assertCanPickDifferentFamilies: the ticket's real rule is
// about the builder/reviewer models CHOSEN FOR ONE CARD, not about every
// combination the table permits. It must be possible, for every builder
// entry, to pick at least one reviewer entry from a different model family
// (and symmetrically for every reviewer entry), so a resolved pair can always
// obey "builder and reviewer are from different families" (the rule
// scripts/seat-labels.mjs's validateFamilyChoice enforces on an actual card).
//
// This is deliberately weaker than the old "no shared family across every
// primary/backup combination" check, which the table below cannot satisfy:
// Todd's instruction bars GLM (zhipu) as any seat default or backup, and
// reviewer's backup is claude (anthropic) like the builder's primary.
// JUL-97 step 1 adds the six agent seats the board's labels and template
// describe. The three original seats are unchanged -- the coordinator's own
// launch path still reads `orchestrator`, and the builder/reviewer pair the
// family rule below is about is still `builder`/`reviewer`.
export const SEAT_TABLE = {
  orchestrator: { primary: 'claude', backup: 'pi-deepseek' },
  builder: { primary: 'claude', backup: 'pi-deepseek' },
  reviewer: { primary: 'codex', backup: 'claude' },
  'feature-builder': { primary: 'claude', backup: 'pi-deepseek' },
  'defect-fixer': { primary: 'claude', backup: 'pi-deepseek' },
  refactor: { primary: 'claude', backup: 'pi-deepseek' },
  'adversarial-reviewer': { primary: 'codex', backup: 'claude' },
  'evidence-reviewer': { primary: 'codex', backup: 'claude' },
  consultant: { primary: 'claude', backup: 'pi-deepseek' },
};

// Model family behind each table entry -- not the vendor/tool name, the
// underlying model maker, since two different tools can front the same
// family (e.g. a Claude Code pointed elsewhere would still be 'anthropic').
// pi-glm stays defined and stays a selectable model label; it is simply
// never a seat default or backup.
export const FAMILY_OF = {
  claude: 'anthropic',
  codex: 'openai',
  'pi-deepseek': 'deepseek',
  'pi-glm': 'zhipu',
};

// The invariant the ticket states: for every builder entry there is at least
// one reviewer entry of a different family, and for every reviewer entry
// there is at least one builder entry of a different family. A table where
// some entry has no valid partner at all is a real defect (it could never
// form a legal pair) and still throws.
export function assertCanPickDifferentFamilies(table) {
  const builderEntries = [table.builder.primary, table.builder.backup];
  const reviewerEntries = [table.reviewer.primary, table.reviewer.backup];

  for (const entry of [...builderEntries, ...reviewerEntries]) {
    if (!Object.hasOwn(FAMILY_OF, entry)) {
      throw new Error(`seat-table entry '${entry}' has no known model family`);
    }
  }
  for (const entry of builderEntries) {
    const family = FAMILY_OF[entry];
    if (!reviewerEntries.some((reviewer) => FAMILY_OF[reviewer] !== family)) {
      throw new Error(`builder entry '${entry}' (family '${family}') has no reviewer entry from a different family`);
    }
  }
  for (const entry of reviewerEntries) {
    const family = FAMILY_OF[entry];
    if (!builderEntries.some((builder) => FAMILY_OF[builder] !== family)) {
      throw new Error(`reviewer entry '${entry}' (family '${family}') has no builder entry from a different family`);
    }
  }
}

// Kept as a named export for any caller that still imports the old name;
// the meaning is now assertCanPickDifferentFamilies above.
export const assertNoSharedFamily = assertCanPickDifferentFamilies;
