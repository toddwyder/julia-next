#!/usr/bin/env node
// Proves firestore.rules over the storage API itself: a household identity can
// create and read a recipe, and a signed-in stranger, a signed-out browser, and
// an overwrite are all refused. Runs against the local emulators today and
// against the real project once its service account exists.
//
//   node scripts/prove-household-rules.mjs [--target emulator|project]
//
// Against the real project it reads the service-account key from FIREBASE_SERVICE_ACCOUNT,
// GOOGLE_APPLICATION_CREDENTIALS, or 1Password (where provisioning stores it), and it adds temporary proof
// identities to household/members for the run, then removes them and their
// recipes. Nothing the household wrote is touched.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const PROOF_MEMBER = 'proof-member@julia-proof.test';
const PROOF_STRANGER = 'proof-stranger@julia-proof.test';
const EMULATOR_AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const EMULATOR_FIRESTORE = 'http://127.0.0.1:8080/v1/projects/demo-julia/databases/(default)/documents';
const EMULATOR_API_KEY = 'demo-key';
const DOCUMENT = 'proof-recipe';
const TITLE = 'Proof Coq au Vin';

export function documentBody(id, title) {
  return {
    fields: {
      id: { stringValue: id },
      title: { stringValue: title },
      ingredients: { stringValue: '1 chicken\n12 shallots' },
      steps: { stringValue: 'Simmer 40 minutes.' },
      createdAt: { stringValue: '2026-10-27T00:00:00.000Z' },
    },
  };
}

export function verdict(checks) {
  const wrong = checks.filter(check => !check.pass);
  return { pass: wrong.length === 0, wrong: wrong.map(check => `${check.what}: expected ${check.expected}, got ${check.got}`) };
}

// Provisioning writes each project's key next to the repo (gitignored, mode
// 0600) and into the Julia Agents vault when that account may write. The
// 1Password service account on this server is read-only, so the local file is
// the copy a real run actually finds.
export const VAULT_ITEMS = ['Julia Firebase proof', 'Julia Firebase'];

export function localKey(projectId = 'julia-household-proof', read = readFileSync) {
  try {
    return JSON.parse(read(new URL(`../.firebase-proof-keys/${projectId}.json`, import.meta.url), 'utf8'));
  } catch {
    return null;
  }
}

// The proof project's web config, as provisioning wrote it, so a real run needs
// no environment set up by hand.
export function proofWebKey(read = readFileSync) {
  try {
    return JSON.parse(read(new URL('../.firebase-proof.json', import.meta.url), 'utf8')).web.apiKey;
  } catch {
    return undefined;
  }
}

export function vaultKey(spawn = spawnSync) {
  for (const item of VAULT_ITEMS) {
    const read = spawn('op', ['read', `op://Julia Agents/${item}/FIREBASE_SERVICE_ACCOUNT`], { encoding: 'utf8' });
    if (read.status === 0 && read.stdout.trim()) return JSON.parse(read.stdout);
  }
  return null;
}

