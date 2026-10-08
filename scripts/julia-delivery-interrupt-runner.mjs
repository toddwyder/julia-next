// julia-delivery-interrupt-runner.mjs -- one real runner process for the
// real-worker interruption proof (JUL-196 step 7).
// Usage: node julia-delivery-interrupt-runner.mjs <proofDir>. It runs the real
// runDelivery with the real productionLauncher in a disposable repository
// owned by the proof. julia-delivery-interrupt.test.mjs starts it, kills it
// while a worker is active, and starts it again.
//
// Only two things are stand-ins, both named in the evidence: the candidate
// step commits the disposable change itself and checks only the file's
// content (not the JUL-122 checks), and, unless plan.realReviewer is set, the
// reviewer's verdict is scripted from the file's content. A scripted verdict
// is not a review.
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { productionLauncher, runDelivery } from './julia-delivery-runner.mjs';

const proofDir = process.argv[2];
const plan = JSON.parse(await readFile(join(proofDir, 'plan.json'), 'utf8'));
const { worktree, issueId, configuration } = plan;
const git = (...args) => {
  const result = spawnSync('git', ['-C', worktree, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
};
const proofText = () => readFile(join(worktree, 'proof.txt'), 'utf8').catch(() => '');
const real = productionLauncher(worktree);

const launch = async (role, request) => {
  if (role === 'builder' || plan.realReviewer) return real(role, request);
  const { harness, model, maker } = configuration.reviewer;
  const good = new RegExp(plan.passWhen).test(await proofText());
  return { exitCode: 0, observed: { harness, model, maker }, text: good ? `VERDICT: PASS\nCOMMIT: ${git('rev-parse', 'HEAD')}\n(scripted stand-in, not a review)` : `VERDICT: FAIL\n${plan.finding}\n(scripted stand-in, not a review)` };
};

const candidate = async () => {
  if (git('status', '--porcelain')) {
    git('add', '-A');
    git('-c', 'user.name=jul196-proof', '-c', 'user.email=proof@example.invalid', 'commit', '-q', '-m', 'proof snapshot');
  }
  return { commit: git('rev-parse', 'HEAD'), clean: !git('status', '--porcelain'), checks: { pass: new RegExp(plan.checkWhen).test(await proofText()) } };
};

const prepareWorktree = async ({ saved }) => {
  const branch = git('branch', '--show-current');
  if (saved && (saved.path !== worktree || saved.branch !== branch)) return { ok: false, reason: 'the proof worktree is not the one this run started in' };
  return { ok: true, worktree: saved ?? { path: worktree, branch, startCommit: git('rev-parse', 'HEAD') } };
};

const result = await runDelivery({ issueId, configuration, runPath: join(proofDir, 'runs', `${issueId}.json`) }, {
  readCard: async () => { throw new Error('Linear must not be read: the approved input is already saved'); },
  launch, candidate, prepareWorktree,
});
console.log(`RESULT ${JSON.stringify(result)}`);
