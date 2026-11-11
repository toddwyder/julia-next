import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

let table;
function mastraTable() {
  if (table) return table;
  const root = dirname(createRequire(import.meta.url).resolve('@mastra/observability/package.json'));
  table = JSON.parse(readFileSync(join(root, 'dist', 'metrics', 'pricing-data.json'), 'utf8'));
  return table;
}

// Mastra's context tier applies at total input >= size. The controller's long-input rule applies above a
// threshold, so one token lower is the same boundary. One multiplier covers input and output, so a tier
// whose rates do not scale together is not priced here.
export function mastraPrice(id) {
  const slash = id.indexOf('/');
  if (slash < 1) return null;
  const provider = id.slice(0, slash);
  const cost = Object.hasOwn(mastraTable(), provider) ? mastraTable()[provider].models?.[id.slice(slash + 1)]?.cost : undefined;
  if (!cost || !(cost.input >= 0) || !(cost.output >= 0)) return null;
  const price = { input: cost.input, cachedInput: cost.cache_read ?? 0, cacheWrite: cost.cache_write ?? 0, output: cost.output,
    source: `@mastra/observability pricing-data.json, ${id}` };
  if (cost.tiers?.length) {
    const [tier, ...more] = cost.tiers;
    const scale = tier.input / cost.input;
    const same = ['output', 'cache_read', 'cache_write'].every(key => cost[key] === undefined || Math.abs(tier[key] / cost[key] - scale) < 1e-9);
    if (more.length || tier.tier?.type !== 'context' || !same || !(scale > 0)) return null;
    price.longInputThreshold = tier.tier.size - 1;
    price.longInputMultiplier = scale;
    price.longOutputMultiplier = scale;
  }
  return price;
}
