import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROBLEMS, ProblemError, levelOf, parseAnthropic, parseChatgpt, parseCommandCode, readAccountStatus } from './usage.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/usage-${name}.json`, import.meta.url), 'utf8'));
const accounts = JSON.parse(readFileSync(new URL('../config/accounts.json', import.meta.url), 'utf8')).accounts;
const now = () => new Date('2026-10-30T14:05:08.353Z');
const readAt = now().toISOString();
const commandcode = () => ({ credits: fixture('commandcode-credits'), summary: fixture('commandcode-summary'), subscription: fixture('commandcode-subscription') });
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
function fetchFixture(url) {
  if (url.includes('anthropic.com')) return reply(fixture('anthropic'));
  if (url.includes('chatgpt.com')) return reply(fixture('chatgpt'));
  return reply(fixture(`commandcode-${url.endsWith('credits') ? 'credits' : url.endsWith('summary') ? 'summary' : 'subscription'}`));
}
const read = (fetchImpl = fetchFixture, getHeaders = async () => ({})) => readAccountStatus({ accounts, getHeaders, fetchImpl, now });

test('reads the Claude fixture as a 5-hour row and a week row, each against its own quota', () => {
  const rows = parseAnthropic(fixture('anthropic'), { readAt });
  assert.deepEqual(rows.map(({ key, label, used, allowance }) => ({ key, label, used, allowance })), [
    { key: 'claude:hours', label: 'Last 5 hours', used: 0, allowance: 100 },
    { key: 'claude:week', label: 'This week', used: 80, allowance: 100 },
  ]);
});

test('leaves the Claude 5-hour reset empty when nothing has run yet', () => {
  assert.equal(parseAnthropic(fixture('anthropic'), { readAt })[0].resetsAt, null);
});

test('reads the ChatGPT fixture by window length, not by field position', () => {
  const payload = fixture('chatgpt');
  [payload.rate_limit.primary_window, payload.rate_limit.secondary_window] = [payload.rate_limit.secondary_window, payload.rate_limit.primary_window];
  assert.deepEqual(parseChatgpt(payload, { readAt }).map(row => [row.key, row.used, row.allowance]), [
    ['chatgpt:hours', 0, 100], ['chatgpt:week', 48, 100],
  ]);
});

test('turns the ChatGPT epoch reset into an ISO time', () => {
  assert.equal(parseChatgpt(fixture('chatgpt'), { readAt })[1].resetsAt, '2026-11-04T14:29:49.000Z');
});

test('reads CommandCode as a month row against used plus remaining, and a separate bought-credit row', () => {
  const [month, credit] = parseCommandCode(commandcode(), { readAt });
  assert.equal(month.used, 23.950986015200005);
  assert.ok(Math.abs(month.allowance - 70.1251492148) < 0.00000001);
  assert.equal(month.resetsAt, '2026-11-22T14:01:24.000Z');
  assert.deepEqual(credit, { key: 'commandcode:credit', label: 'Bought credit', kind: 'balance', remaining: 4.2975948488, unit: 'usd', level: 'plenty' });
});

test('keeps the month number when the reset is missing', () => {
  const data = commandcode();
  delete data.subscription.data.currentPeriodEnd;
  const [month] = parseCommandCode(data, { readAt });
  assert.equal(month.kind, 'window');
  assert.equal(month.resetsAt, null);
  assert.ok(Math.abs(month.used - 23.950986015200005) < 0.00000001);
});

test('marks a row nearly out from the provider\'s own signal before the 90 percent fallback', () => {
  assert.equal(parseAnthropic(fixture('anthropic'), { readAt })[1].level, 'nearly-out');
  assert.equal(levelOf({ used: 90, allowance: 100 }), 'nearly-out');
  assert.equal(levelOf({ used: 89, allowance: 100 }), 'plenty');
});

test('marks an exhausted window out', () => {
  const payload = fixture('chatgpt');
  payload.rate_limit.limit_reached = true;
  assert.ok(parseChatgpt(payload, { readAt }).every(row => row.level === 'out'));
  assert.equal(levelOf({ used: 100, allowance: 100 }, 'nearly-out'), 'out');
  const data = commandcode();
  data.credits.credits.monthlyCredits = 0;
  assert.equal(parseCommandCode(data, { readAt })[0].level, 'out');
});

test('keeps the other accounts when one provider refuses', async () => {
  const result = await read(url => url.includes('anthropic.com') ? reply({}, 503) : fetchFixture(url));
  assert.deepEqual(result[0].rows, [{ key: 'claude', label: 'Claude subscription', kind: 'unreadable', problem: 'refused', status: 503 }]);
  assert.equal(result[1].rows[1].used, 48);
  assert.equal(result[2].rows[1].remaining, 4.2975948488);
});

test('turns a 401 into the sign-in problem, not a zero', async () => {
  const result = await read(() => reply({}, 401));
  assert.deepEqual(result.map(account => account.rows[0].problem), ['sign-in-expired', 'sign-in-expired', 'key-refused']);
  assert.ok(result.every(account => account.rows.length === 1 && account.rows[0].kind === 'unreadable'
    && !('used' in account.rows[0])));
});

test('reports a missing window number as not published instead of zero', () => {
  const claude = fixture('anthropic');
  delete claude.limits[1].percent;
  assert.equal(parseAnthropic(claude, { readAt })[1].problem, 'not-published');
  const chatgpt = fixture('chatgpt');
  delete chatgpt.rate_limit.secondary_window.used_percent;
  assert.equal(parseChatgpt(chatgpt, { readAt })[1].kind, 'unreadable');
  const data = commandcode();
  delete data.credits.credits.monthlyCredits;
  assert.equal(parseCommandCode(data, { readAt })[0].problem, 'not-published');
  chatgpt.rate_limit.secondary_window = null;
  assert.equal(parseChatgpt(chatgpt, { readAt }).length, 1);
});

test('keeps the CommandCode balance when the summary fails', async () => {
  const result = await read(url => url.endsWith('summary') ? reply({}, 503) : fetchFixture(url));
  assert.equal(result[2].rows[0].problem, 'refused');
  assert.equal(result[2].rows[1].remaining, 4.2975948488);
});

test('covers every account in accounts.json', async () => {
  const result = await read((url, options) => {
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    return fetchFixture(url);
  });
  assert.deepEqual(result.map(({ id, name }) => ({ id, name })), accounts.map(({ id, name }) => ({ id, name })));
  assert.ok(result.every(account => account.readAt === readAt && account.rows.length === 2));
  const missing = await read(fetchFixture, async () => { throw new ProblemError('no-credential'); });
  assert.ok(missing.every(account => account.rows[0].problem === 'no-credential'));
});

test('never puts provider text or a token in a problem', async () => {
  const marker = 'private-provider-message';
  const result = await read(() => reply({ error: marker }, 500));
  assert.ok(!JSON.stringify(result).includes(marker));
  const thrown = await read(() => { throw new Error(marker); });
  assert.ok(thrown.every(account => account.rows[0].problem === 'unreachable'));
  assert.ok(!JSON.stringify(thrown).includes(marker));
  const malformed = await read(() => reply({ unexpected: marker }));
  assert.equal(malformed[0].rows[0].problem, 'shape-changed');
  assert.ok(Object.isFrozen(PROBLEMS));
});
