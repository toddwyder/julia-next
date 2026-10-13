import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function createOfflineDeliveryAdapters({ directory, callsPath, verdicts = ['PASS'] }) {
  const record = event => appendFile(callsPath, `${JSON.stringify(event)}\n`);
  const resultFile = async (name, value) => {
    const resultPath = join(directory, name);
    await writeFile(resultPath, `${JSON.stringify(value)}\n`);
    return { resultPath };
  };
  return {
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
        verdict: verdicts[round - 1] ?? verdicts.at(-1), reason: 'offline stand-in review',
        model: 'stand-in-reviewer', effort: 'none', inputTokens: 0, outputTokens: 0, costEstimateUsd: 0,
      });
    },
    notify: async ({ round }) => {
      await record({ kind: 'notice', round });
      return resultFile(`notice-${round}.json`, { status: 'sent' });
    },
  };
}
