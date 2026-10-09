import test from 'node:test';
import assert from 'node:assert/strict';
import { continueRelease } from './julia-delivery-release.mjs';

const commit = 'a'.repeat(40);
function fixture() {
  let state; const calls = [];
  const services = {
    load: async () => state && structuredClone(state),
    save: async value => { state = structuredClone(value); },
    verify: async () => true,
    publish: async () => { calls.push('publish'); return { number: 3, url: 'https://github.com/o/r/pull/3' }; },
    preview: async () => ({ id: 'preview', url: 'https://preview.example', commit, ready: true }),
    mergeGate: async () => ({ pass: true, head: commit, previous: { id: 'old', url: 'https://old.example' } }),
    merge: async () => { calls.push('merge'); return { commit: 'b'.repeat(40) }; },
    production: async () => ({ id: 'new', url: 'https://prod.example', commit: 'b'.repeat(40), ready: true }),
    smoke: async () => ({ pass: true }),
    rollback: async () => { calls.push('rollback'); return { pass: true }; },
  };
  const input = { issueId: 'JUL-1', commit, handoffPath: 'handoff', worktree: { path: 'work', branch: 'card' }, configuration: { repository: 'o/r', projectId: 'project', productionUrl: 'https://prod.example' } };
  const decision = { decision: 'accept', issueId: 'JUL-1', commit, previewId: 'preview', previewUrl: 'https://preview.example', decidedBy: 'Todd' };
  return { services, input, decision, calls, state: () => state };
}
test('preview waits for UAT; resume merges once and checks production', async () => {
  const f = fixture();
  assert.equal((await continueRelease(f.input, f.services)).outcome, 'awaiting-uat');
  assert.deepEqual(f.calls, ['publish']);
  assert.equal((await continueRelease({ ...f.input, decision: f.decision }, f.services)).outcome, 'released');
  await continueRelease({ ...f.input, decision: f.decision }, f.services);
  assert.deepEqual(f.calls, ['publish', 'merge']);
});
test('UAT for another commit cannot merge', async () => {
  const f = fixture(); await continueRelease(f.input, f.services);
  assert.equal((await continueRelease({ ...f.input, decision: { ...f.decision, commit: 'c'.repeat(40) } }, f.services)).outcome, 'park');
  assert.deepEqual(f.calls, ['publish']);
});
test('head drift and failed CI block the merge', async () => {
  for (const gate of [{ pass: true, head: 'c'.repeat(40) }, { pass: false, head: commit }]) {
    const f = fixture(); await continueRelease(f.input, f.services);
    f.services.mergeGate = async () => gate;
    assert.equal((await continueRelease({ ...f.input, decision: f.decision }, f.services)).outcome, 'park');
    assert.deepEqual(f.calls, ['publish']);
  }
});
test('failed production smoke rolls back and retains failure evidence', async () => {
  const f = fixture(); await continueRelease(f.input, f.services);
  f.services.smoke = async () => ({ pass: false, reason: 'home broken' });
  assert.equal((await continueRelease({ ...f.input, decision: f.decision }, f.services)).outcome, 'rolled-back');
  assert.equal(f.state().smoke.reason, 'home broken');
  assert.deepEqual(f.calls, ['publish', 'merge', 'rollback']);
});
test('ambiguous merge is parked on restart instead of being repeated', async () => {
  const f = fixture(); await continueRelease(f.input, f.services);
  f.services.merge = async () => { f.calls.push('merge'); throw Error('disconnected'); };
  await assert.rejects(continueRelease({ ...f.input, decision: f.decision }, f.services));
  assert.equal((await continueRelease({ ...f.input, decision: f.decision }, f.services)).outcome, 'park');
  assert.deepEqual(f.calls, ['publish', 'merge']);
});
test('failed production build is recorded and recovered without running a browser on it', async () => {
  const f = fixture(); await continueRelease(f.input, f.services);
  f.services.production = async () => ({ id: 'failed', commit: 'b'.repeat(40), ready: true, failed: true, reason: 'build ERROR' });
  f.services.smoke = () => assert.fail('failed build has no browser target');
  assert.equal((await continueRelease({ ...f.input, decision: f.decision }, f.services)).outcome, 'rolled-back');
  assert.equal(f.state().smoke.reason, 'build ERROR');
});
test('a mismatched merge waits for its actual deployment before rollback, even when old production still serves', async () => {
  const f = fixture(); await continueRelease(f.input, f.services);
  f.services.merge = async () => ({ commit: 'b'.repeat(40), treeMatches: false });
  f.services.production = async () => null;
  assert.equal((await continueRelease({ ...f.input, decision: f.decision }, f.services)).outcome, 'awaiting-production');
  assert.deepEqual(f.calls, ['publish']);
  f.services.production = async () => ({ id: 'bad-tree', commit: 'b'.repeat(40), ready: true });
  f.services.rollback = async ({ failed }) => { assert.equal(failed.id, 'bad-tree'); f.calls.push('rollback'); return { pass: true }; };
  f.services.smoke = () => assert.fail('tree mismatch cannot be approved by browser smoke');
  assert.equal((await continueRelease({ ...f.input, decision: f.decision }, f.services)).outcome, 'rolled-back');
  assert.deepEqual(f.calls, ['publish', 'rollback']);
});
