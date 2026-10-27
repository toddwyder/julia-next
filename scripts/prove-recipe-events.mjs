// Proves a deliberately failed recipe save is visible in Sentry and in Axiom.
// Run through Julia's keys: node scripts/julia-agents.mjs -- node scripts/prove-recipe-events.mjs
import { spawn } from 'node:child_process';

const NEEDED = ['AXIOM_TOKEN', 'AXIOM_DATASET', 'SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'];
const SPEC = '.agents/skills/verify-julia/tests/recipes.spec.mjs';
const SAVE_FAILURE = 'a save that cannot reach the library says so, keeps the form, and is reported';
const SENTRY_MESSAGE = 'recipe save failed';
const TIMEOUT_MS = 120_000;

export function axiomQuery(dataset, since) {
  return `['${dataset}'] | where _time >= datetime("${since}") and event == "julia-next.recipes" and action == "save" and outcome == "failed" | project _time, action, outcome, code`;
}

// Axiom's legacy rows carry the event's fields under `data`.
export function axiomFailure(rows) {
  const found = rows
    .map(entry => ({ at: entry._time, ...(entry.data ?? entry) }))
    .find(entry => entry.outcome === 'failed');
  return found ? { status: 'found', at: found.at, code: found.code ?? null } : { status: 'missing' };
}

export function sentryFailure(issues, since) {
  const issue = issues.find(entry => entry.title?.includes(SENTRY_MESSAGE) && entry.lastSeen >= since);
  return issue
    ? { status: 'found', title: issue.title, lastSeen: issue.lastSeen, count: issue.count, link: issue.permalink }
    : { status: 'missing' };
}

async function check(name, run) {
  if (!process.env[name]) throw new Error(`${name} is not set; run through: node scripts/julia-agents.mjs -- node scripts/prove-recipe-events.mjs`);
  return run();
}

async function question(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.json();
}

function runSaveFailure() {
  return new Promise(resolve => {
    const child = spawn('npx', ['--no-install', 'playwright', 'test', SPEC, '-g', SAVE_FAILURE, '--reporter=line'], { stdio: 'inherit', env: process.env });
    child.on('exit', code => resolve(code));
  });
}

async function axiomRows(since) {
  const end = new Date().toISOString();
  const body = await check('AXIOM_TOKEN', () => question('https://api.axiom.co/v1/datasets/_apl?format=legacy', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.AXIOM_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ apl: axiomQuery(process.env.AXIOM_DATASET, since), startTime: since, endTime: end }),
  }));
  return body.matches ?? body.rows ?? [];
}

async function sentryIssues() {
  const url = `https://sentry.io/api/0/projects/${process.env.SENTRY_ORG}/${process.env.SENTRY_PROJECT}/issues/?query=${encodeURIComponent(SENTRY_MESSAGE)}&statsPeriod=24h`;
  return check('SENTRY_AUTH_TOKEN', () => question(url, { headers: { Authorization: `Bearer ${process.env.SENTRY_AUTH_TOKEN}` } }));
}

async function receipts(since) {
  const deadline = Date.now() + TIMEOUT_MS;
  let axiom = { status: 'missing' };
  let sentry = { status: 'missing' };
  while (Date.now() < deadline && (axiom.status === 'missing' || sentry.status === 'missing')) {
    if (axiom.status === 'missing') axiom = axiomFailure(await axiomRows(since).catch(() => []));
    if (sentry.status === 'missing') sentry = sentryFailure(await sentryIssues().catch(() => []), since);
    if (axiom.status === 'missing' || sentry.status === 'missing') await new Promise(done => setTimeout(done, 5000));
  }
  return { axiom, sentry };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const missing = NEEDED.filter(name => !process.env[name]);
  if (missing.length) {
    console.error(`Missing ${missing.join(', ')}. Run through: node scripts/julia-agents.mjs -- node scripts/prove-recipe-events.mjs`);
    process.exit(2);
  }
  const since = new Date(Date.now() - 30_000).toISOString();
  console.log(`Failing a save on purpose since ${since}`);
  const exitCode = await runSaveFailure();
  const proof = { since, spec: SAVE_FAILURE, playwrightExit: exitCode, ...(await receipts(since)) };
  console.log(JSON.stringify(proof, null, 2));
  if (exitCode !== 0) console.error('The blocked save did not run as the spec expects.');
  if (proof.axiom.status !== 'found' || proof.sentry.status !== 'found') console.error('Sentry or Axiom has no record of the failed save.');
  process.exit(exitCode === 0 && proof.axiom.status === 'found' && proof.sentry.status === 'found' ? 0 : 1);
}
