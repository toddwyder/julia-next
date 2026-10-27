// Sets up both Firebase projects for the household library.
//
// Two routes exist and this file uses both, in this order:
//
//   1. Your Google session makes the Cloud project, switches the APIs on, and
//      gives one service account inside it `roles/owner`.
//   2. That service account does the Firebase work. Google refuses
//      `projects.addFirebase` for a plain Google account with
//      `403 PERMISSION_DENIED` even when it owns the project, and allows it
//      for a service account in the same project in the same minute. Measured
//      on 2026-10-27 on both projects.
//
// Firebase Authentication is the one thing no API here can start: the admin
// config answers `404 CONFIGURATION_NOT_FOUND`, `accounts:signUp` answers
// `400 CONFIGURATION_NOT_FOUND`, Identity Platform's `initializeAuth` answers
// `400 BILLING_NOT_ENABLED`, and the published Identity Toolkit methods have
// no create. The Firebase console's "Get started" is what creates it, so this
// script says so and stops rather than guessing.
//
// Every step reads what already exists first, so a rerun after a failure
// finishes the rest instead of starting over.

import { createSign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { accessToken } from './firebase-session.mjs';

export const HOUSEHOLD = { id: 'julia-household-512904', displayName: 'Julia household' };
export const PROOF = { id: 'julia-household-proof', displayName: 'Julia household proof' };
export const HOUSEHOLD_EMAILS = ['toddwyder@gmail.com', 'katinawyder@gmail.com'];
// The two identities on the proof project's household list, and the third user
// who exists but is deliberately not on it: that is the identity the proof films
// being turned away.
export const PROOF_EMAILS = ['todd@household.test', 'katina@household.test'];
export const PROOF_USERS = [...PROOF_EMAILS, 'stranger@elsewhere.test'];
export const LOCATION = 'eur3';
export const AUTHORISED_DOMAIN = 'julia-next-hazel.vercel.app';
export const BOOTSTRAP_ACCOUNT = 'proof-agent';
export const BOOTSTRAP_ROLE = 'roles/owner';

const FIREBASE_API = 'https://firebase.googleapis.com/v1beta1';
const SERVICE_USAGE = 'https://serviceusage.googleapis.com/v1';
const IDENTITY_API = 'https://identitytoolkit.googleapis.com/admin/v2';
const IAM_API = 'https://iam.googleapis.com/v1';
const RESOURCE_MANAGER = 'https://cloudresourcemanager.googleapis.com/v1';
const FIRESTORE_API = 'https://firestore.googleapis.com/v1';
const RULES_API = 'https://firebaserules.googleapis.com/v1';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SDK_ROLES = ['roles/firebase.sdkAdminServiceAgent', 'roles/datastore.user', 'roles/firebaseauth.admin'];
const NEEDED_APIS = [
  'firebase.googleapis.com',
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'firebaserules.googleapis.com',
  'iam.googleapis.com',
];

const CONSOLE_AUTH = 'https://console.firebase.google.com/project';

async function google(url, { token, method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let answer = {};
  try {
    answer = text ? JSON.parse(text) : {};
  } catch {
    answer = { raw: text.slice(0, 200) };
  }
  return { status: response.status, ok: response.ok, answer };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function projectFrom(status, answer) {
  return status === 200 && answer?.projectId ? answer : null;
}

export async function firebaseProject(project, token) {
  const { status, answer } = await google(`${FIREBASE_API}/projects/${project.id}`, { token });
  return projectFrom(status, answer);
}

export async function gcpProject(project, token) {
  const { status, answer } = await google(`${RESOURCE_MANAGER}/projects/${project.id}`, { token });
  return projectFrom(status, answer);
}

async function pollOperation(address, token, { tries = 60, every = 5000 } = {}) {
  for (let waited = 0; waited < tries * every; waited += every) {
    const operation = await google(address, { token });
    if (operation.answer?.done) {
      if (operation.answer.error) throw new Error(`${operation.answer.error.message ?? JSON.stringify(operation.answer.error)}`);
      return operation.answer;
    }
    await sleep(every);
  }
  throw new Error(`the operation at ${address} did not finish`);
}

async function ensureApis(project, token) {
  const switched = [];
  for (const api of NEEDED_APIS) {
    const on = await google(`${SERVICE_USAGE}/projects/${project.id}/services/${api}`, { token });
    if (on.answer?.state === 'ENABLED') continue;
    const enabled = await google(`${SERVICE_USAGE}/projects/${project.id}/services/${api}:enable`, { token, method: 'POST', body: {} });
    if (!enabled.ok && enabled.status !== 409) {
      throw new Error(`could not switch ${api} on for ${project.id}: ${JSON.stringify(enabled.answer)}`);
    }
    switched.push(api);
  }
  return switched.length ? `switched on ${switched.join(', ')}` : 'already on';
}

export function jwtClaims(email, now) {
  return {
    iss: email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  };
}

const b64url = value => Buffer.from(value).toString('base64url');

export async function serviceAccountToken(key) {
  const claims = jwtClaims(key.client_email, Math.floor(Date.now() / 1000));
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key);
  const assertion = `${unsigned}.${signature.toString('base64url')}`;
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`the service account could not get a token: ${JSON.stringify(answer)}`);
  return answer.access_token;
}

async function grantRoles(project, token, email, roles) {
  const policy = await google(`${RESOURCE_MANAGER}/projects/${project.id}:getIamPolicy`, { token, method: 'POST', body: {} });
  const bindings = structuredClone(policy.answer.bindings ?? []);
  for (const role of roles) {
    const binding = bindings.find(entry => entry.role === role);
    const member = `serviceAccount:${email}`;
    if (!binding) bindings.push({ role, members: [member] });
    else if (!binding.members.includes(member)) binding.members.push(member);
  }
  const written = await google(`${RESOURCE_MANAGER}/projects/${project.id}:setIamPolicy`, {
    token,
    method: 'POST',
    body: { policy: { etag: policy.answer.etag, version: 1, bindings } },
  });
  if (!written.ok) throw new Error(`could not grant ${roles.join(', ')} to ${email}: ${JSON.stringify(written.answer)}`);
}

async function ensureServiceAccount(project, token, accountId) {
  const email = `${accountId}@${project.id}.iam.gserviceaccount.com`;
  const listed = await google(`${IAM_API}/projects/${project.id}/serviceAccounts`, { token });
  if (!(listed.answer.accounts ?? []).some(account => account.email === email)) {
    const created = await google(`${IAM_API}/projects/${project.id}/serviceAccounts`, {
      token,
      method: 'POST',
      body: { accountId, serviceAccount: { displayName: 'Julia proof agent' } },
    });
    if (!created.ok && created.status !== 409) throw new Error(`could not create ${email}: ${JSON.stringify(created.answer)}`);
    await sleep(15_000);
  }
  return email;
}

async function mintKey(project, token, email) {
  const key = await google(`${IAM_API}/projects/${project.id}/serviceAccounts/${email}/keys?keyAlgorithm=KEY_ALG_RSA_2048`, {
    token,
    method: 'POST',
  });
  if (!key.ok) throw new Error(`could not create a key for ${email}: ${JSON.stringify(key.answer)}`);
  return { name: key.answer.name, json: JSON.parse(Buffer.from(key.answer.privateKeyData, 'base64').toString('utf8')) };
}

// Freshly minted keys can answer `invalid_grant: Invalid JWT Signature` for a
// few seconds while Google publishes them, so the first exchange retries.
async function bootstrap(project, token) {
  const email = await ensureServiceAccount(project, token, BOOTSTRAP_ACCOUNT);
  await grantRoles(project, token, email, [BOOTSTRAP_ROLE]);
  const key = await mintKey(project, token, email);
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return { email, keyName: key.name, token: await serviceAccountToken(key.json) };
    } catch (thrown) {
      lastError = thrown;
      await sleep(10_000);
    }
  }
  throw lastError;
}

