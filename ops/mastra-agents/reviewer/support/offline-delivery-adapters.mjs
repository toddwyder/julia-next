import { appendFile, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function createOfflineDeliveryAdapters({ directory, callsPath, verdicts = ['PASS'] }) {
  const record = event => appendFile(callsPath, `${JSON.stringify(event)}\n`);
  const resultFile = async (name, value) => {
    const resultPath = join(directory, name);
    await writeFile(resultPath, `${JSON.stringify(value)}\n`);
    return { resultPath };
  };
  const resultFileOnce = async (name, value) => {
    const resultPath = join(directory, name);
    const text = `${JSON.stringify(value)}\n`;
    try { await writeFile(resultPath, text, { flag: 'wx' }); }
    catch (error) {
      if (error?.code !== 'EEXIST' || await readFile(resultPath, 'utf8') !== text) throw error;
    }
    return { resultPath };
  };
  const count = async name => {
    const path = join(directory, name);
    let value = 0;
    try { value = Number(await readFile(path, 'utf8')); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    await writeFile(path, String(value + 1));
    return value + 1;
  };
  const candidateVersion = async () => {
    try { return Number(await readFile(join(directory, 'candidate-version.txt'), 'utf8')) || 1; } catch (error) { if (error?.code !== 'ENOENT') throw error; return 1; }
  };
  return {
    authorization: async () => {
      await record({ kind: 'authorization', round: 0 });
      return resultFile('authorization.json', { status: 'PASS' });
    },
    cardRead: async () => {
      await record({ kind: 'card-read', round: 0 });
      return { resultPath: join(directory, 'JUL-196-approved.json') };
    },
    builder: async ({ round }) => {
      await record({ kind: 'builder', round });
      return resultFile(`builder-${round}.json`, { status: 'PASS' });
    },
    checks: async ({ round }) => {
      await record({ kind: 'checks', round });
      const version = await candidateVersion();
      return resultFile(`checks-${round}.json`, { status: 'PASS', change: `offline-candidate-${version}`, candidateCommit: `offline-candidate-${version}` });
    },
    reviewer: async ({ round }) => {
      await record({ kind: 'reviewer', round });
      const attempt = await count('review-count.txt');
      return resultFile(`review-${round}.json`, {
        verdict: verdicts[attempt - 1] ?? verdicts.at(-1), reason: 'offline stand-in review',
        model: 'stand-in-reviewer', effort: 'none', inputTokens: 0, outputTokens: 0, costEstimateUsd: 0,
      });
    },
    waitingRecord: async ({ round, builderResultPath, checksResultPath, reviewResultPath }) => {
      await record({ kind: 'waiting', round });
      const version = await candidateVersion();
      return resultFileOnce(`waiting-offline-candidate-${version}.json`, {
        card: 'JUL-196', candidateCommit: `offline-candidate-${version}`,
        evidencePaths: [builderResultPath, checksResultPath, reviewResultPath],
        summary: `Round ${round} passed its checks and independent review and is waiting for Todd's technical acceptance.`,
      });
    },
    validateCandidate: async () => {
      const marker = join(directory, 'candidate-changed');
      try {
        await readFile(marker, 'utf8');
        await rm(marker);
        await writeFile(join(directory, 'candidate-version.txt'), '2');
        return { status: 'STALE', reason: 'candidate commit changed' };
      } catch (error) { if (error?.code !== 'ENOENT') throw error; return { status: 'PASS' }; }
    },
    recordAcceptance: async ({ round, checksResultPath }) => {
      const checks = JSON.parse(await readFile(checksResultPath, 'utf8'));
      await record({ kind: 'acceptance', round, candidateCommit: checks.candidateCommit });
      return resultFileOnce(`acceptance-${checks.candidateCommit}.json`, { card: 'JUL-196', candidateCommit: checks.candidateCommit, accepted: true });
    },
    park: async ({ round }) => { await record({ kind: 'park', round }); return resultFile(`park-${round}.json`, { status: 'PARKED' }); },
    record,
  };
}
