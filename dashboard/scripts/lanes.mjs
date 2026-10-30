// Thirteen live lanes: the Start screen controls, a slow-start guard, and the account rows. Each lane
// boots its own server and state folder, then clicks every control the way a person does on a phone
// or desktop.
// Run one lane: node scripts/lanes.mjs 3
// Drive an address that is already running (the one handed to Todd): node scripts/lanes.mjs --url http://host:4313
//
// Two rules learned on 29 October, both about a lane proving the wrong thing:
// a lane that drives a stale .next passes code that is not the code under review, and a lane that
// starts its own 127.0.0.1 server says nothing about the address a person was given.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const LANES = '/tmp/jul-284-lanes';
// A --url run proves someone else's build, so its screenshots must not overwrite the ones this
// branch ships for its own build.
const SHOTS = process.argv.includes('--url') ? '/tmp/jul-284-lanes/live' : join(ROOT, 'docs/scorecards/jul-276/pr-4');
const MODELS = '/var/lib/julia-dashboard/state/models.json';
const PORT_BASE = 3114;
const CARD = 'JUL-280';

// What `next build` compiles. Anything here newer than .next/BUILD_ID means the build on disk is
// not this source, so a lane would prove the old behaviour (that is how a reverted duplicate-model
// fix still passed until a rebuild).
const SOURCE_DIRS = ['app', 'lib'];
const SOURCE_FILES = ['server.js', 'next.config.mjs'];

function staleBuildReason() {
  const buildId = join(ROOT, '.next/BUILD_ID');
  if (!existsSync(buildId)) return `${join(ROOT, '.next')} has no BUILD_ID, so there is nothing to drive -- run npm ci && npm run build`;
  const built = statSync(buildId).mtimeMs;
  let newest = null;
  const consider = (file) => {
    const mtimeMs = statSync(file).mtimeMs;
    if (!newest || mtimeMs > newest.mtimeMs) newest = { file, mtimeMs };
  };
  for (const dir of SOURCE_DIRS) {
    const path = join(ROOT, dir);
    if (!existsSync(path)) continue;
    for (const entry of readdirSync(path, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) consider(join(entry.parentPath, entry.name));
    }
  }
  for (const file of SOURCE_FILES) if (existsSync(join(ROOT, file))) consider(join(ROOT, file));
  if (newest && newest.mtimeMs > built) {
    return `the build in .next is older than ${relative(ROOT, newest.file)}, so a lane would drive old code -- run npm run build first`;
  }
  return null;
}

const baseFor = number => `http://127.0.0.1:${PORT_BASE + number}`;
const stateFor = number => join(LANES, `lane-${number}`);
// Lane 13 proves the screen when a key is missing, so its server must not be handed the keys the
// agent launcher supplies.
const NO_KEY_LANES = new Set([13]);
const modelName = value => value.replace(/\s+/g, ' ').replace(/^[▸▾]\s*/, '').replace(/\s*(?:↓\$|Free\b).*$/, '').trim();

async function healthy(base) {
  try {
    const response = await fetch(`${base}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function startServer(number) {
  const state = stateFor(number);
  const base = baseFor(number);
  rmSync(state, { recursive: true, force: true });
  mkdirSync(join(state, 'state'), { recursive: true });
  copyFileSync(MODELS, join(state, 'state/models.json'));
  if (await healthy(base)) throw new Error(`port ${PORT_BASE + number} already serving`);

  const env = { ...process.env, DASHBOARD_HOST: '127.0.0.1', DASHBOARD_PORT: String(PORT_BASE + number), DASHBOARD_STATE_DIR: state };
  let child;
  if (NO_KEY_LANES.has(number)) {
    // A person who never added the key, not a person whose key was refused: the key is gone from
    // the environment the screen's sweep runs in, and the launcher is what would put it back.
    delete env.COMMANDCODE_API_KEY;
    child = spawn('node', ['server.js'], { cwd: ROOT, detached: true, stdio: 'ignore', env });
  } else {
    child = spawn('node', ['../scripts/julia-agents.mjs', '--', 'node', 'server.js'], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
      env,
    });
  }
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await healthy(base)) return { child, base, state };
    await sleep(250);
  }
  process.kill(-child.pid);
  throw new Error(`lane ${number} server never answered`);
}

function stopServer(child) {
  if (!child) return;
  try {
    process.kill(-child.pid);
  } catch {
    // already gone
  }
}

function openGroup(page, name) {
  return async () => {
    const button = page.getByRole('button', { name, exact: true });
    await button.waitFor();
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
    const control = await button.getAttribute('aria-controls');
    await page.locator(`#${control} li`).first().waitFor();
    return `#${control}`;
  };
}

async function pickFrom(page, trigger, account, name) {
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await page.locator(`section[aria-label^="${account}"]`).getByRole('button', { name }).first().click();
  await dialog.waitFor({ state: 'detached' });
  await page.waitForTimeout(300);
}

async function statusTexts(page) {
  return (await page.locator('[role=status]').allInnerTexts()).filter(Boolean);
}

async function effortTap(page, name) {
  const button = page.getByRole('button', { name, exact: true });
  await button.click();
  await page.waitForFunction(wanted => {
    const button = [...document.querySelectorAll('button[aria-pressed]')].find(node => node.textContent.trim().endsWith(wanted));
    return button?.getAttribute('aria-pressed') === 'true';
  }, name, { timeout: 5000 });
  const pressed = await page.locator('button[aria-pressed]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-pressed')).join());
  const summary = (await page.locator('dl').innerText()).split('\n').at(-1);
  return { pressed, summary };
}

