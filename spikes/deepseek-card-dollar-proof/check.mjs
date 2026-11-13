import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let failed = false;
for (const file of process.argv.slice(2)) {
  const {run, ledger, spans, metrics} = JSON.parse(readFileSync(file, 'utf8'));
  const calls = ledger.filter(row => row.event === 'output');
  const timestamps = spans.filter(s => s.spanType === 'model_generation').map(s => s.timestamp).sort();
  assert(timestamps.length && calls.length, 'missing model span or call rows');
  const peak = timestamp => {
    const t = new Date(timestamp), d = t.getUTCDay(), h = t.getUTCHours();
    return d >= 1 && d <= 5 && ((h >= 1 && h < 4) || (h >= 6 && h < 10));
  };
  assert(timestamps.every(t => peak(t) === peak(timestamps[0])), 'run crossed a pricing boundary');
  let calculated = 0;
  for (const {usage} of calls) {
    const {inputTokens, outputTokens, cachedInputTokens = 0} = usage;
    assert(Number.isFinite(inputTokens) && Number.isFinite(outputTokens), 'missing usage');
    calculated += ((inputTokens - cachedInputTokens) * 0.15 + cachedInputTokens * 0.003 + outputTokens * 0.6) * (peak(timestamps[0]) ? 2 : 1) / 1e6;
  }
  const shared = ledger.at(-1)?.total ?? 0;
  const rows = metrics.filter(m => ['mastra_model_total_input_tokens','mastra_model_total_output_tokens'].includes(m.name));
  assert(rows.length >= 2 && rows.every(m => m.estimatedCost !== null), 'missing Studio dollar rows');
  const studio = rows.reduce((n, m) => n + m.estimatedCost, 0);
  const match = Math.abs(shared - calculated) < 1e-10 && Math.abs(shared - studio) < 1e-10;
  const within = shared <= 2.3024;
  failed ||= !match || !within;
  console.log(JSON.stringify({runId:run.runId,calls:calls.length,peak:peak(timestamps[0]),shared,calculated,studio,ceiling:2.3024,match,within}));
}
if (failed) process.exitCode = 1;
