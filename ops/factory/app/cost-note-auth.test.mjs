import assert from 'node:assert/strict';
import test from 'node:test';
import { costNoteAuth } from './src/mastra/cost-note-auth.ts';

test('cost-note token authenticates only read-only trace requests; WorkOS still handles people', async () => {
  const person = { id: 'person' };
  const workos = {
    authenticateToken: async token => token === 'person-token' ? person : null,
    authorizeUser: async user => user === person,
  };
  const auth = costNoteAuth(workos, 'test-cost-token');
  const request = (path, method = 'GET') => new Request(`http://localhost${path}`, { method });
  for (const path of ['/api/observability/traces/light', '/api/observability/traces/t/light', '/julia/cost-traces/t/spans/s']) {
    const user = await auth.authenticateToken('test-cost-token', request(path));
    assert.ok(user);
    assert.equal(await auth.authorizeUser(user, request(path)), true);
  }
  const fullSpan = request('/api/observability/traces/t/spans/s');
  const reader = await auth.authenticateToken('test-cost-token', fullSpan);
  assert.equal(await auth.authorizeUser(reader, fullSpan), false);
  const rawRequest = { raw: { method: 'GET', url: '/api/observability/traces/light' } };
  const rawUser = await auth.authenticateToken('test-cost-token', rawRequest);
  assert.equal(await auth.authorizeUser(rawUser, rawRequest), true);
  for (const [path, method] of [['/api/observability/traces', 'DELETE'], ['/api/agents/a/generate', 'POST'], ['/web/factory/projects', 'GET']]) {
    const user = await auth.authenticateToken('test-cost-token', request(path, method));
    assert.equal(await auth.authorizeUser(user, request(path, method)), false);
  }
  assert.equal(await auth.authenticateToken('wrong', request('/api/observability/traces/light')), null);
  const user = await auth.authenticateToken('person-token', request('/api/agents/a/generate', 'POST'));
  assert.equal(user, person);
  assert.equal(await auth.authorizeUser(user, request('/api/agents/a/generate', 'POST')), true);
  assert.equal(costNoteAuth(workos, ''), workos);
});