function contextOptions(kind) {
  if (kind === 'desktop') return { viewport: { width: 1280, height: 800 } };
  if (kind === 'narrow') return { viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true };
  if (kind === 'zoom') return { viewport: { width: 195, height: 422 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  return { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
}

const lanes = [];
const lane = (number, title, kind, body) => lanes.push({ number, title, kind, body });

const groupRows = page => page.locator('section', { has: page.getByRole('heading', { name: 'Models' }) }).locator('> ul > li');

lane(1, 'change the Building group model', 'phone', async page => {
  await openGroup(page, 'Building')();
  const judgment = await groupRows(page).nth(1).innerText();
  const judgmentName = modelName(judgment.replace(/\s+/g, ' '));
  const timing = [];
  await pickFrom(page, page.getByRole('button', { name: 'Change the Building group model' }), 'Claude subscription', /Claude Fable 5 ↓/);
  const started = Date.now();
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('li')].filter(node => node.textContent.includes('feature/refactoring'));
    return rows.length && [...rows].every(node => node.textContent.includes('Claude Fable 5'));
  }, null, { timeout: 5000 });
  timing.push(Date.now() - started);
  await page.waitForTimeout(300);
  const roles = await page.locator('[id^=roles-building] li').evaluateAll(nodes => nodes.map(node => node.innerText.replace(/\n+/g, ' ')));
  assert.equal(roles.length, 4, 'Building should hold four roles');
  for (const row of roles) assert.match(row, /Claude Fable 5/, `role did not follow: ${row}`);
  const afterJudgment = await groupRows(page).nth(1).innerText();
  assert.equal(afterJudgment, judgment, `Judgment should not move: ${judgmentName} then ${afterJudgment}`);
  const said = await statusTexts(page);
  assert.ok(said.some(text => text === 'Building: all 4 roles now use Claude Fable 5. Other groups stay as they are.'), `group note missing: ${said}`);
  return `Building moved to Claude Fable 5; all four roles followed; Judgment stayed on ${judgmentName.replace(/\s+/g, ' ')}; repaint ${timing[0]} ms`;
});

lane(2, 'set one role on its own', 'phone', async page => {
  const list = await openGroup(page, 'Building')();
  await pickFrom(page, page.getByRole('button', { name: 'Change the Building group model' }), 'Claude subscription', /Claude Fable 5 ↓/);
  await pickFrom(page, page.getByRole('button', { name: 'Change the hillclimb model' }), 'Claude subscription', /Claude Opus 5\.5/);
  const rows = await page.locator(`${list} li`).evaluateAll(nodes => nodes.map(node => node.innerText.replace(/\n+/g, ' ')));
  const hillclimb = rows.find(row => row.startsWith('hillclimb'));
  assert.match(hillclimb, /Claude Opus 5\.5/, `hillclimb did not move: ${hillclimb}`);
  assert.match(hillclimb, /set on its own/, 'hillclimb should be marked as its own');
  const others = rows.filter(row => !row.startsWith('hillclimb'));
  for (const row of others) assert.match(row, /Claude Fable 5/, `role changed with the override: ${row}`);
  const said = await statusTexts(page);
  assert.ok(said.includes('hillclimb is set on its own to Claude Opus 5.5. The rest of Building stays on Claude Fable 5.'), `override note missing: ${said}`);
  return `hillclimb on Claude Opus 5.5 marked "set on its own"; other three roles stayed on Claude Fable 5`;
});

