// julia-delivery-interrupt-runner.mjs -- one real runner process for the
// real-worker interruption proof (JUL-196 step 7).
// Usage: node julia-delivery-interrupt-runner.mjs <proofDir>. It runs the real
// runDelivery with OS process fixtures (or an opt-in native BUILDER) in a disposable repository
// owned by the proof. julia-delivery-interrupt.test.mjs starts it, kills it
// while a worker is active, and starts it again.
//
// Only two things are stand-ins, both named in the evidence: the candidate
// step commits the disposable change itself and checks only the file's
// content (not the JUL-122 checks), and the
// reviewer's verdict is scripted from the file's content. A scripted verdict
// is not a review.
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { productionLauncher, runDelivery } from './julia-delivery-runner.mjs';
import { runLimited } from '../ops/julia-runner/time-limit.mjs';

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

// A real OS child, with deterministic local work instead of a provider call.
// It consumes its instructions only after the runner journals PID/start identity.
async function fixture(role, request) {
  const hang = plan.interruptAction === `${role === 'builder' ? 'build' : 'review'}:${request.round}` && !request.outputPath.includes('-attempt-');
  const before = await proofText();
  const text = role === 'builder' ? (before || 'JUL-196 recovery proof\npartial\n') + (request.round && !before.includes('repaired\n') ? 'repaired\n' : '') : null;
  let output = '';
  const program = `let input=''; process.stdin.on('data', x => input+=x); process.stdin.on('end', () => { const p=JSON.parse(input); if(p.text) require('node:fs').writeFileSync(p.path,p.text); console.log('deterministic process fixture'); if(p.hang) setInterval(()=>{},1000); });`;
  const result = await runLimited(process.execPath, ['-e', program], { cwd: worktree, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }, {
    seconds: 30,
    started: (child) => {
      child.stdout.on('data', chunk => { output += chunk; });
      child.stdin.on('error', () => {});
      Promise.resolve(request.started({ pid: child.pid })).then(() => child.stdin.end(JSON.stringify({ path: join(worktree, 'proof.txt'), text, hang })), () => child.kill());
    },
  });
  console.log(`FIXTURE ${JSON.stringify({ role, round: request.round, before, output })}`);
  return { exitCode: result.code, observed: { harness: configuration[role].harness, model: configuration[role].model, maker: configuration[role].maker } };
}

const launch = async (role, request) => {
  if (role === 'builder') {
    if (plan.processFixture) return fixture(role, request);
    if (configuration.builder.harness === 'codex') {
      if (!plan.realCodexBuilder || process.env.JUL196_CODEX_REAL_PROOF !== '1') throw new Error('real Codex builder proof requires explicit JUL196_CODEX_REAL_PROOF=1 and a Codex plan');
    } else if (process.env.JUL196_CLAUDE_QUOTA_BLOCKED === '1') throw new Error('Claude integration quota-blocked (JUL196_CLAUDE_QUOTA_BLOCKED=1)');
    return real('builder', request);
  }
  // NEVER use productionLauncher for reviewers in tests, regardless of plan.
  if (plan.interruptAction === `review:${request.round}`) await fixture(role, request);
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
