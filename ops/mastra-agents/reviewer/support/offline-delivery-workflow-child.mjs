import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createDeliveryWorkflowRuntime } from '../src/delivery-workflow.mjs';
import { createOfflineDeliveryAdapters } from './offline-delivery-adapters.mjs';

const [mode, directoryArgument, runId] = process.argv.slice(2);
if (!['start', 'accept', 'reject'].includes(mode) || !directoryArgument || !runId) {
  throw new Error('usage: offline-delivery-workflow-child.mjs start|accept|reject DIRECTORY RUN_ID');
}

const directory = resolve(directoryArgument);
await mkdir(directory, { recursive: true });
const approvedInputPath = join(directory, 'JUL-196-approved.json');
const callsPath = join(directory, 'calls.jsonl');
const adapters = createOfflineDeliveryAdapters({ directory, callsPath });
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