lane(3, 'keep the choice after a reload', 'phone', async page => {
  await pickFrom(page, page.getByRole('button', { name: 'Change the Building group model' }), 'Claude subscription', /Claude Fable 5 ↓/);
  await page.reload();
  await page.getByRole('button', { name: 'Small', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('button[aria-pressed][disabled]'));
  const building = await groupRows(page).first().innerText();
  assert.match(building, /Claude Fable 5/, `reload lost it: ${building}`);
  return `reload kept ${modelName(building)}`;
});

lane(4, 'add a model to a panel', 'phone', async page => {
  const add = page.getByRole('button', { name: 'Add a model to Panels group' });
  await add.waitFor();
  const before = await page.locator('button[aria-label^="Remove"][aria-label$="from Panels group"]').count();
  await pickFrom(page, add, 'Claude subscription', /Claude Opus 5\.5/);
  const after = await page.locator('button[aria-label^="Remove"][aria-label$="from Panels group"]').count();
  assert.equal(after, before + 1, `expected one more chip, saw ${before} then ${after}`);
  const said = await statusTexts(page);
  assert.ok(said.some(text => text === 'Claude Opus 5.5 added to Panels.'), `panel note missing: ${said}`);
  return `panel went from ${before} to ${after} chips, each with a cross`;
});

lane(5, 'refuse to empty a panel', 'phone', async page => {
  const add = page.getByRole('button', { name: 'Add a model to Panels group' });
  await add.waitFor();
  const crosses = page.locator('button[aria-label^="Remove"][aria-label$="from Panels group"]');
  await crosses.first().waitFor();
  while ((await crosses.count()) > 1) {
    await crosses.first().click();
    await sleep(400);
  }
  await crosses.first().click();
  await page.getByRole('status').filter({ hasText: 'A panel needs at least one model.' }).first().waitFor({ timeout: 5000 });
  assert.equal(await crosses.count(), 1, 'a panel should keep one model');
  return `removing the last chip was refused with "A panel needs at least one model.", one chip left`;
});

lane(6, 'pick each effort in turn', 'phone', async page => {
  await page.getByRole('button', { name: 'Small', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('button[aria-pressed][disabled]'));
  const seen = [];
  const order = [];
  for (const name of ['Small', 'Medium', 'Large', 'Unlimited']) {
    const result = await effortTap(page, name);
    assert.equal(result.summary, name, `summary did not change to ${name}`);
    assert.equal(result.pressed, ['Small', 'Medium', 'Large', 'Unlimited'].map(item => String(item === name)).join(), `${name} was not the only pressed option`);
    seen.push(`${name}=${'🧠'.repeat(['Small', 'Medium', 'Large', 'Unlimited'].indexOf(name) + 1)}`);
    order.push(name);
  }
  assert.deepEqual(order, ['Small', 'Medium', 'Large', 'Unlimited'], 'effort options are out of order');
  return `all four tapped on a phone: ${seen.join(', ')}`;
});

lane(7, 'list every model with a price, grouped by account', 'phone', async page => {
  await page.getByRole('button', { name: 'Change the Building group model' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  const accounts = await page.locator('section[aria-label] h4').allInnerTexts();
  assert.ok(accounts.length >= 2, `expected account headings, saw ${accounts}`);
  const rows = await dialog.locator('ul li button').evaluateAll(nodes => nodes.map(node => node.innerText.replace(/\n+/g, ' ')));
  for (const row of rows) assert.match(row, /↓\$|Free\b/, `model without a price: ${row}`);
  const twice = rows.filter((row, index) => rows.indexOf(row) !== index);
  assert.deepEqual(twice, [], `the picker lists a name and price twice: ${twice.join(', ')}`);
  const commandCode = page.locator('section[aria-label^="CommandCode"]');
  assert.equal(await commandCode.count(), 1, 'the CommandCode account heading should be there');
  const commandCodeRows = await commandCode.locator('ul li button').evaluateAll(nodes => nodes.map(node => node.innerText.replace(/\n+/g, ' ')));
  const commandCodeNames = commandCodeRows.map(modelName);
  assert.ok(commandCodeRows.length >= 20, `CommandCode should list the models its grant offers, saw ${commandCodeRows.length}: ${commandCodeNames.join(' / ')}`);
  for (const expected of ['DeepSeek V4.1 Flash', 'Kimi K3.1 Pro', 'MiniMax M2.5', 'Qwen 3.8 Max', 'Kimi K3']) {
    assert.ok(commandCodeNames.includes(expected), `CommandCode is missing ${expected}: ${commandCodeNames.join(' / ')}`);
  }
  await dialog.getByRole('button', { name: 'Close the model list' }).click();
  return `${rows.length} models, every one priced, under ${accounts.length} account headings; CommandCode lists ${commandCodeRows.length} including DeepSeek V4.1 Flash and Kimi K3.1 Pro`;
});

lane(8, 'read a role note on a phone', 'phone', async page => {
  await openGroup(page, 'Investigating')();
  const info = page.getByRole('button', { name: 'What why synthesizer means' });
  await info.click();
  const text = await page.getByText('Pulls those findings into one answer with sources.').first().innerText();
  const box = await page.getByText('Pulls those findings into one answer with sources.').first().boundingBox();
  assert.ok(box.width <= 390 && box.x >= 0 && box.x + box.width <= 390, `note hangs off screen: ${JSON.stringify(box)}`);
  await info.click();
  await page.getByText('Pulls those findings into one answer with sources.').first().waitFor({ state: 'detached' });
  return `role note readable inside 390 px and closes again: "${text}"`;
});

lane(9, 'pick every control at 200% zoom', 'zoom', async page => {
  await page.getByRole('button', { name: 'Small', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('button[aria-pressed][disabled]'));
  for (const name of ['Small', 'Medium', 'Large', 'Unlimited']) {
    const result = await effortTap(page, name);
    assert.equal(result.summary, name, `${name} did not select at 200% zoom`);
  }
  const list = await openGroup(page, 'Building')();
  await pickFrom(page, page.getByRole('button', { name: 'Change the Building group model' }), 'Claude subscription', /Claude Fable 5 ↓/);
  const rows = await page.locator(`${list} li`).evaluateAll(nodes => nodes.map(node => node.innerText.replace(/\n+/g, ' ')));
  for (const row of rows) assert.match(row, /Claude Fable 5/, `zoom lane role did not follow: ${row}`);
  const sizes = await page.locator('button[aria-label^="Remove"]').evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().height)));
  const add = await page.getByRole('button', { name: 'Add a model to Panels group' }).boundingBox();
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth }));
  assert.equal(width.scroll, width.inner, `sideways scroll at 200% zoom: ${JSON.stringify(width)}`);
  assert.ok(add.height >= 32, `add control too small at zoom: ${add.height}`);
  return `all four effort options and a group change work at 200% zoom; no sideways scroll; crosses ${sizes.join('/')} px`;
});

