import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accountView } from './usage-view.js';
import { PROBLEMS, parseAnthropic, parseChatgpt, parseCommandCode } from './usage.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/usage-${name}.json`, import.meta.url), 'utf8'));
const readAt = '2026-10-30T14:05:08.353Z';
const claude = () => ({ id: 'claude', name: 'Claude subscription', readAt, rows: parseAnthropic(fixture('anthropic'), { readAt }) });
const chatgpt = () => ({ id: 'chatgpt', name: 'ChatGPT plan', readAt, rows: parseChatgpt(fixture('chatgpt'), { readAt }) });
const commandcode = () => ({ id: 'commandcode', name: 'CommandCode grant', readAt, rows: parseCommandCode({
  credits: fixture('commandcode-credits'), summary: fixture('commandcode-summary'), subscription: fixture('commandcode-subscription'),
}, { readAt }) });

test('writes use, quota, what is left and the reset day on one line', () => {
  const view = accountView(claude());
  assert.equal(view.rows[1].text, 'This week: 80 of 100 used, so 20 left. Resets 31 Oct.');
  assert.equal(view.rows[0].text, 'Last 5 hours: nothing used yet, so 100 left. This window starts with your first request.');
  assert.equal(view.readAtText, 'on 30 Oct at 14:05 UTC');
  assert.equal(accountView(commandcode()).rows[0].text, 'This month: $23.95 of $70.13 used, so $46.17 left. Renews 22 Nov.');
});

test('writes a balance row with no quota', () => {
  assert.equal(accountView(commandcode()).rows[1].text, 'Bought credit: $4.30 left. It does not expire.');
});

test('names the account and the free-up day in the warning', () => {
  assert.deepEqual(accountView(claude()).warning, { name: 'Claude subscription', text: 'Claude subscription is nearly used up. It frees up on 31 Oct.', level: 'nearly-out' });
});

test('uses the soonest reset among the exhausted rows', () => {
  const account = chatgpt();
  account.rows.forEach(row => { row.level = 'out'; row.used = 100; });
  assert.equal(accountView(account).warning.text, 'ChatGPT plan is used up until 30 Oct.');
  account.rows.reverse();
  assert.equal(accountView(account).warning.text, 'ChatGPT plan is used up until 30 Oct.');
  account.rows.find(row => row.key === 'chatgpt:hours').level = 'nearly-out';
  assert.equal(accountView(account).warning.text, 'ChatGPT plan is used up until 4 Nov.');
});

test('says nearly used up without claiming it is used up', () => {
  const account = claude();
  account.rows[1].resetsAt = null;
  const view = accountView(account);
  assert.equal(view.level, 'nearly-out');
  assert.equal(view.rows[1].text, 'This week: 80 of 100 used, so 20 left. The provider gave no reset time.');
  assert.equal(view.warning.text, 'Claude subscription is nearly used up. The provider gave no reset time.');
  assert.ok(!view.warning.text.includes(' is used up'));
});

test('has one sentence per problem and never a dash', () => {
  const account = claude();
  const expected = [
    'The server has no sign-in or key for Claude subscription. Todd needs to add it.',
    'Claude subscription needs a new sign-in. Sign in again in Mastra Code.',
    'Claude subscription answered with an error (HTTP 403).',
    'Claude subscription could not be reached.',
    'Claude subscription answered in a shape this screen does not read.',
    'Claude subscription does not publish this number.',
    'Claude subscription refused its key. Todd needs to replace it.',
  ];
  Object.keys(PROBLEMS).forEach((problem, index) => {
    account.rows = [{ key: 'claude', label: account.name, kind: 'unreadable', problem, ...(problem === 'refused' ? { status: 403 } : {}) }];
    const view = accountView(account);
    assert.equal(view.rows[0].text, `No number. ${expected[index]}`);
    assert.ok(!view.rows[0].text.includes('—'));
    assert.equal(view.warning, null);
  });
});

test('raises no warning for a comfortable account', () => {
  assert.equal(accountView(chatgpt()).warning, null);
  assert.equal(accountView(commandcode()).level, 'plenty');
});
