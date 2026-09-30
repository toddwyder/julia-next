import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const app = resolve(process.argv[2] ?? '.');
const require = createRequire(resolve(app, 'package.json'));
const esmEntry = require.resolve('@mastra/auth-workos').replace(/\.cjs$/, '.js');
const { MastraAuthWorkos } = await import(pathToFileURL(esmEntry));

async function authenticate(organizationId, memberships) {
  const provider = new MastraAuthWorkos({
    apiKey: 'sk_fixture', clientId: 'client_fixture', fetchMemberships: true,
    session: { cookiePassword: 'fixture-password-at-least-32-characters' },
  });
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
assert.equal((await authenticate(undefined, [membership])).organizationId, 'org_fixture');
assert.equal((await authenticate('org_selected', [membership])).organizationId, 'org_selected');
assert.equal((await authenticate(undefined, [])).organizationId, undefined);
console.log('PASS: cookie authentication resolves one membership, preserves explicit choice, and leaves none unresolved');
