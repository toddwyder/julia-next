// Sets up both Firebase projects from one approved Google session, so the only
// thing a human does is approve the login. Every step checks what already
// exists, so running this again after a failure finishes the rest.

import { spawnSync } from 'node:child_process';
import { chmodSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { accessToken } from './firebase-session.mjs';

export const HOUSEHOLD = { id: 'julia-household', displayName: 'Julia household' };
export const PROOF = { id: 'julia-household-proof', displayName: 'Julia household proof' };
export const HOUSEHOLD_EMAILS = ['toddwyder@gmail.com', 'katinawyder@gmail.com'];
export const PROOF_EMAILS = ['todd@household.test', 'katina@household.test', 'stranger@elsewhere.test'];
export const LOCATION = 'eur3';
export const AUTHORISED_DOMAIN = 'julia-next.vercel.app';

const CLI = fileURLToPath(new URL('../node_modules/.bin/firebase', import.meta.url));
const FIREBASE_API = 'https://firebase.googleapis.com/v1beta1';
const IDENTITY_API = 'https://identitytoolkit.googleapis.com/admin/v2';
const IAM_API = 'https://iam.googleapis.com/v1';
const RESOURCE_MANAGER = 'https://cloudresourcemanager.googleapis.com/v1';
const FIRESTORE_API = 'https://firestore.googleapis.com/v1';
const SDK_ROLES = ['roles/firebase.sdkAdminServiceAgent', 'roles/datastore.user', 'roles/firebaseauth.admin'];

async function google(url, { token, method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const answer = text ? JSON.parse(text) : {};
  return { status: response.status, ok: response.ok, answer };
}

function cli(args) {
  const run = spawnSync(CLI, [...args, '--non-interactive'], { encoding: 'utf8' });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
  if (run.status !== 0) throw new Error(`firebase ${args.join(' ')} failed:\n${output}`);
  return output;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function firebaseProject(project, token) {
  const { status, answer } = await google(`${FIREBASE_API}/projects/${project.id}`, { token });
  return status === 404 ? null : answer;
}

export async function ensureProject(project, token) {
  if (await firebaseProject(project, token)) return 'already there';
  cli(['projects:create', project.id, '--display-name', project.displayName]);
  for (let waited = 0; waited < 180_000; waited += 5000) {
    if (await firebaseProject(project, token)) return 'created';
    await sleep(5000);
  }
  throw new Error(`${project.id} was created but Firebase does not answer for it yet`);
}

export async function ensureFirestore(project, token) {
  const { answer } = await google(`${FIRESTORE_API}/projects/${project.id}/databases`, { token });
  if ((answer.databases ?? []).some(database => database.name.endsWith('/databases/(default)'))) return 'already there';
  cli(['firestore:databases:create', '(default)', '--location', LOCATION, '--project', project.id]);
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
    if (created.answer.name) {
      for (let waited = 0; waited < 120_000; waited += 3000) {
        const operation = await google(`${FIREBASE_API}/${created.answer.name}`, { token });
        if (operation.answer.done) break;
        await sleep(3000);
      }
    }
    apps = (await google(`${FIREBASE_API}/projects/${project.id}/webApps`, { token })).answer.apps ?? [];
  }
  const config = await google(`${FIREBASE_API}/projects/${project.id}/webApps/${apps[0].appId}/config`, { token });
  if (!config.ok) throw new Error(`could not read the web config: ${JSON.stringify(config.answer)}`);
  return config.answer;
}

export async function ensureGoogleSignIn(project, token) {
  const path = `${IDENTITY_API}/projects/${project.id}/defaultSupportedIdpConfigs`;
  const listed = await google(`${path}?pageSize=100`, { token });
  const googleIdp = (listed.answer.defaultSupportedIdpConfigs ?? []).find(config => config.name.endsWith('/google.com'));
  if (!googleIdp) {
    const created = await google(`${path}?idpId=google.com`, { token, method: 'POST', body: { enabled: true } });
    if (!created.ok) throw new Error(`could not enable Google sign-in: ${JSON.stringify(created.answer)}`);
    return 'enabled';
  }
  if (googleIdp.enabled) return 'already enabled';
  const patched = await google(`${path}/google.com?updateMask=enabled`, { token, method: 'PATCH', body: { enabled: true } });
  if (!patched.ok) throw new Error(`could not enable Google sign-in: ${JSON.stringify(patched.answer)}`);
  return 'enabled';
}

export async function ensurePasswordSignIn(project, token) {
  const config = await google(`${IDENTITY_API}/projects/${project.id}/config`, { token });
  if (!config.ok) throw new Error(`could not read the sign-in config: ${JSON.stringify(config.answer)}`);
  if (config.answer.signIn?.email?.enabled) return 'already enabled';
  const patched = await google(
    `${IDENTITY_API}/projects/${project.id}/config?updateMask=signIn.email.enabled,signIn.email.passwordRequired`,
    { token, method: 'PATCH', body: { signIn: { email: { enabled: true, passwordRequired: true } } } },
  );
  if (!patched.ok) throw new Error(`could not enable email sign-in: ${JSON.stringify(patched.answer)}`);
  return 'enabled';
}

export async function ensureAuthorisedDomain(project, token, domain = AUTHORISED_DOMAIN) {
  const config = await google(`${IDENTITY_API}/projects/${project.id}/config`, { token });
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

export async function ensureServiceAccountKey(project, token) {
  const email = `julia-app@${project.id}.iam.gserviceaccount.com`;
  const listed = await google(`${IAM_API}/projects/${project.id}/serviceAccounts`, { token });
  if (!(listed.answer.accounts ?? []).some(account => account.email === email)) {
    const created = await google(`${IAM_API}/projects/${project.id}/serviceAccounts`, {
      token,
      method: 'POST',
      body: { accountId: 'julia-app', serviceAccount: { displayName: 'Julia app' } },
    });
    if (!created.ok && created.status !== 409) throw new Error(`could not create ${email}: ${JSON.stringify(created.answer)}`);
  }
  await grantRoles(project, token, email);
  const key = await google(`${IAM_API}/projects/${project.id}/serviceAccounts/${email}/keys?keyAlgorithm=KEY_ALG_RSA_2048`, {
    token,
    method: 'POST',
  });
  if (!key.ok) throw new Error(`could not create a key for ${email}: ${JSON.stringify(key.answer)}`);
  return JSON.parse(Buffer.from(key.answer.privateKeyData, 'base64').toString('utf8'));
}

async function grantRoles(project, token, email) {
  const policy = await google(`${RESOURCE_MANAGER}/projects/${project.id}:getIamPolicy`, { token, method: 'POST', body: {} });
  const bindings = policy.answer.bindings ?? [];
  for (const role of SDK_ROLES) {
    const binding = bindings.find(entry => entry.role === role);
    if (!binding) bindings.push({ role, members: [`serviceAccount:${email}`] });
    else if (!binding.members.includes(`serviceAccount:${email}`)) binding.members.push(`serviceAccount:${email}`);
  }
  const written = await google(`${RESOURCE_MANAGER}/projects/${project.id}:setIamPolicy`, {
    token,
    method: 'POST',
    body: { policy: { ...policy.answer, bindings } },
  });
  if (!written.ok) throw new Error(`could not grant roles to ${email}: ${JSON.stringify(written.answer)}`);
}

export function membersBody(emails) {
  return { fields: { emails: { arrayValue: { values: emails.map(email => ({ stringValue: email })) } } } };
}

// The membership list is readable by the household and writable by nobody in
// the browser (firestore.rules), so it is written over the Google API with the
// approved session's own token instead of through a service account.
export async function seedMembers(project, token, emails) {
  const written = await google(
    `${FIRESTORE_API}/projects/${project.id}/databases/(default)/documents/household/members`,
    { token, method: 'PATCH', body: membersBody(emails) },
  );
  if (!written.ok) throw new Error(`could not write household/members for ${project.id}: ${JSON.stringify(written.answer)}`);
  return `listed ${emails.length}`;
}

export function deployRules(project) {
  cli(['deploy', '--only', 'firestore:rules', '--project', project.id]);
  return 'deployed';
}

export function vaultItemFor(project) {
  return project.id === PROOF.id ? 'Julia Firebase proof' : 'Julia Firebase';
}

export function storeInVault(project, keyJson) {
  const title = vaultItemFor(project);
  const template = fileURLToPath(new URL(`../.firebase-vault-${project.id}.json`, import.meta.url));
  writeFileSync(template, JSON.stringify({
    title,
    category: 'PASSWORD',
    vault: { name: 'Julia Agents' },
    fields: [{ id: 'firebase_service_account', type: 'CONCEALED', label: 'FIREBASE_SERVICE_ACCOUNT', value: keyJson }],
  }, null, 2));
  chmodSync(template, 0o600);
  try {
    const existing = spawnSync('op', ['item', 'get', title, '--vault', 'Julia Agents', '--format', 'json'], { encoding: 'utf8' });
    const command = existing.status === 0
      ? ['item', 'edit', title, '--vault', 'Julia Agents', '--template', template]
      : ['item', 'create', '--template', template];
    const run = spawnSync('op', command, { encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`could not store the key in 1Password: ${run.stderr.trim()}`);
    return existing.status === 0 ? 'replaced in 1Password' : 'stored in 1Password';
  } finally {
    rmSync(template, { force: true });
  }
}

export async function main() {
  const token = await accessToken();
  const summary = {};

  summary.householdProject = await ensureProject(HOUSEHOLD, token);
  summary.householdDatabase = await ensureFirestore(HOUSEHOLD, token);
  summary.householdGoogleSignIn = await ensureGoogleSignIn(HOUSEHOLD, token);
  summary.householdDomain = await ensureAuthorisedDomain(HOUSEHOLD, token);
  const householdWeb = await ensureWebApp(HOUSEHOLD, token);
  summary.householdRules = deployRules(HOUSEHOLD);
  summary.householdMembers = await seedMembers(HOUSEHOLD, token, HOUSEHOLD_EMAILS);

  summary.proofProject = await ensureProject(PROOF, token);
  summary.proofDatabase = await ensureFirestore(PROOF, token);
  summary.proofPasswordSignIn = await ensurePasswordSignIn(PROOF, token);
  const proofWeb = await ensureWebApp(PROOF, token);
  summary.proofRules = deployRules(PROOF);
  summary.proofMembers = await seedMembers(PROOF, token, PROOF_EMAILS);
  const proofKey = await ensureServiceAccountKey(PROOF, token);
  summary.vault = storeInVault(PROOF, JSON.stringify(proofKey));

  writeFileSync(
    fileURLToPath(new URL('../lib/firebase-household-config.js', import.meta.url)),
    `// Written by scripts/provision-firebase.mjs. These values identify the
// household project to browsers; access is decided by firestore.rules.
export const HOUSEHOLD_WEB_CONFIG = {\n`
    + `  apiKey: ${JSON.stringify(householdWeb.apiKey)},\n`
    + `  authDomain: ${JSON.stringify(householdWeb.authDomain)},\n`
    + `  projectId: ${JSON.stringify(householdWeb.projectId)},\n`
    + `  appId: ${JSON.stringify(householdWeb.appId)},\n};\n`,
  );
  writeFileSync(
    fileURLToPath(new URL('../.firebase-proof.json', import.meta.url)),
    JSON.stringify({ web: { apiKey: proofWeb.apiKey, authDomain: proofWeb.authDomain, projectId: proofWeb.projectId, appId: proofWeb.appId } }, null, 2),
  );
  summary.wrote = ['lib/firebase-household-config.js', '.firebase-proof.json'];

  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(thrown => {
    console.error(thrown.message);
    process.exitCode = 1;
  });
}
