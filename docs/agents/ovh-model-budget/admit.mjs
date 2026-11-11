import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const code = new URL('../../..', import.meta.url).pathname;
const { createSliceControl } = await import(code + '/machine/budget/control.mjs');
const { readRoleModels, readStageModels } = await import('../../../machine/flow/role-models.mjs');
const { leadModelId } = await import('../../../machine/flow/models.mjs');
const picks = [{ role: 'lead', id: leadModelId() },
  ...readRoleModels().flatMap(r => r.models.map(id => ({ role: r.name, id }))),
  ...Object.entries(readStageModels()).map(([role, id]) => ({ role, id }))];
let refused = 0;
for (const { role, id } of picks) {
  const control = createSliceControl({ directory: mkdtempSync(join(tmpdir(), 'admit-')), dollarCap: 4, tokenCap: 2000000 });
  try { const r = control.begin({ model: id, role, inputTokens: 1000 }); console.log('ADMIT ', role.padEnd(40), id, `maxOut=${r.maxOutputTokens} worst$=${r.worstDollars.toFixed(4)}`); }
  catch (e) { refused++; console.log('REFUSE', role.padEnd(40), id, e.message); }
}
console.log(`${picks.length - refused}/${picks.length} admitted`);
process.exitCode = refused ? 1 : 0;
