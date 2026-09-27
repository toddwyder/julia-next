import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run against an installed Factory app, never against Julia's dependencies.
const app = resolve(process.argv[2] ?? '.');
const require = createRequire(resolve(app, 'package.json'));
// Factory's ESM server loads index.js; require.resolve selects the CJS export.
const esmEntry = require.resolve('@mastra/auth-workos').replace(/\.cjs$/, '.js');
const { MastraAuthWorkos } = await import(pathToFileURL(esmEntry));

async function authenticate(organizationId, memberships) {
  const provider = new MastraAuthWorkos({
    apiKey: 'sk_fixture', clientId: 'client_fixture', fetchMemberships: true,
    session: { cookiePassword: 'fixture-password-at-least-32-characters' },
  });
  // External WorkOS/AuthKit responses only; provider resolution stays real.
  provider.authService.withAuth = async () => ({ auth: {
    user: { id: 'user_fixture', email: 'fixture@example.invalid' }, organizationId,
  } });
  provider.workos.userManagement.listOrganizationMemberships = async () => ({
    autoPagination: async () => memberships,
  });
  return provider.authenticateToken('', new Request('https://fixture.invalid', {
    headers: { cookie: 'wos_session=fixture' },
  }));
}

const membership = { organizationId: 'org_fixture', status: 'active' };
assert.equal((await authenticate(undefined, [membership])).organizationId, 'org_fixture',
  'Cookie caller must retain the organization of its single membership');
assert.equal((await authenticate('org_selected', [membership])).organizationId, 'org_selected',
  'Explicit session organization must win');
assert.equal((await authenticate(undefined, [])).organizationId, undefined);
assert.equal((await authenticate(undefined, [membership, {
  organizationId: 'org_other', status: 'active',
}])).organizationId, undefined, 'Ambiguous memberships must not choose a tenant');
console.log('PASS: cookie identity, explicit organization, no membership, ambiguous membership');