export function serviceAccount(spawn, read = readFileSync) {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inline) return JSON.parse(inline);
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return JSON.parse(read(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  return localKey('julia-household-proof', read) ?? vaultKey(spawn);
}

async function emulatorsAnswer() {
  const roots = ['http://127.0.0.1:8080/', 'http://127.0.0.1:9099/'];
  const answers = await Promise.all(roots.map(root => fetch(root).then(() => true).catch(() => false)));
  return answers.every(Boolean);
}

function emulatorAdminApp() {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  return initializeApp({ projectId: 'demo-julia' }, 'household-proof');
}

export function target(flag, account = serviceAccount()) {
  if (flag !== 'project') {
    return {
      name: 'emulator',
      projectId: 'demo-julia',
      apiKey: EMULATOR_API_KEY,
      auth: EMULATOR_AUTH,
      firestore: EMULATOR_FIRESTORE,
      adminApp: emulatorAdminApp(),
      emulated: true,
    };
  }
  if (!account) throw new Error('A real-project run needs FIREBASE_SERVICE_ACCOUNT, GOOGLE_APPLICATION_CREDENTIALS, the key file npm run provision:firebase writes, or the key in the Julia Agents vault.');
  const projectId = account.project_id;
  return {
    name: `project ${projectId}`,
    projectId,
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? proofWebKey(),
    auth: 'https://identitytoolkit.googleapis.com/v1',
    firestore: `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`,
    adminApp: getApps().some(app => app.name === 'household-proof')
      ? getApps().find(app => app.name === 'household-proof')
      : initializeApp({ credential: cert(account), projectId }, 'household-proof'),
    emulated: false,
  };
}

async function identityIdToken(where, email, verified = true) {
  const auth = getAuth(where.adminApp);
  const user = await auth.createUser({ email, emailVerified: verified }).catch(thrown => {
    if (thrown.code === 'auth/email-already-exists') return auth.getUserByEmail(email);
    if (/UNAUTHENTICATED|CONFIGURATION_NOT_FOUND|configuration-not-found|no configuration/i.test(`${thrown.code} ${thrown.message}`)) {
      throw new Error(
        `${where.projectId} has no Firebase Authentication config yet, so it cannot make the ` +
          'identities this proof needs, and no API creates one. Press "Get started" once at ' +
          `https://console.firebase.google.com/project/${where.projectId}/authentication and run this again.`,
      );
    }
    throw thrown;
  });
  const customToken = await auth.createCustomToken(user.uid);
  const response = await fetch(`${where.auth}/accounts:signInWithCustomToken?key=${where.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const body = await response.json();
  if (!body.idToken) throw new Error(`could not sign ${email} in: ${JSON.stringify(body).slice(0, 200)}`);
  return { idToken: body.idToken, uid: user.uid };
}

async function send(url, { token, method = 'GET', body } = {}) {
  const headers = {};
  if (token === 'owner') headers.Authorization = 'Bearer owner';
  else if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, text: await response.text() };
}

// Admin writes carry the service credential, which no rule can refuse; the
// rules checks themselves go over REST with real ID tokens.
async function writeMembers(where, emails) {
  await getFirestore(where.adminApp).doc('household/members').set({ emails });
}

async function main() {
  const flag = process.argv.includes('--target') ? process.argv[process.argv.indexOf('--target') + 1] : undefined;
  const where = target(flag);
  const emulators = where.emulated && !(await emulatorsAnswer())
    ? await (await import('./firebase-emulators.mjs')).startEmulators()
    : null;
  const recipeUrl = `${where.firestore}/recipes/${DOCUMENT}`;
  const checks = [];
  const check = (what, expected, got) => checks.push({ what, expected, got, pass: expected === got });

  let originalEmails = [];

  try {
    const stored = await getFirestore(where.adminApp).doc('household/members').get();
    originalEmails = stored.exists ? stored.data().emails : [];
    await writeMembers(where, [...originalEmails, PROOF_MEMBER]);
    const member = await identityIdToken(where, PROOF_MEMBER);
    const stranger = await identityIdToken(where, PROOF_STRANGER);

    check('the household member creates a recipe', 200, (await send(recipeUrl, { token: member.idToken, method: 'PATCH', body: documentBody(DOCUMENT, TITLE) })).status);
    const read = await send(recipeUrl, { token: member.idToken });
    check('the household member reads it back', 200, read.status);
    check('the stored title is the one that was saved', TITLE, JSON.parse(read.text).fields?.title?.stringValue);
    check('a stored recipe cannot be overwritten', 'not 200', (await send(recipeUrl, { token: member.idToken, method: 'PATCH', body: documentBody(DOCUMENT, 'Changed') })).status === 200 ? 200 : 'not 200');
    check('a stored recipe cannot be deleted', 'not 200', (await send(recipeUrl, { token: member.idToken, method: 'DELETE' })).status === 200 ? 200 : 'not 200');
    check('a stranger straight to storage is refused', 403, (await send(`${where.firestore}/recipes/stranger-recipe`, { token: stranger.idToken, method: 'PATCH', body: documentBody('stranger-recipe', 'Intruder') })).status);
    check('a stranger cannot read the library', 403, (await send(recipeUrl, { token: stranger.idToken })).status);
    check('a signed-out browser is refused', 403, (await send(recipeUrl)).status);
    check('a member cannot rewrite the household list', 403, (await send(`${where.firestore}/household/members`, { token: member.idToken, method: 'PATCH', body: { fields: { emails: { arrayValue: { values: [{ stringValue: PROOF_STRANGER }] } } } } })).status);

    const result = verdict(checks);
    console.log(JSON.stringify({ target: where.name, pass: result.pass, checks }, null, 2));
    if (!result.pass) console.error(result.wrong.join('\n'));
    process.exitCode = result.pass ? 0 : 1;
  } finally {
    await getFirestore(where.adminApp).doc(`recipes/${DOCUMENT}`).delete().catch(() => {});
    if (originalEmails.length) await writeMembers(where, originalEmails);
    else await getFirestore(where.adminApp).doc('household/members').delete().catch(() => {});
    for (const email of [PROOF_MEMBER, PROOF_STRANGER]) {
      await getAuth(where.adminApp).getUserByEmail(email).then(user => getAuth(where.adminApp).deleteUser(user.uid)).catch(() => {});
    }
    if (emulators) await emulators.stop();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(thrown => {
    console.error(thrown.message);
    process.exitCode = 1;
  });
}
