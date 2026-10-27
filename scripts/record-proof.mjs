// Records the proof the card asks for on the proof project: two household
// identities in two separate browser sessions, and a third identity turned away
// both by the app and by storage itself. The household project is never used.
//
// Needs .firebase-proof.json (written by scripts/provision-firebase.mjs) and
// Playwright's chromium. Videos land in .proof/, one per session.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import { chromium, expect } from '@playwright/test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PROOF_CONFIG = fileURLToPath(new URL('../.firebase-proof.json', import.meta.url));
const OUT = fileURLToPath(new URL('../.proof/', import.meta.url));
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts:';
const LIBRARY_KEY = 'julia.recipes.v1';

export const EMAILS = { todd: 'todd@household.test', katina: 'katina@household.test', stranger: 'stranger@elsewhere.test' };

export const SEEDED = [
  { id: 'proof-b1', title: 'Tarte Tatin', ingredients: '6 apples\n120 g butter', steps: 'Caramelise.\nBake upside down.', createdAt: '2026-10-01T09:00:00.000Z' },
  { id: 'proof-b2', title: 'Pot au Feu', ingredients: '1 kg beef shin\n4 carrots', steps: 'Simmer three hours.', createdAt: '2026-10-02T09:00:00.000Z' },
];

const SAVED = { title: 'Coq au Vin', ingredients: '1 free-range chicken\n12 shallots\n2 tbsp butter', steps: 'Brown the bird in the butter.\nSimmer 40 minutes.\nRest, then carve.' };

export function proofConfig(json) {
  const web = json?.web;
  if (!web?.apiKey || !web.projectId) throw new Error('.firebase-proof.json does not hold a web config; run node scripts/provision-firebase.mjs first');
  return web;
}

export function password() {
  return randomBytes(18).toString('base64url');
}

// A project with no Firebase Authentication config refuses every identity call
// until someone presses "Get started" in the console once. Say that, rather than
// passing Google's body through.
export function identityFailure(projectId, email, body) {
  if (/CONFIGURATION_NOT_FOUND/.test(body)) {
    return (
      `${projectId} has no Firebase Authentication config yet, so ${email} cannot sign in and no API creates one. ` +
      `Press "Get started" once at https://console.firebase.google.com/project/${projectId}/authentication, then run this again.`
    );
  }
  return `could not get a token for ${email}: ${body}`;
}

export async function idToken(apiKey, email, pass, projectId = 'the proof project') {
  const create = await fetch(`${IDENTITY}signUp?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: pass, returnSecureToken: true }),
  });
  if (create.ok) return (await create.json()).idToken;
  const signIn = await fetch(`${IDENTITY}signInWithPassword?key=${apiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: pass, returnSecureToken: true }),
  });
  if (!signIn.ok) throw new Error(identityFailure(projectId, email, await signIn.text()));
  return (await signIn.json()).idToken;
}

