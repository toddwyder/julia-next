// Creates the GitHub App that runs the Shipping check on julia-next cards, through GitHub's
// public "app manifest" flow. The browser POSTs a manifest to GitHub, GitHub creates the app
// and redirects back here with a temporary code, and this server trades that code for the
// app's id, slug, client id, client secret and private key.
//
// The two secrets are written once, into a directory only this user can read, and never come
// back out: the pages, the log line per request and `check` name the app by its slug and id.
// The private key stays on this machine because the app signs its own JSON Web Tokens with it
// to call GitHub's API as itself.
//
// A state value ties the browser that saw the landing page to the callback that follows, so a
// page somewhere else cannot hand this server a code of its own choosing. It is single use,
// because a browser that reloads the callback must not convert a second app.
import { createSign, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GITHUB = 'https://github.com';
const API = 'https://api.github.com';
const REPOSITORY = `${GITHUB}/toddwyder/julia-next`;
const APP_NAME = 'Julia Runner';
const INSTALL_LABEL = `Install ${APP_NAME} on julia-next`;
const APP_FILE = 'app.json';
const KEY_FILE = 'private-key.pem';
const INSTALLATION_FILE = 'installation.json';
const STATUS_FILE = 'setup-status.json';
const DEFAULT_PORT = 4399;
const STATE_TTL = 10 * 60 * 1000;

// The shape every status write starts from: no step has happened yet, and a later write moves
// one field along. The callback is what makes `app: 'created'` and `credentials: 'saved'` true.
const EMPTY_STATUS = {
  app: null,
  credentials: null,
  installation: null,
  verified: false,
  login: null,
  errors: [],
  updated_at: null,
};

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ENTITIES[character]);
}

function unescapeHtml(value) {
  return String(value).replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => NAMED[name]);
}

function page({ title, body, script = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
</head>
<body>
<main>
${body}
</main>
${script}
</body>
</html>
`;
}

export function buildManifest({ origin }) {
  return {
    name: APP_NAME,
    url: REPOSITORY,
    description: 'Runs the Shipping check on julia-next cards and reports the verdict back to the pull request.',
    redirect_url: `${origin}/callback`,
    setup_url: `${origin}/setup`,
    public: false,
    default_permissions: {
      checks: 'write',
      statuses: 'write',
      pull_requests: 'write',
      contents: 'write',
      metadata: 'read',
    },
    default_events: [],
  };
}

export function landingHtml({ state, manifest }) {
  const action = `${GITHUB}/settings/apps/new?state=${encodeURIComponent(state)}`;
  const form = `<h1>Create the ${escapeHtml(APP_NAME)} app</h1>
<p>This page sends GitHub a manifest for the app, then comes straight back here with its credentials.</p>
<form id="manifest" method="post" action="${escapeHtml(action)}">
<input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest, null, 2))}">
<button type="submit">Create the ${escapeHtml(APP_NAME)} app</button>
</form>`;
  return page({
    title: `Create the ${APP_NAME} app`,
    body: form,
    script: '<script>document.getElementById("manifest").submit();</script>',
  });
}

export function stateFromLandingHtml(html) {
  const action = /<form[^>]+action="([^"]+)"/.exec(String(html))?.[1];
  if (!action) throw new Error('the landing page carries no form action');
  const state = new URL(unescapeHtml(action)).searchParams.get('state');
  if (!state) throw new Error('the landing page carries no state');
  return state;
}

export function conversionUrl(code) {
  return `${API}/app-manifests/${encodeURIComponent(code)}/conversions`;
}

const b64url = value => Buffer.from(value).toString('base64url');

export function createJwt({ appId, privateKey, now = Date.now() }) {
  const issued = Math.floor(now / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iat: issued - 60, exp: issued + 540, iss: appId }))}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(privateKey);
  return `${unsigned}.${signature.toString('base64url')}`;
}

async function githubJson(url, { jwt }) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${jwt}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${url} answered ${response.status}: ${answer.message ?? 'no message'}`);
  return answer;
}

export async function verifyCredentials({ appId, privateKey, now }) {
  const jwt = createJwt({ appId, privateKey, now });
  const [app, installations] = await Promise.all([
    githubJson(`${API}/app`, { jwt }),
    githubJson(`${API}/app/installations`, { jwt }),
  ]);
  return {
    app: { id: app.id, slug: app.slug, name: app.name, html_url: app.html_url },
    installations: (installations ?? []).map(({ id, account, repository_selection }) => ({ id, account, repository_selection })),
  };
}

