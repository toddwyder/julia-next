import assert from 'node:assert/strict';
import test from 'node:test';
import { runDailyResourceCheck } from './disk-check.mjs';

function cleanSnapshot(overrides = {}) {
  return {
    studioReachable: true,
    activeCards: [],
    userUnits: [],
    systemUnits: [],
    processes: [],
    checkouts: [],
    worktrees: [],
    scratchEntries: [],
    scratchCards: [],
    builderArtifacts: [],
    flowStudioEntries: [],
    mastracodeEntries: [],
    homeExtras: [],
    ...overrides,
  };
}

test('does not alert when cleanup recovers leftovers and disk and memory are healthy', async () => {
  let step = 0;
  let cleaned = false;
  let alerted = false;
  const result = await runDailyResourceCheck({
    env: {},
    collect: () => {
      step += 1;
      if (step === 1) {
        return cleanSnapshot({
          processes: [{ pid: 999, rssKb: 4000000, cmd: 'orphan-proc', serviceUnit: null }],
        });
      }
      return cleanSnapshot();
    },
    clean: () => {
      cleaned = true;
    },
    statfs: () => ({ bavail: 20_000_000, bfree: 20_000_000, blocks: 40_000_000, bsize: 1000 }),
    readMemoryMb: () => (cleaned ? 4096 : 512),
    sendAlert: async () => {
      alerted = true;
      return { comment: 'https://linear.app/julia-next/issue/JUL-276#c1' };
    },
  });

  assert.equal(cleaned, true);
  assert.equal(alerted, false);
  assert.equal(result.alert, false);
});

test('alerts on JUL-276 when disk or memory stays short after cleanup', async () => {
  let sentBody = '';
  const result = await runDailyResourceCheck({
    env: {},
    collect: () => cleanSnapshot(),
    clean: () => {},
    statfs: () => ({ bavail: 2_000_000, bfree: 2_000_000, blocks: 40_000_000, bsize: 1000 }),
    readMemoryMb: () => 400,
    readLargestFolders: () => [{ path: '/var/log', bytes: 5_000_000_000 }],
    sendAlert: async body => {
      sentBody = body;
      return { comment: 'https://linear.app/julia-next/issue/JUL-276#c2' };
    },
  });

  assert.equal(result.alert, true);
  assert.equal(result.comment, 'https://linear.app/julia-next/issue/JUL-276#c2');
  assert.match(sentBody, /Disk:.*2\.0 GB available/);
  assert.match(sentBody, /Memory: 400 MB available/);
  assert.match(sentBody, /\/var\/log: 5\.0 GB/);
});
