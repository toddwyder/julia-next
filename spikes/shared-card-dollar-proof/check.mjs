import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const file of process.argv.slice(2)) {
  const {run, ledger, metrics} = JSON.parse(readFileSync(file, 'utf8'));
  const calls = ledger.filter(row => row.event === 'output');
  let recalculated = 0;
  for (const {usage} of calls) {
    const {inputTokens: input, outputTokens: output, cachedInputTokens: cached = 0, cacheCreationInputTokens: writes = 0, cacheCreationInputTokens5m: five = 0, cacheCreationInputTokens1h: hour = 0} = usage;
    const long = input > (run.account === 'claude' ? 100000 : 272000);
    const inputRate = run.account === 'claude' ? (long ? 0.5 : 0.1) : (long ? 0.2 : 0.1);
    const outputRate = run.account === 'claude' ? (long ? 2.5 : 0.5) : (long ? 0.75 : 0.5);
    if (run.account === 'claude') assert.equal(five + hour, writes, 'cache write duration');
    const writeCost = run.account === 'claude' ? inputRate * (five * 1.25 + hour * 2) : inputRate * writes * 1.25;
    recalculated += ((input - cached - writes) * inputRate + cached * inputRate * 0.1 + writeCost + output * outputRate) / 1e6;
  }
  const shared = ledger.at(-1)?.total ?? 0;
  const tokenRows = metrics.filter(row => ['mastra_model_total_input_tokens', 'mastra_model_total_output_tokens'].includes(row.name));
  if (calls.length) assert(tokenRows.length >= 2, 'missing Studio token rows');
  assert(tokenRows.every(row => row.estimatedCost !== null), 'missing saved cost');
  const saved = tokenRows.reduce((sum, row) => sum + row.estimatedCost, 0);
  const earlyLimits = {'2a68b443-4505-4772-97f5-cf13d33dd25c':0.002, 'e3832e50-22f4-4214-96af-9e40d351d4b3':0.0032, '94d86c15-0905-4de1-9f62-39a214bdf36c':0.002};
  const limit = run.limit ?? earlyLimits[run.runId] ?? (run.account === 'claude' && ['helpers','parallel'].includes(run.test) ? 0.003 : 0.002);
  const ceiling = limit + 3 * (run.account === 'claude' ? 1.32 : 0.3585);
  assert(Math.abs(shared - recalculated) < 1e-10, 'ledger does not match independently recalculated rows');
  assert(Math.abs(shared - saved) < 1e-10, 'ledger does not match saved Studio metric rows');
  assert(shared <= ceiling, 'exceeds ceiling');
  console.log(JSON.stringify({runId:run.runId,account:run.account,test:run.test,calls:calls.length,shared,recalculated,saved,ceiling}));
}