lane(10, 'walk every control on a desktop', 'desktop', async page => {
  await page.getByRole('button', { name: 'Small', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('button[aria-pressed][disabled]'));
  await effortTap(page, 'Medium');
  const list = await openGroup(page, 'Building')();
  await pickFrom(page, page.getByRole('button', { name: 'Change the Building group model' }), 'Claude subscription', /Claude Fable 5 ↓/);
  await pickFrom(page, page.getByRole('button', { name: 'Change the hillclimb model' }), 'Claude subscription', /Claude Opus 5\.5/);
  const add = page.getByRole('button', { name: 'Add a model to Panels group' });
  await add.waitFor();
  await pickFrom(page, add, 'Claude subscription', /Claude Opus 5\.5/);
  const rows = await page.locator(`${list} li`).evaluateAll(nodes => nodes.map(node => node.innerText.replace(/\n+/g, ' ')));
  assert.ok(rows.some(row => row.includes('set on its own')), `desktop lost the override badge: ${rows}`);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(sideways, false, 'desktop page scrolls sideways');
  return `group, role, panel and effort all moved on a desktop; no sideways scroll`;
});

lane(11, 'show a clear wait instead of dropping early taps', 'phone', async page => {
  await page.waitForSelector('button[aria-pressed]');
  const disabled = await page.locator('button[aria-pressed]').evaluateAll(nodes => nodes.every(node => node.disabled));
  const cue = await page.getByText('Getting the controls ready').count();
  assert.equal(disabled, true, 'controls should be off until they are ready');
  assert.equal(cue, 1, 'the wait cue should be on screen');
  await page.waitForFunction(() => !document.querySelector('button[aria-pressed][disabled]'), null, { timeout: 30000 });
  assert.equal(await page.getByText('Getting the controls ready').count(), 0, 'the wait cue should go away');
  const result = await effortTap(page, 'Large');
  assert.equal(result.summary, 'Large', 'the first tap after ready should land');
  return 'before the page was ready the controls were off with a plain wait cue; the first tap after that selected Large';
});

lane(12, 'read every account number beside what it is measured against', 'phone', async page => {
  const section = page.locator('section[aria-labelledby="accounts-heading"]');
  await section.waitFor();
  const headings = (await section.locator('h3').allInnerTexts()).map(text => text.trim());
  assert.ok(headings.includes('CommandCode grant'), `the grant should have a heading, saw ${headings}`);
  const lines = (await section.locator('li p').allInnerTexts()).map(text => text.trim()).filter(Boolean);
  // A measurement line is "label: the numbers". A warning has no label, and the read-at line is not a row.
  const measured = lines.filter(line => /^[^:]+: /.test(line));
  assert.ok(measured.length >= 6, `expected a line per account number, saw ${measured.length}: ${lines.join(' | ')}`);
  // Anything spent must be measured against a figure, or the row must say the provider publishes none.
  const spent = measured.filter(line => /[\d.]\s+(?:credits?\s+)?used/.test(line));
  const floating = spent.filter(line => !/\bof [\d.,]+/.test(line) && !/does not publish/.test(line));
  assert.deepEqual(floating, [], `a number with no base to measure it against: ${floating.join(' | ')}`);
  const grant = measured.filter(line => line.startsWith('Last 5 hours:') || line.startsWith('This week:'));
  assert.ok(grant.some(line => /\bof [\d.,]+ credits? used/.test(line) && line.includes('Resets')), `the grant should show a window against its cap: ${grant.join(' | ')}`);
  return `${headings.length} accounts, every spent figure beside its base: ${measured.join(' | ')}`;
});

lane(13, "say a number can't be read when its key is missing", 'phone', async page => {
  const section = page.locator('section[aria-labelledby="accounts-heading"]');
  await section.waitFor();
  const items = await section.locator('li').evaluateAll(nodes => nodes.map(node => ({
    name: node.querySelector('h3')?.innerText.trim(),
    lines: [...node.querySelectorAll('p')].map(line => line.innerText.trim()).filter(Boolean),
  })));
  const grant = items.find(item => item.name === 'CommandCode grant');
  assert.ok(grant, `the grant row should be on screen, saw ${items.map(item => item.name)}`);
  assert.ok(grant.lines.some(line => line.includes("can't be read")),
    `a row with no key must use the card's words, saw ${grant.lines.join(' | ')}`);
  assert.ok(grant.lines.some(line => /no sign-in or key for CommandCode grant/.test(line) && /Todd needs to add it/.test(line)),
    `a row with no key must name the missing key, saw ${grant.lines.join(' | ')}`);
  const everyLine = items.flatMap(item => item.lines).join(' | ');
  assert.ok(!/No number/.test(everyLine), `the old wording is back on the screen: ${everyLine}`);
  assert.ok(items.length >= 3, `every account should still get a row, saw ${everyLine}`);
  return `the grant row with no key: ${grant.lines.join(' | ')}`;
});

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const target = urlIndex === -1 ? null : args[urlIndex + 1];
const only = args.find(arg => /^\d+$/.test(arg));
if (urlIndex !== -1 && !target) {
  console.error('usage: node scripts/lanes.mjs [lane number] [--url <address>]');
  process.exit(2);
}

async function openLane(number) {
  if (target) return { child: null, base: target.replace(/\/+$/, ''), state: null };
  return startServer(number);
}

async function run(number, title, kind, body) {
  if (only && Number(only) !== number) return;
  if (target && NO_KEY_LANES.has(number)) {
    console.log(`lane ${number} SKIP  ${title}\n        this lane needs a server it can boot without the key`);
    return;
  }
  const { child, base, state } = await openLane(number);
  const browser = await chromium.launch();
  const context = await browser.newContext(contextOptions(kind));
  if (number === 11) {
    await context.route(url => url.pathname.endsWith('.js'), async route => {
      await sleep(5000);
      await route.continue();
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${base}/start/${CARD}`, { waitUntil: 'commit' });
    const note = await body(page);
    if (errors.length) throw new Error(`console errors: ${errors.join(' / ')}`);
    if (number === 3 && state) {
      assert.ok(existsSync(join(state, 'state/draft.json')), `draft.json missing in ${state}`);
    }
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `lane-${number}.png`), fullPage: true });
    console.log(`lane ${number} PASS  ${title}\n        ${note}`);
  } catch (error) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `lane-${number}.png`), fullPage: true }).catch(() => {});
    console.log(`lane ${number} FAIL  ${title}\n        ${error.message}`);
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
    stopServer(child);
  }
}

if (target) {
  console.log(`Driving ${target} as it is; every choice clicked here is saved on that server.`);
} else {
  const stale = staleBuildReason();
  if (stale) {
    console.error(`lanes refused: ${stale}`);
    process.exit(1);
  }
}

mkdirSync(LANES, { recursive: true });
for (const item of lanes) await run(item.number, item.title, item.kind, item.body);
