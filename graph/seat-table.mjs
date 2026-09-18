// seat-table.mjs -- JUL-77: one place to choose each seat's tool and model,
// with an ordered backup. No secrets live here -- entries name a launch
// route (see scripts/julia-run.mjs and ops/service-dropbox/run-pi-seat.mjs
// for how each route actually authenticates).
//
// Rule enforced by assertNoSharedFamily: the reviewer's model family must
// differ from the builder's, for every combination this table allows
// (primary-vs-primary, primary-vs-backup, backup-vs-primary,
// backup-vs-backup) -- a builder and reviewer sharing a model would let one
// model review its own work.
export const SEAT_TABLE = {
  orchestrator: { primary: 'claude', backup: 'pi-glm' },
  builder: { primary: 'claude', backup: 'pi-deepseek' },
  reviewer: { primary: 'codex', backup: 'pi-glm' },
};

// Model family behind each table entry -- not the vendor/tool name, the
// underlying model maker, since two different tools can front the same
// family (e.g. a Claude Code pointed elsewhere would still be 'anthropic').
export const FAMILY_OF = {
  claude: 'anthropic',
  codex: 'openai',
  'pi-deepseek': 'deepseek',
  'pi-glm': 'zhipu',
};

export function assertNoSharedFamily(table) {
  const builderFamilies = new Set([table.builder.primary, table.builder.backup].map((e) => FAMILY_OF[e]));
  const reviewerFamilies = new Set([table.reviewer.primary, table.reviewer.backup].map((e) => FAMILY_OF[e]));
  for (const family of builderFamilies) {
    if (reviewerFamilies.has(family)) {
      throw new Error(`builder and reviewer share a model family: '${family}'`);
    }
  }
}
