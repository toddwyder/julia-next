import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibSQLFactoryStorage } from '@mastra/libsql';
import { createBoardRegistry } from '@mastra/factory/boards';
import { WorkItemsStorage } from '@mastra/factory/storage/domains/work-items/base';
import { FactoryTransitionService } from '@mastra/factory/rules/transition-service';
import { createTrialBoard } from './trial-board.mjs';

const dir = await mkdtemp(join(tmpdir(), 'factory-transition-'));
const storage = new LibSQLFactoryStorage({ id: 'trial-regression', url: 'file::memory:' });
const items = storage.registerDomain(new WorkItemsStorage());
await storage.init();
await items.ensureReady();
const orgId = 'org_fixture', project = randomUUID();
const { item } = await items.upsert({ orgId, userId: 'user_fixture',
  factoryProjectId: project, input: {
    board: 'julia-trial', title: 'Evidence gate regression', stages: ['build'],
    metadata: { candidateSha: 'a'.repeat(40) },
  },
});
const service = new FactoryTransitionService({ configVersion: 'trial-regression',
  storage: items, boards: createBoardRegistry({ includeDefaultBoards: false,
    boards: [createTrialBoard({ evidenceDir: dir })] }),
});
try {
  const result = await service.transition({ orgId, factoryProjectId: project,
    workItemId: item.id, board: 'julia-trial', stage: 'review',
    expectedRevision: item.revision, actor: { type: 'human', id: 'user_fixture' },
    ingress: { type: 'human', identity: randomUUID() }, cause: 'regression',
  });
  assert.equal(result.status, 'rejected', 'Missing proof must block advancement');
  assert.match(result.reason, /evidence/i);
  console.log('PASS: actual Factory card transition blocks missing proof');
  const content = 'Verified fixture output\n';
  await writeFile(join(dir, 'proof.log'), content);
  const proof = { sha: 'b'.repeat(40), status: 'pass', log: 'proof.log',
    sha256: createHash('sha256').update(content).digest('hex') };
  const evidence = Object.fromEntries(['red', 'green', 'suite', 'guard', 'standards', 'spec']
    .map(key => [key, { ...proof, sha: key === 'red' ? 'c'.repeat(40) : proof.sha }]));
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({
    candidate: 'b'.repeat(40), baseline: 'c'.repeat(40), evidence,
  }));
  const wrongCommit = await service.transition({ orgId, factoryProjectId: project,
    workItemId: item.id, board: 'julia-trial', stage: 'review',
    expectedRevision: item.revision, actor: { type: 'human', id: 'user_fixture' },
    ingress: { type: 'human', identity: randomUUID() }, cause: 'wrong-commit regression',
  });
  assert.equal(wrongCommit.status, 'rejected', 'Wrong-commit proof must block advancement');
  console.log('PASS: actual Factory card transition blocks wrong-commit proof');
  for (const key of Object.keys(evidence)) {
    if (key !== 'red') evidence[key].sha = 'a'.repeat(40);
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({
    candidate: 'a'.repeat(40), baseline: 'c'.repeat(40), evidence,
  }));
  const verified = await service.transition({ orgId, factoryProjectId: project,
    workItemId: item.id, board: 'julia-trial', stage: 'review',
    expectedRevision: item.revision, actor: { type: 'human', id: 'user_fixture' },
    ingress: { type: 'human', identity: randomUUID() }, cause: 'verified-proof regression',
  });
  assert.equal(verified.status, 'accepted', 'Verified proof must permit advancement');
  console.log('PASS: actual Factory card transition accepts verified candidate proof');
} finally {
  await rm(dir, { recursive: true, force: true });
  await storage.close?.();
}