export async function ensureProject(project, token) {
  if (await firebaseProject(project, token)) return 'already there';
  if (!(await gcpProject(project, token))) {
    const created = await google(`${RESOURCE_MANAGER}/projects`, {
      token,
      method: 'POST',
      body: { projectId: project.id, name: project.displayName },
    });
    if (!created.ok) throw new Error(`could not create ${project.id}: ${JSON.stringify(created.answer)}`);
    await pollOperation(`${RESOURCE_MANAGER}/${created.answer.name}`, token, { tries: 60, every: 5000 });
  }
  await ensureApis(project, token);
  const agent = await bootstrap(project, token);
  try {
    const added = await google(`${FIREBASE_API}/projects/${project.id}:addFirebase`, {
      token: agent.token,
      method: 'POST',
      body: {},
    });
    if (!added.ok && added.status !== 409) {
      throw new Error(`could not make ${project.id} a Firebase project: ${JSON.stringify(added.answer)}`);
    }
    if (added.answer?.name) await pollOperation(`${FIREBASE_API}/${added.answer.name}`, agent.token, { tries: 60, every: 5000 });
    for (let waited = 0; waited < 240_000; waited += 5000) {
      if (await firebaseProject(project, token)) return 'created';
      await sleep(5000);
    }
    throw new Error(`${project.id} exists but Firebase does not answer for it yet`);
  } finally {
    await google(`${IAM_API}/${agent.keyName}`, { token, method: 'DELETE' });
  }
}

