import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createDeliveryWorkflowRuntime } from '../src/delivery-workflow.mjs';

const [mode, directoryArgument, runId] = process.argv.slice(2);
if (!['start', 'accept', 'reject'].includes(mode) || !directoryArgument || !runId) {
  throw new Error('usage: offline-delivery-workflow-child.mjs start|accept|reject DIRECTORY RUN_ID');
}

const directory = resolve(directoryArgument);
await mkdir(directory, { recursive: true });
const approvedInputPath = join(directory, 'JUL-196-approved.json');
const callsPath = join(directory, 'calls.jsonl');
const record = event => appendFile(callsPath, `${JSON.stringify(event)}\n`);
const resultFile = async (name, value) => {
  const resultPath = join(directory, name);
  await writeFile(resultPath, `${JSON.stringify(value)}\n`);
  return { resultPath };
};
const adapters = {
  builder: async ({ round }) => {
    await record({ kind: 'builder', round });
    return resultFile(`builder-${round}.json`, { status: 'PASS' });
  },
  checks: async ({ round }) => {
    await record({ kind: 'checks', round });
    return resultFile(`checks-${round}.json`, { status: 'PASS', change: `offline-candidate-${round}` });
  },
  reviewer: async ({ round }) => {
    await record({ kind: 'reviewer', round });
    return resultFile(`review-${round}.json`, {
      verdict: 'PASS', reason: 'offline stand-in review', model: 'stand-in-reviewer', effort: 'none',
      inputTokens: 0, outputTokens: 0, costEstimateUsd: 0,
    });
  },
  notify: async ({ round }) => {
    await record({ kind: 'notice', round });
    return resultFile(`notice-${round}.json`, { status: 'sent' });
  },
};
const runtime = await createDeliveryWorkflowRuntime({
  storagePath: join(directory, 'mastra.db'), runDirectory: directory,
  summaryPath: join(directory, 'summary.log'), adapters,
});

try {
  let result;
  if (mode === 'start') {
    await writeFile(approvedInputPath, `${JSON.stringify({ identifier: 'JUL-196' })}\n`);
    result = await runtime.start({ runId, input: { card: 'JUL-196', approvedInputPath, runDirectory: directory } });
  } else {
    result = await runtime.resume({
      runId, decision: mode, ...(mode === 'reject' ? { reason: 'offline rejection' } : {}),
    });
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await runtime.close();
}