// mkdirSync's mode is masked by the umask, so a directory this call makes is chmodded to the
// mode the secrets that go into it need.
function ensureDirectory(directory) {
  const created = !existsSync(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (created) chmodSync(directory, 0o700);
  return directory;
}

function writeSecret(path, contents) {
  writeFileSync(path, contents, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// Both files are written every time: a rerun leaves the key that matches the app whose id is in
// app.json, never a key from an app created earlier.
export function saveApp({ directory, conversion, now = Date.now() }) {
  ensureDirectory(directory);
  const appFile = join(directory, APP_FILE);
  const keyFile = join(directory, KEY_FILE);
  const app = {
    id: conversion.id,
    slug: conversion.slug,
    name: conversion.name,
    client_id: conversion.client_id,
    client_secret: conversion.client_secret,
    html_url: conversion.html_url,
    saved_at: new Date(now).toISOString(),
  };
  writeSecret(appFile, `${JSON.stringify(app, null, 2)}\n`);
  writeSecret(keyFile, conversion.pem);
  return { appFile, keyFile };
}

export function readApp({ directory }) {
  return readJson(join(directory, APP_FILE));
}

export function saveInstallation({ directory, installationId, now = Date.now() }) {
  ensureDirectory(directory);
  const file = join(directory, INSTALLATION_FILE);
  writeSecret(file, `${JSON.stringify({ installation_id: installationId, saved_at: new Date(now).toISOString() }, null, 2)}\n`);
  return file;
}

export function readInstallation({ directory }) {
  return readJson(join(directory, INSTALLATION_FILE));
}

export function saveStatus({ directory, status }) {
  ensureDirectory(directory);
  const merged = { ...EMPTY_STATUS, ...(readStatus({ directory }) ?? {}), ...status, updated_at: new Date().toISOString() };
  writeSecret(join(directory, STATUS_FILE), `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

export function readStatus({ directory }) {
  return readJson(join(directory, STATUS_FILE));
}

export function installLink(slug) {
  return `${GITHUB}/apps/${encodeURIComponent(slug)}/installations/new`;
}

export function statusHtml({ status, app }) {
  const installed = status.installation !== null && status.installation !== undefined;
  const line = (label, done, note) => `<li>${escapeHtml(label)}: <strong>${done ? 'Done' : 'Waiting'}</strong>${note ? ` ${escapeHtml(note)}` : ''}</li>`;
  const errors = (status.errors ?? []).length
    ? `<h2>Errors</h2>
<ul>
${status.errors.map(error => `<li>${escapeHtml(error)}</li>`).join('\n')}
</ul>`
    : '';
  const next = installed || !app?.slug ? '' : `<p><a href="${escapeHtml(installLink(app.slug))}">${escapeHtml(INSTALL_LABEL)}</a></p>`;
  return page({
    title: `${APP_NAME} setup`,
    body: `<h1>${escapeHtml(APP_NAME)} setup</h1>
<ul>
${line('App created', status.app === 'created', app?.slug ? `as ${app.slug}` : '')}
${line('Credentials saved', status.credentials === 'saved', app ? `${APP_FILE} and ${KEY_FILE}` : '')}
${line('Installed', installed, installed ? `installation ${status.installation}` : '')}
${line('Verified', status.verified === true, status.verified ? `as ${status.login ?? app?.slug ?? 'the app'}` : '')}
</ul>
${next}
${errors}`,
  });
}

function installHtml(slug) {
  return page({
    title: INSTALL_LABEL,
    body: `<h1>The credentials are saved</h1>
<p>${escapeHtml(APP_NAME)} holds its client id, client secret and private key in the directory this script was given.</p>
<a href="${escapeHtml(installLink(slug))}">${escapeHtml(INSTALL_LABEL)}</a>
<p>GitHub comes back to this server with the installation id once the app is installed.</p>`,
  });
}

function landing({ origin, states }) {
  const state = randomBytes(16).toString('hex');
  states.set(state, Date.now());
  return { status: 200, body: landingHtml({ state, manifest: buildManifest({ origin }) }), step: 'landing', ok: true };
}

async function callback({ url, directory, states }) {
  const state = url.searchParams.get('state');
  const issuedAt = states.get(state);
  states.delete(state);
  const code = url.searchParams.get('code');
  if (issuedAt === undefined || Date.now() - issuedAt > STATE_TTL || !code) {
    return {
      status: 400,
      body: page({ title: 'That setup link is not from this run', body: '<p>Open the landing page this script printed and create the app again.</p>' }),
      step: 'callback',
      ok: false,
      note: 'state unknown, expired or already used',
    };
  }
  const response = await fetch(conversionUrl(code), {
    method: 'POST',
    headers: { Accept: 'application/vnd.github+json' },
  });
  const conversion = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      status: 502,
      body: page({ title: 'GitHub refused the manifest', body: `<p>GitHub answered ${response.status}: ${escapeHtml(conversion.message ?? 'no message')}</p>` }),
      step: 'callback',
      ok: false,
      note: `conversion answered ${response.status}`,
    };
  }
  saveApp({ directory, conversion });
  saveStatus({ directory, status: { app: 'created', credentials: 'saved', installation: null, verified: false, login: null, errors: [] } });
  return { status: 200, body: installHtml(conversion.slug), step: 'callback', ok: true, note: `saved the credentials for ${conversion.slug}` };
}

async function setup({ url, directory }) {
  const given = url.searchParams.get('installation_id');
  const installationId = given && /^\d+$/.test(given) ? Number(given) : null;
  if (installationId !== null) saveInstallation({ directory, installationId });
  const saved = readApp({ directory });
  const errors = [];
  let verified = false;
  let login = null;
  let app = saved;
  if (!saved) {
    errors.push(`there is no ${APP_FILE} in ${directory}, so there are no credentials to verify`);
  } else {
    try {
      const result = await verifyCredentials({ appId: saved.id, privateKey: readFileSync(join(directory, KEY_FILE), 'utf8') });
      verified = true;
      login = result.app.slug;
      app = result.app;
    } catch (error) {
      errors.push(error.message);
    }
  }
  const status = { verified, login, errors };
  if (installationId !== null) status.installation = installationId;
  saveStatus({ directory, status });
  return {
    status: 200,
    body: statusHtml({ status: readStatus({ directory }) ?? EMPTY_STATUS, app }),
    step: 'setup',
    ok: errors.length === 0,
    note: verified ? `verified as ${login}` : errors.join('; '),
  };
}

function statusPage({ directory }) {
  return {
    status: 200,
    body: statusHtml({ status: readStatus({ directory }) ?? EMPTY_STATUS, app: readApp({ directory }) }),
    step: 'status',
    ok: true,
  };
}

function refused(pathname, why) {
  return {
    status: 404,
    body: page({ title: 'Not found', body: '<p>This server answers at /, /callback, /setup and /status.</p>' }),
    step: pathname,
    ok: false,
    note: why,
  };
}

async function handled({ request, url, origin, directory, states }) {
  if (request.method !== 'GET') return refused(url.pathname, `${request.method} has no route`);
  if (url.pathname === '/') return landing({ origin, states });
  if (url.pathname === '/callback') return callback({ url, directory, states });
  if (url.pathname === '/setup') return setup({ url, directory });
  if (url.pathname === '/status') return statusPage({ directory });
  return refused(url.pathname, 'no route');
}

export function createServer({ origin, directory }) {
  const states = new Map();
  return createHttpServer((request, response) => {
    const url = new URL(request.url ?? '/', origin);
    handled({ request, url, origin, directory, states })
      .catch(error => ({
        status: 500,
        body: page({ title: 'That step failed', body: `<p>${escapeHtml(error.message)}</p>` }),
        step: url.pathname,
        ok: false,
        note: error.message,
      }))
      .then(({ status, body, step, ok, note }) => {
        response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body) });
        response.end(body);
        console.log(JSON.stringify({ step, ok, ...(note ? { note } : {}) }));
      });
  });
}

function flags(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || value === undefined) throw new Error(`${flag ?? 'nothing'} is not a --name value pair`);
    options[flag.slice(2)] = value;
  }
  return options;
}

function defaultDirectory() {
  return process.env.JULIA_RUNNER_CONFIG_DIR ?? join(homedir(), '.config', 'julia-runner');
}

async function serve({ options, directory }) {
  const port = Number(options.port ?? DEFAULT_PORT);
  // The manifest URLs have to be the address the browser is on, so a run reached through the
  // tailnet says so here and a run on this machine can leave it out.
  const origin = (options.origin ?? `http://127.0.0.1:${port}`).replace(/\/+$/, '');
  const server = createServer({ origin, directory });
  await new Promise((done, fail) => {
    server.on('error', fail);
    server.listen(port, '127.0.0.1', done);
  });
  console.log(`Landing page: ${origin}/`);
}

export async function main(argv = process.argv.slice(2)) {
  const [mode = 'serve', ...rest] = argv;
  const options = flags(rest);
  const directory = options.directory ?? defaultDirectory();
  if (mode === 'serve') return serve({ options, directory });
  if (mode === 'status') {
    const status = readStatus({ directory });
    console.log(status ? JSON.stringify(status, null, 2) : `No setup has started in ${directory}.`);
    return;
  }
  if (mode === 'check') {
    const app = readApp({ directory });
    if (!app) throw new Error(`there is no ${APP_FILE} in ${directory}: run serve and create the app first`);
    const privateKey = readFileSync(join(directory, KEY_FILE), 'utf8');
    console.log(JSON.stringify(await verifyCredentials({ appId: app.id, privateKey }), null, 2));
    return;
  }
  throw new Error(`${mode} is not a mode: use serve, status or check`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