export async function ensureFirestore(project, token) {
  const listed = await google(`${FIRESTORE_API}/projects/${project.id}/databases`, { token });
  if ((listed.answer.databases ?? []).some(database => database.name.endsWith('/databases/(default)'))) return 'already there';
  const created = await google(
    `${FIRESTORE_API}/projects/${project.id}/databases?databaseId=${encodeURIComponent('(default)')}`,
    { token, method: 'POST', body: { locationId: LOCATION, type: 'FIRESTORE_NATIVE' } },
  );
  if (!created.ok && created.status !== 409) throw new Error(`could not create the database: ${JSON.stringify(created.answer)}`);
  if (created.answer?.name) await pollOperation(`${FIRESTORE_API}/${created.answer.name}`, token, { tries: 60, every: 5000 });
  return 'created';
}

export async function ensureWebApp(project, token) {
  const existing = await google(`${FIREBASE_API}/projects/${project.id}/webApps`, { token });
  let apps = existing.answer.apps ?? [];
  if (!apps.length) {
    const created = await google(`${FIREBASE_API}/projects/${project.id}/webApps`, {
      token,
      method: 'POST',
      body: { displayName: 'julia-web' },
    });
    if (!created.ok && created.status !== 409) throw new Error(`could not register a web app: ${JSON.stringify(created.answer)}`);
    if (created.answer?.name) await pollOperation(`${FIREBASE_API}/${created.answer.name}`, token, { tries: 40, every: 3000 });
    apps = (await google(`${FIREBASE_API}/projects/${project.id}/webApps`, { token })).answer.apps ?? [];
  }
  const config = await google(`${FIREBASE_API}/projects/${project.id}/webApps/${apps[0].appId}/config`, { token });
  if (!config.ok) throw new Error(`could not read the web config: ${JSON.stringify(config.answer)}`);
  return config.answer;
}

function authNotStarted(project, answer) {
  return new Error(
    `${project.id} has no sign-in config yet, and no API creates one: ${JSON.stringify(answer)}. ` +
      `Open ${CONSOLE_AUTH}/${project.id}/authentication and press "Get started", once.`,
  );
}

export async function ensureAuthorisedDomain(project, token, domain = AUTHORISED_DOMAIN) {
  const config = await google(`${IDENTITY_API}/projects/${project.id}/config`, { token });
  if (!config.ok) throw authNotStarted(project, config.answer);
  const domains = config.answer.authorizedDomains ?? [];
  if (domains.includes(domain)) return 'already there';
  const patched = await google(`${IDENTITY_API}/projects/${project.id}/config?updateMask=authorizedDomains`, {
    token,
    method: 'PATCH',
    body: { authorizedDomains: [...domains, domain] },
  });
  if (!patched.ok) throw new Error(`could not authorise ${domain}: ${JSON.stringify(patched.answer)}`);
  return 'authorised';
}

export async function removeAuthorisedDomain(project, token, domain) {
  if (domain === AUTHORISED_DOMAIN) throw new Error(`${domain} is Julia's own address; it stays authorised`);
  const config = await google(`${IDENTITY_API}/projects/${project.id}/config`, { token });
  if (!config.ok) throw authNotStarted(project, config.answer);
  const domains = config.answer.authorizedDomains ?? [];
  if (!domains.includes(domain)) return 'already gone';
  const patched = await google(`${IDENTITY_API}/projects/${project.id}/config?updateMask=authorizedDomains`, {
    token,
    method: 'PATCH',
    body: { authorizedDomains: domains.filter(entry => entry !== domain) },
  });
  if (!patched.ok) throw new Error(`could not remove ${domain}: ${JSON.stringify(patched.answer)}`);
  return 'removed';
}

export async function ensurePasswordSignIn(project, token) {
  const config = await google(`${IDENTITY_API}/projects/${project.id}/config`, { token });
  if (!config.ok) throw authNotStarted(project, config.answer);
  if (config.answer.signIn?.email?.enabled) return 'already enabled';
  const patched = await google(
    `${IDENTITY_API}/projects/${project.id}/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired`,
    { token, method: 'PATCH', body: { signIn: { email: { enabled: true, passwordRequired: true } } } },
  );
  if (!patched.ok) throw new Error(`could not enable email sign-in: ${JSON.stringify(patched.answer)}`);
  return 'enabled';
}

