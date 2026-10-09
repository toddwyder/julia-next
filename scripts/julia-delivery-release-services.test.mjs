import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseServices } from './julia-delivery-release-services.mjs';
import { saveJson } from './julia-delivery-state.mjs';
const commit = 'a'.repeat(40), base = 'b'.repeat(40), merged = 'c'.repeat(40);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'julia-release-')); t.after(() => rm(root, { recursive: true, force: true }));
  const handoffPath = join(root, 'handoff.json'); await saveJson(handoffPath, { candidate: { base } });
  const calls = []; let current = { id: 'old', url: 'old.example', projectId: 'project', readyState: 'READY', meta: { githubCommitSha: base } };
  const responses = { pr: { state: 'open', base: { ref: 'main', sha: base }, head: { sha: commit }, mergeable: true, mergeable_state: 'clean', draft: false }, protection: { required_status_checks: { strict: true }, enforce_admins: { enabled: true } }, checks: [{ name: 'windows', bucket: 'pass' }] };
  let deployments = []; let sleeps = 0;
  const options = { issueId: 'JUL-186', runPath: join(root, 'JUL-186.json'), configuration: { repository: 'o/r', projectId: 'project', productionUrl: 'https://prod.example' }, env: { VERCEL_TOKEN: 'fixture' }, pollAttempts: 2,
    sleep: async () => { sleeps++; },
    execute: (_command, args) => {
      calls.push(args);
      if (args[0] === 'pr' && args[1] === 'checks') return JSON.stringify(responses.checks);
      if (args.includes('repos/o/r/pulls/1')) return JSON.stringify(responses.pr);
      if (args.includes('repos/o/r/branches/main/protection')) return JSON.stringify(responses.protection);
      if (args.includes('repos/o/r/pulls/1/merge')) return JSON.stringify({ merged: true, sha: merged });
      if (args.some(arg => arg.includes('/git/commits/'))) return JSON.stringify({ tree: { sha: 'tree' } });
      throw Error('unexpected command');
    },
    fetchImpl: async (url, request) => {
      calls.push({ url: String(url), method: request.method });
      if (url.pathname.includes('/rollback/')) current = { ...current, id: 'old' };
      return { ok: true, json: async () => url.pathname === '/v7/deployments' ? { deployments } : current };
    },
  };
  return { services: releaseServices(options), responses, calls, handoffPath, deployments: value => { deployments = value; }, current: value => { current = value; }, sleeps: () => sleeps };
}
test('merge gate requires reviewed base, strict protection, admin enforcement and passing required checks', async t => {
  const f = await fixture(t), input = { commit, pr: { number: 1 }, handoffPath: f.handoffPath };
  assert.equal((await f.services.mergeGate(input)).pass, true);
  f.responses.pr.base.sha = merged; assert.equal((await f.services.mergeGate(input)).pass, false);
  f.responses.pr.base.sha = base; f.responses.protection.required_status_checks.strict = false; assert.equal((await f.services.mergeGate(input)).pass, false);
  f.responses.protection.required_status_checks.strict = true; f.responses.checks = []; assert.equal((await f.services.mergeGate(input)).pass, false);
});
test('merge uses PUT with candidate SHA and verifies resulting tree', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.services.merge({ commit, pr: { number: 1 } }), { commit: merged, treeMatches: true });
  assert.deepEqual(f.calls[0], ['api', '--method', 'PUT', 'repos/o/r/pulls/1/merge', '-f', `sha=${commit}`, '-f', 'merge_method=squash']);
});
test('production observation waits automatically and returns structured build failure', async t => {
  const f = await fixture(t);
  assert.equal(await f.services.production({ mergedCommit: merged }), null); assert.equal(f.sleeps(), 2);
  f.deployments([{ uid: 'failed', state: 'ERROR', created: 2, url: 'failed.example', meta: { githubCommitSha: merged } }]);
  const failed = await f.services.production({ mergedCommit: merged }); assert.equal(failed.failed, true); assert.equal(failed.id, 'failed');
});
test('latest deployment wins over an older failed attempt', async t => {
  const f = await fixture(t);
  f.deployments([{ uid: 'failed', state: 'ERROR', created: 1, meta: { githubCommitSha: merged } }, { uid: 'new', state: 'READY', created: 2, url: 'new.example', meta: { githubCommitSha: merged } }]);
  f.current({ id: 'new', url: 'new.example', projectId: 'project', readyState: 'READY', meta: { githubCommitSha: merged } });
  assert.equal((await f.services.production({ mergedCommit: merged })).id, 'new');
});
test('rollback refuses to replace unrelated production and recognizes prior deployment already serving', async t => {
  const f = await fixture(t);
  const input = { previous: { id: 'old' }, failed: { id: 'failed' } };
  assert.equal((await f.services.rollback(input)).pass, true);
  f.current({ id: 'unrelated', projectId: 'project' });
  assert.equal((await f.services.rollback(input)).pass, false);
  assert.equal(f.calls.some(call => call.method === 'POST'), false);
});
