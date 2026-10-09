import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from './route.js';
test('controlled application error is disabled by default and only an exact secret can trigger it', async t => {
  const previous = process.env.JULIA_OBSERVABILITY_PROOF_TOKEN;
  t.after(() => { if (previous == null) delete process.env.JULIA_OBSERVABILITY_PROOF_TOKEN; else process.env.JULIA_OBSERVABILITY_PROOF_TOKEN = previous; });
  delete process.env.JULIA_OBSERVABILITY_PROOF_TOKEN;
  const request = token => new Request('https://example/api/observability-proof', { method: 'POST', headers: token ? { 'x-julia-proof-token': token } : {} });
  assert.equal((await POST(request('fixture'))).status, 404);
  process.env.JULIA_OBSERVABILITY_PROOF_TOKEN = 'fixture';
  assert.equal((await POST(request())).status, 404); assert.equal((await POST(request('other'))).status, 404);
  await assert.rejects(POST(request('fixture')), /controlled application error proof/);
});
