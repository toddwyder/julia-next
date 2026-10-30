import test from 'node:test';
import assert from 'node:assert/strict';
import { accountView } from './usage-view.js';
import { PROBLEMS } from './usage.js';

const readAt = '2026-10-30T14:05:08.353Z';
const windowRow = (key, label, used, allowance, resetsAt, level = 'plenty') =>
  ({ key, label, kind: 'window', used, allowance, unit: 'percent', resetsAt, level });
const claude = () => ({
  id: 'claude', name: 'Claude subscription', readAt,
  rows: [
    windowRow('claude:hours', 'Last 5 hours', 0, 100, null),
    windowRow('claude:week', 'This week', 80, 100, '2026-10-31T05:00:00.000Z', 'nearly-out'),
  ],
});
const commandcode = () => ({
  id: 'commandcode', name: 'CommandCode grant', readAt,
  rows: [
    { key: 'commandcode:month', label: 'This month', kind: 'spend', used: 23.950986015200005, left: 46.1741631996,
      unit: 'usd', resetsAt: '2026-11-22T14:01:24.000Z', level: 'plenty' },
    { key: 'commandcode:credit', label: 'Bought credit', kind: 'balance', remaining: 4.2975948488, unit: 'usd', level: 'plenty' },
  ],
});

test('writes use, quota, what is left and the reset day on one line', () => {
  const view = accountView(claude());
  assert.equal(view.rows[1].text, 'This week: 80 of 100 used, so 20 left. Resets 31 Oct.');
  assert.equal(view.rows[0].text, 'Last 5 hours: nothing used yet, so 100 left. This window starts with your first request.');
  assert.equal(view.readAtText, 'on 30 Oct at 14:05 UTC');
});

test('writes a spend row with the provider numbers and no worked-out allowance', () => {
  assert.equal(accountView(commandcode()).rows[0].text, 'This month: $23.95 used. $46.17 of credit left. Renews 22 Nov.');
});

test('writes a balance row with no quota', () => {
  assert.equal(accountView(commandcode()).rows[1].text, 'Bought credit: $4.30 left. It does not expire.');
});

test('names the account and the free-up day in the warning', () => {
  assert.deepEqual(accountView(claude()).warning, { name: 'Claude subscription', text: 'Claude subscription is nearly used up. It frees up on 31 Oct.', level: 'nearly-out' });
});

test('uses the soonest reset among the exhausted rows', () => {
  const account = claude();
  account.rows.forEach(row => { row.level = 'out'; row.resetsAt = '2026-11-04T00:00:00.000Z'; });
  account.rows[0].resetsAt = '2026-10-30T18:00:00.000Z';
  assert.equal(accountView(account).warning.text, 'Claude subscription is used up until 30 Oct.');
  account.rows.reverse();
  assert.equal(accountView(account).warning.text, 'Claude subscription is used up until 30 Oct.');
  account.rows.find(row => row.key === 'claude:hours').level = 'nearly-out';
  assert.equal(accountView(account).warning.text, 'Claude subscription is used up until 4 Nov.');
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
  const comfortable = claude();
  comfortable.rows[1].level = 'plenty';
  assert.equal(accountView(comfortable).warning, null);
  assert.equal(accountView(commandcode()).level, 'plenty');
});

test('warns when the provider says the month is running out', () => {
  const account = commandcode();
  account.rows[0].level = 'nearly-out';
  assert.equal(accountView(account).warning.text, 'CommandCode grant is nearly used up. It frees up on 22 Nov.');
  account.rows[0].level = 'out';
  assert.equal(accountView(account).warning.text, 'CommandCode grant is used up until 22 Nov.');
});