// Google sign-in needs an OAuth web client, and the console is what makes one:
// the provider call answers `INVALID_CONFIG : client_id cannot be empty`, and
// the OAuth route (IAP) answers `Project must belong to an organization`.
export async function ensureGoogleSignIn(project, token) {
  const path = `${IDENTITY_API}/projects/${project.id}/defaultSupportedIdpConfigs`;
  const listed = await google(`${path}?pageSize=100`, { token });
  if (!listed.ok) throw authNotStarted(project, listed.answer);
  const googleIdp = (listed.answer.defaultSupportedIdpConfigs ?? []).find(config => config.name.endsWith('/google.com'));
  if (googleIdp) {
    if (googleIdp.enabled) return 'already enabled';
    const patched = await google(`${path}/google.com?updateMask=enabled`, { token, method: 'PATCH', body: { enabled: true } });
    if (!patched.ok) throw new Error(`could not enable Google sign-in: ${JSON.stringify(patched.answer)}`);
    return 'enabled';
  }
  const created = await google(`${path}?idpId=google.com`, { token, method: 'POST', body: { enabled: true } });
  if (created.ok) return 'enabled';
  throw new Error(
    `Google sign-in on ${project.id} needs the console once: creating the provider needs an OAuth client id ` +
      `(${JSON.stringify(created.answer)}). Open ${CONSOLE_AUTH}/${project.id}/authentication/providers and switch ` +
      'Google on; the console creates the client. After that this step is a one-line PATCH.',
  );
}

export function rulesBody(content, name = 'firestore.rules') {
  return { source: { files: [{ name, content }] } };
}

export async function deployRules(project, token, rules = readFileSync(fileURLToPath(new URL('../firestore.rules', import.meta.url)), 'utf8')) {
  const created = await google(`${RULES_API}/projects/${project.id}/rulesets`, { token, method: 'POST', body: rulesBody(rules) });
  if (!created.ok) throw new Error(`could not create a ruleset for ${project.id}: ${JSON.stringify(created.answer)}`);
  const releaseName = `projects/${project.id}/releases/cloud.firestore`;
  const released = await google(`${RULES_API}/${releaseName}`, { token });
  if (released.ok) {
    const patched = await google(`${RULES_API}/${releaseName}?updateMask=rulesetName`, {
      token,
      method: 'PATCH',
      body: { release: { name: releaseName, rulesetName: created.answer.name } },
    });
    if (!patched.ok) throw new Error(`could not release the rules for ${project.id}: ${JSON.stringify(patched.answer)}`);
  } else {
    const made = await google(`${RULES_API}/projects/${project.id}/releases`, {
      token,
      method: 'POST',
      body: { name: releaseName, rulesetName: created.answer.name },
    });
    if (!made.ok) throw new Error(`could not release the rules for ${project.id}: ${JSON.stringify(made.answer)}`);
  }
  return 'released';
}

export function membersBody(emails) {
  return { fields: { emails: { arrayValue: { values: emails.map(email => ({ stringValue: email })) } } } };
}

// The membership list is readable by the household and writable by nobody in
// the browser (firestore.rules), so it is written from outside the app.
export async function seedMembers(project, token, emails) {
  const written = await google(
    `${FIRESTORE_API}/projects/${project.id}/databases/(default)/documents/household/members`,
    { token, method: 'PATCH', body: membersBody(emails) },
  );
  if (!written.ok) throw new Error(`could not write household/members for ${project.id}: ${JSON.stringify(written.answer)}`);
  return `listed ${emails.length}`;
}

// One live key per role: old keys are removed first so a rerun cannot leave a
// pile of working credentials behind, and the key this run returns stays valid.
export async function ensureServiceAccountKey(project, token) {
  const email = await ensureServiceAccount(project, token, 'julia-app');
  await grantRoles(project, token, email, SDK_ROLES);
  const listed = await google(`${IAM_API}/projects/${project.id}/serviceAccounts/${email}/keys`, { token });
  for (const key of listed.answer.keys ?? []) {
    if (key.keyType === 'USER_MANAGED') await google(`${IAM_API}/${key.name}`, { token, method: 'DELETE' });
  }
  const key = await mintKey(project, token, email);
  return key.json;
}

export function vaultItemFor(project) {
  return project.id === PROOF.id ? 'Julia Firebase proof' : 'Julia Firebase';
}

// 1Password refuses a PASSWORD item without a password, so the key lives in a
// secure note with one concealed field, which `op read
// op://Julia Agents/<item>/FIREBASE_SERVICE_ACCOUNT` still resolves.
export function vaultTemplate(title, keyJson) {
  return {
    title,
    category: 'SECURE_NOTE',
    vault: { name: 'Julia Agents' },
    fields: [{ id: 'firebase_service_account', type: 'CONCEALED', label: 'FIREBASE_SERVICE_ACCOUNT', value: keyJson }],
  };
}