export function recipeUrl(projectId, id) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/recipes/${id}`;
}

/** Writes a recipe straight into storage as the holder of the token, the way a stranger's script would. */
export async function storageWrite(projectId, token, id) {
  const response = await fetch(recipeUrl(projectId, id), {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      fields: {
        id: { stringValue: id },
        title: { stringValue: 'Intruder Pie' },
        ingredients: { stringValue: 'nothing good' },
        steps: { stringValue: 'do not bake' },
        createdAt: { stringValue: new Date().toISOString() },
      },
    }),
  });
  return response.status;
}

export async function storageRead(projectId, token, id) {
  const response = await fetch(recipeUrl(projectId, id), { headers: { authorization: `Bearer ${token}` } });
  return response.status;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startApp(web) {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn('npx', ['--no-install', 'next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_FIREBASE_API_KEY: web.apiKey,
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: web.authDomain,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: web.projectId,
      NEXT_PUBLIC_FIREBASE_APP_ID: web.appId,
    },
  });
  for (let waited = 0; waited < 180_000; waited += 1000) {
    try {
      if ((await fetch(url)).ok) return { url, stop: () => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} } };
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('the app never answered');
}

/** Puts a line of real text on the page so the video shows the status someone got. */
async function showOnPage(page, text) {
  await page.evaluate(line => {
    const box = document.createElement('div');
    box.setAttribute('data-proof-line', '');
    box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;padding:16px;background:#111;color:#fff;font:16px monospace;z-index:99999';
    box.textContent = line;
    document.body.append(box);
  }, text);
}

async function signInAsProofUser(page, email, pass) {
  await page.getByLabel('Test user email').fill(email);
  await page.getByLabel('Test user password').fill(pass);
  await page.getByRole('button', { name: 'Sign in as a test user' }).click();
}

export async function main() {
  if (!existsSync(PROOF_CONFIG)) throw new Error('no .firebase-proof.json; run node scripts/provision-firebase.mjs first');
  const web = proofConfig(JSON.parse(readFileSync(PROOF_CONFIG, 'utf8')));
  mkdirSync(OUT, { recursive: true });
  const videos = `${OUT}videos/`;
  mkdirSync(videos, { recursive: true });

  const pass = password();
  const tokens = {};
  for (const [who, email] of Object.entries(EMAILS)) tokens[who] = await idToken(web.apiKey, email, pass, web.projectId);

  const app = await startApp(web);
  const browser = await chromium.launch();
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
  const clips = [];

  async function session(name, run) {
    const context = await browser.newContext({ recordVideo: { dir: videos, size: { width: 1280, height: 800 } }, viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const video = page.video();
    try {
      await run(page);
    } finally {
      await context.close();
      const saved = await video?.path().catch(() => null);
      if (saved) clips.push({ name, video: saved });
    }
  }

  try {
    await session('todd', async page => {
      await page.goto(`${app.url}/`);
      await page.evaluate(([key, value]) => localStorage.setItem(key, value), [LIBRARY_KEY, JSON.stringify({ version: 1, recipes: SEEDED })]);
      await page.goto(`${app.url}/recipes`);
      await signInAsProofUser(page, EMAILS.todd, pass);
      await expect(page.getByText(`Signed in as ${EMAILS.todd}`)).toBeVisible({ timeout: 60_000 });
      for (const recipe of SEEDED) await expect(page.getByText(recipe.title)).toBeVisible();
      const left = await page.evaluate(key => localStorage.getItem(key), LIBRARY_KEY);
      check('browser recipes arrive online and the browser copy goes', left === null, left === null ? 'browser storage empty' : `browser still holds ${left}`);

      await page.goto(`${app.url}/recipes/new`);
      await page.getByLabel('Recipe Title').fill(SAVED.title);
      await page.getByLabel('Ingredients').fill(SAVED.ingredients);
      await page.getByLabel('Instructions').fill(SAVED.steps);
      await page.getByRole('button', { name: 'Save Recipe' }).click();
      await page.waitForURL(/\/recipes\/(?!new$)[^/]+$/, { timeout: 60_000 });
      await expect(page.getByText(SAVED.title)).toBeVisible();
      writeFileSync(`${OUT}recipe-url.txt`, page.url());
    });

    const savedUrl = readFileSync(`${OUT}recipe-url.txt`, 'utf8').trim();
    const savedId = savedUrl.split('/').pop();

    await session('katina', async page => {
      await page.goto(`${app.url}/recipes`);
      await signInAsProofUser(page, EMAILS.katina, pass);
      await expect(page.getByText(`Signed in as ${EMAILS.katina}`)).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(SAVED.title)).toBeVisible();
      await page.getByText(SAVED.title).click();
      const shown = await page.evaluate(() => ({
        title: document.querySelector('[data-testid="recipe-title"]')?.textContent ?? null,
        lines: [...document.querySelectorAll('[data-testid="recipe-ingredients"] > *, [data-testid="recipe-steps"] > *')].map(row => row.textContent.trim()).filter(Boolean),
      }));
      const wanted = [...SAVED.ingredients.split('\n'), ...SAVED.steps.split('\n')];
      const exact = shown.title === SAVED.title && JSON.stringify(shown.lines) === JSON.stringify(wanted);
      check('the recipe opens exactly as typed on the other identity', exact, exact ? savedUrl : JSON.stringify(shown));
    });

    await session('stranger', async page => {
      await page.goto(`${app.url}/recipes`);
      await signInAsProofUser(page, EMAILS.stranger, pass);
      await expect(page.getByText(`${EMAILS.stranger} is not part of this household`)).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole('button', { name: 'Use another Google account' })).toBeVisible();
      const read = await storageRead(web.projectId, tokens.stranger, savedId);
      const write = await storageWrite(web.projectId, tokens.stranger, 'intruder-pie');
      await showOnPage(page, `direct storage request as ${EMAILS.stranger}: read ${read}, write ${write}`);
      check('storage refuses the turned-away identity reading', read === 403, `status ${read}`);
      check('storage refuses the turned-away identity writing', write === 403, `status ${write}`);
      const member = await storageRead(web.projectId, tokens.todd, savedId);
      check('storage serves the same document to a household identity', member === 200, `status ${member}`);
    });
  } finally {
    await browser.close();
    app.stop();
  }

  const receipt = { project: web.projectId, at: new Date().toISOString(), checks, clips };
  writeFileSync(`${OUT}receipt.json`, JSON.stringify(receipt, null, 2));
  for (const entry of checks) console.log(`${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}${entry.detail ? ` (${entry.detail})` : ''}`);
  console.log(`videos in ${videos}`);
  if (checks.some(entry => !entry.ok)) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(thrown => {
    console.error(thrown.message);
    process.exitCode = 1;
  });
}
