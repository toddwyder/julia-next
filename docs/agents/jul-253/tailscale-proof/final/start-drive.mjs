import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire('/home/ubuntu/julia-jul-253/ops/mastra-agents/reviewer/package.json');
const { chromium } = require('playwright');
const expectedBaseCommit = process.argv[2];
const evidence = process.argv[3];
const url = 'https://ovh.tail91f394.ts.net/julia-control';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1365, height: 1100 } });
const page = await context.newPage();
const consoleEntries = [];
const pageErrors = [];
const network = [];

page.on('console', message => consoleEntries.push({ type: message.type(), text: message.text() }));
page.on('pageerror', error => pageErrors.push(String(error)));
page.on('response', response => {
  if (response.url().startsWith(url)) {
    network.push({ url: response.url(), method: response.request().method(), status: response.status() });
  }
});

try {
  await page.goto(url, { waitUntil: 'networkidle' });
  const stateResponse = await context.request.get(`${url}/api/state`);
  assert.equal(stateResponse.ok(), true);
  const state = await stateResponse.json();
  const index = state.cards.findIndex(entry => entry.card.identifier === 'JUL-255' && entry.admitted);
  assert.ok(index >= 0);
  await writeFile(`${evidence}/state-before-start.json`, JSON.stringify(state, null, 2));
  await page.locator('select[name="card"]').selectOption(String(index));
  for (const [label, value] of [
    ['Orchestrator', 'openai-codex::gpt-6-sol'],
    ['Coder', 'commandcode::deepseek/deepseek-v4.1-flash'],
  ]) {
    const field = page.locator('fieldset').filter({ has: page.locator('legend', { hasText: label }) });
    await field.locator('select').first().selectOption(value);
    await field.locator('select').nth(1).selectOption('medium');
  }
  await page.screenshot({ path: `${evidence}/start-selected.png`, fullPage: true });
  const waiting = page.waitForResponse(
    response => response.request().method() === 'POST' && response.url() === `${url}/api/start`,
    { timeout: 60000 },
  );
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const response = await waiting;
  const body = await response.json();
  await writeFile(
    `${evidence}/start-response.json`,
    JSON.stringify({ url: response.url(), status: response.status(), body }, null, 2),
  );
  assert.equal(response.status(), 200);
  assert.equal(body.build.state, 'running');
  assert.equal(body.snapshot.card.identifier, 'JUL-255');
  assert.equal(body.snapshot.roles.orchestrator.route, 'openai-codex');
  assert.equal(body.snapshot.roles.orchestrator.modelId, 'gpt-6-sol');
  assert.equal(body.snapshot.roles.coder.route, 'commandcode');
  assert.equal(body.snapshot.roles.coder.modelId, 'deepseek/deepseek-v4.1-flash');
  assert.equal(body.build.baseCommit, expectedBaseCommit);
  await page.screenshot({ path: `${evidence}/start-running.png`, fullPage: true });
  process.stdout.write(`${JSON.stringify({
    runId: body.runId,
    workerPid: body.build.workerPid,
    worktree: body.build.worktree,
    baseCommit: body.build.baseCommit,
    roles: body.snapshot.roles,
  })}\n`);
} finally {
  await writeFile(
    `${evidence}/start-browser.json`,
    JSON.stringify({ url, consoleEntries, pageErrors, network }, null, 2),
  );
  await context.close();
  await browser.close();
}