export function storeInVault(project, keyJson) {
  const title = vaultItemFor(project);
  const template = fileURLToPath(new URL(`../.firebase-vault-${project.id}.json`, import.meta.url));
  writeFileSync(template, JSON.stringify(vaultTemplate(title, keyJson), null, 2));
  chmodSync(template, 0o600);
  try {
    const existing = spawnSync('op', ['item', 'get', title, '--vault', 'Julia Agents', '--format', 'json'], { encoding: 'utf8' });
    const command = existing.status === 0
      ? ['item', 'edit', title, '--vault', 'Julia Agents', '--template', template]
      : ['item', 'create', '--template', template];
    const run = spawnSync('op', command, { encoding: 'utf8' });
    if (run.status !== 0) {
      // This server's 1Password account can read the vault but not write it.
      // The key still lands in the gitignored key file, so nothing is lost.
      if (/permission/i.test(run.stderr)) return 'this server keeps the key, the 1Password account is read-only';
      throw new Error(`could not store the key in 1Password: ${run.stderr.trim()}`);
    }
    return existing.status === 0 ? 'replaced in 1Password' : 'stored in 1Password';
  } finally {
    rmSync(template, { force: true });
  }
}

export function webConfigBody(web) {
  return `// Written by scripts/provision-firebase.mjs. These values identify the
// household project to browsers; access is decided by firestore.rules.
export const HOUSEHOLD_WEB_CONFIG = {
  apiKey: ${JSON.stringify(web.apiKey)},
  authDomain: ${JSON.stringify(web.authDomain)},
  projectId: ${JSON.stringify(web.projectId)},
  appId: ${JSON.stringify(web.appId)},
};
`;
}

export async function main() {
  const token = await accessToken();
  const summary = {};

  summary.householdProject = await ensureProject(HOUSEHOLD, token);
  summary.householdDatabase = await ensureFirestore(HOUSEHOLD, token);
  const householdWeb = await ensureWebApp(HOUSEHOLD, token);
  summary.householdRules = await deployRules(HOUSEHOLD, token);
  summary.householdMembers = await seedMembers(HOUSEHOLD, token, HOUSEHOLD_EMAILS);

  summary.proofProject = await ensureProject(PROOF, token);
  summary.proofDatabase = await ensureFirestore(PROOF, token);
  const proofWeb = await ensureWebApp(PROOF, token);
  summary.proofRules = await deployRules(PROOF, token);
  summary.proofMembers = await seedMembers(PROOF, token, PROOF_EMAILS);
  const proofKey = await ensureServiceAccountKey(PROOF, token);
  const keyFile = fileURLToPath(new URL(`../.firebase-proof-keys/${PROOF.id}.json`, import.meta.url));
  mkdirSync(dirname(keyFile), { recursive: true });
  writeFileSync(keyFile, JSON.stringify(proofKey, null, 2));
  chmodSync(keyFile, 0o600);
  summary.proofKey = keyFile;
  summary.vault = storeInVault(PROOF, JSON.stringify(proofKey));

  writeFileSync(
    fileURLToPath(new URL('../lib/firebase-household-config.js', import.meta.url)),
    webConfigBody(householdWeb),
  );
  writeFileSync(
    fileURLToPath(new URL('../.firebase-proof.json', import.meta.url)),
    JSON.stringify({ web: {
      apiKey: proofWeb.apiKey,
      authDomain: proofWeb.authDomain,
      projectId: proofWeb.projectId,
      appId: proofWeb.appId,
    } }, null, 2),
  );
  summary.wrote = ['lib/firebase-household-config.js', '.firebase-proof.json'];

  // Sign-in is the one part no API starts. Report it as the next step rather
  // than failing the whole run: everything above is done and verified.
  summary.signIn = {};
  for (const [label, project, step] of [
    ['householdGoogleSignIn', HOUSEHOLD, () => ensureGoogleSignIn(HOUSEHOLD, token)],
    ['householdDomain', HOUSEHOLD, () => ensureAuthorisedDomain(HOUSEHOLD, token)],
    ['proofPasswordSignIn', PROOF, () => ensurePasswordSignIn(PROOF, token)],
    ['proofDomain', PROOF, () => ensureAuthorisedDomain(PROOF, token)],
  ]) {
    try {
      summary.signIn[label] = await step();
    } catch (thrown) {
      summary.signIn[label] = `not yet: ${thrown.message}`;
      break;
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(thrown => {
    console.error(thrown.message);
    process.exitCode = 1;
  });
}
