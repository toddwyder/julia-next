import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const totals = ['mastra_model_total_input_tokens', 'mastra_model_total_output_tokens'];
const fields = ['metricId', 'timestamp', 'traceId', 'spanId', 'runId', 'entityType', 'entityId', 'parentEntityType', 'parentEntityId', 'rootEntityId', 'name', 'provider', 'model', 'value', 'estimatedCost', 'costUnit', 'costMetadata'];
const pick = (row, keys) => Object.fromEntries(keys.map(key => [key, row[key]]));
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const price = usage => ((usage.inputTokens - (usage.inputDetails?.cacheRead ?? 0) - (usage.inputDetails?.cacheWrite ?? 0)) * 0.1 + (usage.inputDetails?.cacheRead ?? 0) * 0.01 + (usage.inputDetails?.cacheWrite ?? 0) * 0.125 + usage.outputTokens * 0.5) / 1e6;
const close = (a, b) => assert(Math.abs(a - b) < 1e-12, `${a} differs from ${b}`);

export function report(dir) {
  const read = name => JSON.parse(readFileSync(join(dir, name), 'utf8'));
  const setup = read('setup.json');
  const expectedCases = ['current', 'coding'].flatMap(factory => ['normal', 'stop', 'memory'].map(test => `${factory}-${test}`));
  const savedRuns = read('runs.json');
  assert.deepEqual(savedRuns.map(run => run.key), expectedCases, 'The complete six-case comparison is required');
  const metrics = read('metric_events.json');
  const best = new Map();
  const rank = row => row.eventType === 'end' ? 3 : row.attributes && row.attributes !== 'null' ? 2 : 1;
  for (const row of read('span_events.json')) {
    if (!best.has(row.spanId) || rank(row) > rank(best.get(row.spanId))) best.set(row.spanId, row);
  }
  const spans = [...best.values()];
  const runs = savedRuns.map(run => {
    const root = spans.find(row => row.spanType === 'agent_run' && row.parentSpanId === null && row.runId === run.runId);
    assert(root, `No persisted root for ${run.key}`);
    const inside = spans.filter(row => row.traceId === root.traceId);
    const inferences = inside.filter(row => row.spanType === 'model_inference');
    assert(inferences.length);
    for (const row of inferences) {
      assert.equal(row.model, 'gpt-6-luna');
      assert.equal(row.outcome, 'success');
    }
    const generationOf = inference => {
      let row = inference;
      while (row && row.spanType !== 'model_generation') row = best.get(row.parentSpanId);
      assert(row, 'An inference has no generation');
      return row;
    };
    const generations = inside.filter(row => row.spanType === 'model_generation').map(row => {
      const usage = parse(row.attributes).usage;
      const calls = inferences.filter(inference => generationOf(inference).spanId === row.spanId).map(inference => {
        const callUsage = parse(inference.attributes).usage;
        return { ...pick(inference, ['spanId', 'parentSpanId', 'runId', 'model', 'provider', 'outcome']), usage: callUsage, tokensTimesPriceUsd: price(callUsage) };
      });
      assert(calls.length);
      const metricRows = metrics.filter(metric => metric.spanId === row.spanId && totals.includes(metric.name));
      assert.equal(metricRows.length, 2, `Missing cost rows for ${row.spanId}`);
      for (const metric of metricRows) {
        assert.equal(metric.model, 'gpt-6-luna');
        assert.equal(metric.provider, 'openai');
        assert.equal(metric.costUnit, 'USD');
        assert.equal(typeof metric.estimatedCost, 'number');
      }
      for (const key of ['inputTokens', 'outputTokens']) close(usage[key], calls.reduce((sum, call) => sum + call.usage[key], 0));
      const recordedCostUsd = metricRows.reduce((sum, metric) => sum + metric.estimatedCost, 0);
      close(recordedCostUsd, price(usage));
      close(recordedCostUsd, calls.reduce((sum, call) => sum + call.tokensTimesPriceUsd, 0));
      return { ...pick(row, ['spanId', 'parentSpanId', 'runId', 'entityId', 'model', 'provider']), usage, recordedCostUsd, tokensTimesPriceUsd: price(usage), metricRows: metricRows.map(metric => pick(metric, fields)), calls };
    });
    assert.equal(generations.reduce((sum, row) => sum + row.calls.length, 0), inferences.length);
    const delegation = inside.filter(row => row.spanType === 'tool_call' && row.name === "tool: 'agent-howExplorer'");
    assert.equal(delegation.length, 1, `${run.key} must delegate exactly once`);
    assert.equal(delegation[0].outcome, 'success');
    const helper = inside.find(row => row.spanType === 'agent_run' && row.entityId === 'pstack-how-explorer-1');
    assert.equal(helper?.parentSpanId, delegation[0].spanId);
    const tripwire = run.events.find(event => event.type === 'tripwire')?.payload ?? null;
    const totalUsd = generations.reduce((sum, row) => sum + row.recordedCostUsd, 0);
    assert(!run.events.some(event => event.type === 'error'), `${run.key} returned an error`);
    if (run.test === 'stop') {
      assert.equal(root.outcome, 'blocked');
      assert.equal(root.stopReason, 'guardrail');
      assert.equal(tripwire?.processorId, 'token-cost-control');
      assert.equal(tripwire.retry, false);
      assert.equal(tripwire.metadata.maxCost, setup.limit);
      assert(totalUsd > setup.limit);
      const helperCost = generations.filter(row => row.entityId === helper.entityId).reduce((sum, row) => sum + row.recordedCostUsd, 0);
      close(tripwire.metadata.usage.estimatedCost, helperCost);
      assert.equal(inferences.length, 2, 'The stop must prevent the second Lead call');
    } else assert.equal(root.outcome, 'success');
    if (run.test === 'memory') {
      for (const entityId of ['observational-memory-observer', 'observational-memory-reflector']) assert(generations.some(row => row.entityId === entityId), `${entityId} never ran`);
    }
    return { key: run.key, factory: run.factory, test: run.test, runId: run.runId, traceId: root.traceId,
      persistedRoot: pick(root, ['spanId', 'eventType', 'endedAt', 'outcome', 'stopReason', 'stopReasonContext']),
      tripwire, inferenceCount: inferences.length, totalUsd, generations,
      tools: inside.filter(row => row.spanType === 'tool_call').map(row => pick(row, ['spanId', 'name', 'outcome'])) };
  });
  const corePackage = JSON.parse(readFileSync(new URL('../../node_modules/@mastra/core/package.json', import.meta.url), 'utf8'));
  assert.equal(corePackage.version, '1.82.0');
  const evidence = { environmentVerifiedAtExport: { coreVersion: corePackage.version, method: 'Read installed @mastra/core/package.json after the Studio server stopped. No dependencies changed during the experiment.' }, setup, pricing: { source: 'https://developers.openai.com/api/docs/models/gpt-6-luna', perMillionUsd: { input: 0.1, cacheRead: 0.01, cacheWrite: 0.125, output: 0.5 }, contextLimit: 272000 }, runs };
  writeFileSync(join(dir, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  const table = ['| Test | Owner | Generation span | Input | Cached input | Output | Recorded input USD | Recorded output USD | Tokens times price USD |', '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const run of runs) for (const row of run.generations) {
    const usd = name => row.metricRows.find(metric => metric.name === name).estimatedCost.toFixed(8);
    table.push(`| ${run.key} | ${row.entityId} | ${row.spanId} | ${row.usage.inputTokens} | ${row.usage.inputDetails.cacheRead} | ${row.usage.outputTokens} | ${usd(totals[0])} | ${usd(totals[1])} | ${row.tokensTimesPriceUsd.toFixed(8)} |`);
  }
  writeFileSync(join(dir, 'rows.md'), table.join('\n') + '\n');
  for (const run of runs) console.log(`${run.key} ${run.runId} ${run.persistedRoot.outcome} calls=${run.inferenceCount} total=$${run.totalUsd.toFixed(8)} guard=${run.tripwire?.metadata.usage.estimatedCost ?? 'none'}`);
  console.log('PASS: every inference maps to priced recorded totals; one successful delegation per run; both memory helpers priced; both stops persisted.');
  return evidence;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) report(resolve(process.argv[2]));
