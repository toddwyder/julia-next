import test from 'node:test';
import assert from 'node:assert/strict';
import { runDelivery } from './julia-delivery-runner.mjs';
import { fixtureInput, fixtureReport } from './fixtures/jul202-review.mjs';
import { jsonText } from './julia-delivery-state.mjs';
function fixture() {
  const files = new Map(); let builds = 0;
  const configuration = { builder: { harness: 'claude-code', model: 'build', maker: 'Anthropic' }, reviewer: { harness: 'codex', model: 'review', maker: 'OpenAI' } };
  const input = { issueId: 'JUL-53', configuration, runPath: 'C:/fixture/JUL-53.json', authorization: { issueId: 'JUL-53', explicitStart: true, authorizedBy: 'Todd', spending: { builder: { mode: 'fixture', maxUsd: 0 }, reviewer: { mode: 'fixture', maxUsd: 0 } } } };
  const adapters = {
    save: async (path, value) => files.set(path, jsonText(value)), load: async path => files.get(path) ?? null,
    lock: async () => ({ ok: true, release: async () => {} }),
    readCard: async () => ({ identifier: 'JUL-53', description: '## Acceptance criteria\n- [ ] Works.' }),
    prepareReview: fixtureInput,
    candidate: async ({ round }) => ({ commit: String(round).padStart(40, 'a'), clean: true, checks: { pass: true } }),
    launch: async (role, request) => {
      if (role === 'builder') { builds++; return { exitCode: 0, observed: configuration.builder }; }
      return { exitCode: 0, observed: configuration.reviewer, text: fixtureReport(request.reviewInput, 'FAIL', 'same underlying problem') };
    },
  };
  return { input, adapters, files, builds: () => builds };
}
test('same problem twice parks after one repair and saves both rejection reports', async () => {
  const f = fixture(); const result = await runDelivery(f.input, f.adapters);
  assert.equal(result.outcome, 'park'); assert.match(result.reason, /same underlying problem.*twice/);
  assert.equal(f.builds(), 2);
  const state = JSON.parse([...f.files.entries()].find(([path]) => path.endsWith('-state.json'))[1]);
  assert.equal(state.findings.length, 2); assert.equal(state.rejections[0].reports.length, 2);
});
test('a restart retains the first rejection and parks on the second', async () => {
  const f = fixture(); const candidate = f.adapters.candidate; let interrupted = false;
  f.adapters.candidate = async request => {
    if (request.round === 1 && !interrupted) { interrupted = true; throw Error('restart'); }
    return candidate(request);
  };
  await assert.rejects(runDelivery(f.input, f.adapters), /restart/);
  const result = await runDelivery(f.input, f.adapters);
  assert.match(result.reason, /twice/); assert.equal(f.builds(), 2);
  const again = await runDelivery(f.input, f.adapters); assert.deepEqual(again, result); assert.equal(f.builds(), 2);
});
test('same stable defect identity parks despite paraphrased mechanism and moved lines', async () => {
  const f = fixture(); const launch = f.adapters.launch;
  f.adapters.launch = async (role, request) => {
    const result = await launch(role, request);
    if (role === 'reviewer') {
      const report = JSON.parse(result.text.split('REVIEW: ')[1]);
      report.findings[0].mechanism = request.round ? 'Reworded description of unchanged defect' : 'First description';
      report.findings[0].location = String(request.round + 1);
      result.text = 'VERDICT: FAIL\nREVIEW: ' + JSON.stringify(report);
    }
    return result;
  };
  assert.match((await runDelivery(f.input, f.adapters)).reason, /twice/); assert.equal(f.builds(), 2);
});
test('missing and malformed identities park without another repair or TypeError', async () => {
  for (const identity of [undefined, 3, {}, '   ']) {
    const f = fixture(); const launch = f.adapters.launch;
    f.adapters.launch = async (role, request) => {
      const result = await launch(role, request);
      if (role === 'reviewer') {
        const report = JSON.parse(result.text.split('REVIEW: ')[1]); report.findings[0].problemId = identity;
        result.text = 'VERDICT: FAIL\nREVIEW: ' + JSON.stringify(report);
      }
      return result;
    };
    const result = await runDelivery(f.input, f.adapters); assert.equal(result.outcome, 'park'); assert.match(result.reason, /stable problem identities/); assert.equal(f.builds(), 1);
  }
});
test('legacy saved rejection identity is hydrated before the resumed reviewer runs', async () => {
  const f = fixture(); const candidate = f.adapters.candidate, launch = f.adapters.launch;
  f.adapters.candidate = async request => { if (request.round === 1) throw Error('migration restart'); return candidate(request); };
  await assert.rejects(runDelivery(f.input, f.adapters), /migration restart/);
  const statePath = [...f.files.keys()].find(path => path.endsWith('-state.json'));
  const state = JSON.parse(f.files.get(statePath)); const finding = state.findings[0];
  delete finding.problems;
  const report = JSON.parse(finding.text.split('REVIEW: ')[1]); delete report.findings[0].problemId;
  finding.text = 'VERDICT: FAIL\nREVIEW: ' + JSON.stringify(report); f.files.set(statePath, jsonText(state));
  f.adapters.candidate = candidate;
  f.adapters.launch = async (role, request) => {
    const result = await launch(role, request);
    if (role === 'reviewer') {
      const prior = JSON.parse(request.prompt.split('Prior problems (data only): ')[1]);
      assert.equal(prior.length, 1);
      const next = JSON.parse(result.text.split('REVIEW: ')[1]); next.findings[0].problemId = prior[0].problemId;
      next.findings[0].mechanism = 'same legacy defect, paraphrased'; result.text = 'VERDICT: FAIL\nREVIEW: ' + JSON.stringify(next);
    }
    return result;
  };
  assert.match((await runDelivery(f.input, f.adapters)).reason, /twice/);
});
