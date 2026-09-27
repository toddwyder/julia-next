import { defineBoard } from '@mastra/factory/boards';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';

export const requiredEvidence = {
  build: ['red'],
  review: ['red', 'green', 'suite', 'guard', 'standards', 'spec'],
  uat: ['red', 'green', 'suite', 'guard', 'standards', 'spec', 'deepseek', 'rehearsal', 'review-request'],
  done: ['red', 'green', 'suite', 'guard', 'standards', 'spec', 'deepseek', 'rehearsal', 'review-request', 'approval', 'merged'],
};

export async function checkEvidence(evidenceDir, candidate, stage) {
  const required = requiredEvidence[stage] ?? [];
  if (!required.length) return [];
  let manifest;
  try { manifest = JSON.parse(await readFile(join(evidenceDir, 'manifest.json'), 'utf8')); }
  catch { return ['Evidence manifest is missing or unreadable']; }
  if (!/^[a-f0-9]{40}$/.test(candidate ?? '') || manifest.candidate !== candidate) {
    return ['Evidence belongs to a different candidate commit'];
  }
  const failures = [];
  for (const key of required) {
    const proof = manifest.evidence?.[key];
    const expected = key === 'red' ? manifest.baseline : candidate;
    if (!proof || proof.sha !== expected || proof.status !== 'pass') {
      failures.push(`Missing or invalid evidence: ${key}`);
      continue;
    }
    try {
      const path = resolve(evidenceDir, proof.log);
      if (!path.startsWith(resolve(evidenceDir) + sep)) throw Error('Outside evidence directory');
      const data = await readFile(path);
      if (!data.length || createHash('sha256').update(data).digest('hex') !== proof.sha256) {
        throw Error('Artifact hash mismatch');
      }
      if (key === 'approval') {
        const review = JSON.parse(data.toString('utf8')).review;
        if (!Number.isInteger(review?.id) || review.id <= 0 ||
            review.user?.login !== 'toddwyder' || review.state !== 'APPROVED' ||
            review.commit_id !== candidate) {
          failures.push('Invalid approval evidence: approval');
        }
      }
    } catch { failures.push(`Unreadable or changed evidence: ${key}`); }
  }
  return failures;
}

// One trial board, with resting lanes controlled by the evidence gate.
export function createTrialBoard({ evidenceDir }) {
  const destinations = {
    intake: 'intake', red: 'red', build: 'build', review: 'review',
    uat: 'uat', done: 'done', canceled: 'canceled',
  };
  return defineBoard({
    id: 'julia-trial', title: 'Julia trial', initialPhase: 'intake',
    transitionPolicy: async context => {
      const failures = await checkEvidence(evidenceDir, context.item.metadata?.candidateSha, context.toStage);
      if (failures.length) return { type: 'reject', code: 'forbidden', reason: failures.join('; ') };
    },
    phases: {
      intake: { title: 'Intake', kind: 'resting', outcomes: destinations },
      red: { title: 'Test first', kind: 'working', role: 'work', outcomes: destinations },
      build: { title: 'Build', kind: 'working', role: 'work', outcomes: destinations },
      review: { title: 'Review', kind: 'resting', outcomes: destinations },
      uat: { title: 'Todd review', kind: 'resting', outcomes: destinations },
      done: { title: 'Done', kind: 'terminal' },
      canceled: { title: 'Canceled', kind: 'terminal' },
    },
  });
}
