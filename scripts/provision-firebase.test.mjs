import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ensureAuthorisedDomain,
  ensureGoogleSignIn,
  ensurePasswordSignIn,
  ensureServiceAccountKey,
  membersBody,
} from './provision-firebase.mjs';

const HOUSEHOLD = { id: 'julia-household', displayName: 'Julia household' };
const realFetch = globalThis.fetch;

function stub(routes) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const call = { url, method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : undefined };
    calls.push(call);
    const route = routes.find(entry => call.url.startsWith(entry.startsWith) && (!entry.method || entry.method === call.method));
    if (!route) throw new Error(`unexpected request: ${call.method} ${call.url}`);
    return new Response(JSON.stringify(route.answer ?? {}), { status: route.status ?? 200 });
  };
  return calls;
}

test('Google sign-in is created on a project that has no provider yet, and a second run writes nothing', async () => {
  let calls = stub([
    { startsWith: 'https://identitytoolkit.googleapis.com/admin/v2/projects/julia-household/defaultSupportedIdpConfigs?pageSize=100', answer: {} },
    {
      startsWith: 'https://identitytoolkit.googleapis.com/admin/v2/projects/julia-household/defaultSupportedIdpConfigs?idpId=google.com',
      method: 'POST',
      answer: { name: 'projects/julia-household/defaultSupportedIdpConfigs/google.com', enabled: true },
    },
  ]);
  try {
    assert.equal(await ensureGoogleSignIn(HOUSEHOLD, 'token'), 'enabled');
    assert.equal(calls[1].body.enabled, true);
  } finally {
    globalThis.fetch = realFetch;
  }

  calls = stub([
    {
      startsWith: 'https://identitytoolkit.googleapis.com/admin/v2/projects/julia-household/defaultSupportedIdpConfigs?pageSize=100',
      answer: {
        defaultSupportedIdpConfigs: [
          { name: 'projects/julia-household/defaultSupportedIdpConfigs/google.com', enabled: true },
        ],
      },
    },
  ]);
  try {
    assert.equal(await ensureGoogleSignIn(HOUSEHOLD, 'token'), 'already enabled');
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('authorising the preview keeps the domains already on the project', async () => {
  const calls = stub([
    {
      startsWith: 'https://identitytoolkit.googleapis.com/admin/v2/projects/julia-household/config',
      method: 'GET',
      answer: { authorizedDomains: ['julia-household.firebaseapp.com', 'localhost'] },
    },
    {
      startsWith: 'https://identitytoolkit.googleapis.com/admin/v2/projects/julia-household/config?updateMask=authorizedDomains',
      method: 'PATCH',
      answer: { authorizedDomains: ['julia-household.firebaseapp.com', 'localhost', 'julia-next.vercel.app'] },
    },
  ]);
  try {
    assert.equal(await ensureAuthorisedDomain(HOUSEHOLD, 'token'), 'authorised');
    assert.deepEqual(calls[1].body, {
      authorizedDomains: ['julia-household.firebaseapp.com', 'localhost', 'julia-next.vercel.app'],
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the proof project gets password sign-in, and a configured project is left alone', async () => {
  const project = { id: 'julia-household-proof', displayName: 'Julia household proof' };
  let calls = stub([
    {
      startsWith: 'https://identitytoolkit.googleapis.com/admin/v2/projects/julia-household-proof/config',
      method: 'GET',
      answer: { signIn: { email: { enabled: false } } },
    },
    {
      startsWith:
        'https://identitytoolkit.googleapis.com/admin/v2/projects/julia-household-proof/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired',
      method: 'PATCH',
      answer: { signIn: { email: { enabled: true, passwordRequired: true } } },
    },
  ]);
  try {
    assert.equal(await ensurePasswordSignIn(project, 'token'), 'enabled');
    assert.deepEqual(calls[1].body, { signIn: { email: { enabled: true, passwordRequired: true } } });
  } finally {
    globalThis.fetch = realFetch;
  }

  calls = stub([
    {
      startsWith: 'https://identitytoolkit.googleapis.com/admin/v2/projects/julia-household-proof/config',
      method: 'GET',
      answer: { signIn: { email: { enabled: true, passwordRequired: true } } },
    },
  ]);
  try {
    assert.equal(await ensurePasswordSignIn(project, 'token'), 'already enabled');
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a service-account key is minted with the roles the rules proof needs, keeping other bindings', async () => {
  const privateKey = { project_id: 'julia-household-proof', private_key: 'not-a-real-key' };
  const calls = stub([
    {
      startsWith:
        'https://iam.googleapis.com/v1/projects/julia-household-proof/serviceAccounts/julia-app@julia-household-proof.iam.gserviceaccount.com/keys',
      method: 'POST',
      answer: { privateKeyData: Buffer.from(JSON.stringify(privateKey)).toString('base64') },
    },
    {
      startsWith: 'https://iam.googleapis.com/v1/projects/julia-household-proof/serviceAccounts',
      method: 'GET',
      answer: { accounts: [] },
    },
    {
      startsWith: 'https://iam.googleapis.com/v1/projects/julia-household-proof/serviceAccounts',
      method: 'POST',
      answer: { email: 'julia-app@julia-household-proof.iam.gserviceaccount.com' },
    },
    {
      startsWith: 'https://cloudresourcemanager.googleapis.com/v1/projects/julia-household-proof:getIamPolicy',
      method: 'POST',
      answer: {
        version: 1,
        etag: 'BwXyz',
        bindings: [{ role: 'roles/owner', members: ['user:todd@example.com'] }],
      },
    },
    {
      startsWith: 'https://cloudresourcemanager.googleapis.com/v1/projects/julia-household-proof:setIamPolicy',
      method: 'POST',
      answer: {},
    },
  ]);
  try {
    assert.deepEqual(await ensureServiceAccountKey({ id: 'julia-household-proof' }, 'token'), privateKey);
    assert.equal(calls[1].body.accountId, 'julia-app');
    const policy = calls[3].body.policy;
    assert.equal(policy.etag, 'BwXyz');
    assert.deepEqual(policy.bindings[0], { role: 'roles/owner', members: ['user:todd@example.com'] });
    assert.deepEqual(
      policy.bindings.slice(1).map(binding => binding.role),
      ['roles/firebase.sdkAdminServiceAgent', 'roles/datastore.user', 'roles/firebaseauth.admin'],
    );
    assert.ok(policy.bindings.slice(1).every(binding => binding.members.length === 1));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the household list is written as the array of emails the rules check', () => {
  assert.deepEqual(membersBody(['toddwyder@gmail.com', 'katinawyder@gmail.com']), {
    fields: {
      emails: { arrayValue: { values: [{ stringValue: 'toddwyder@gmail.com' }, { stringValue: 'katinawyder@gmail.com' }] } },
    },
  });
});
