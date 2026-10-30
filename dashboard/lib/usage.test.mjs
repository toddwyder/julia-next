import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommandCode, parseAnthropic, parseChatgpt, readAccountStatus } from './usage.js';

// The three replies CommandCode gave on 30 October, trimmed to the fields this screen reads.
const commandCodeReplies = () => ({
  credits: {
    credits: { belowThreshold: false, creditThreshold: 0, monthlyCredits: 30.7606230874, purchasedCredits: 4.2017873268, freeCredits: 0 },
    windowLimits: {
      limited: true,
      exceeded: 'fiveHour',
      fiveHour: { used: 14.7610615645, cap: 14, exceeded: true, resetAt: 1793402237583 },
      weekly: { used: 20.5535933623, cap: 35, exceeded: false, resetAt: 1793898943432 },
    },
    sandboxAccess: true,
    sandboxMinutes: { usedMinutes: 0, limitMinutes: 0, overageUsd: 0, resetAt: 1793491200000 },
  },
  summary: { totalCost: 39.455527852200014, totalCredits: 39.455527852200014, totalMonthlyCredits: 39.40002682020001, totalPurchasedCredits: 0.055501032, periodBasis: 'billing-period' },
  subscription: { success: true, data: { planId: 'individual-goat', status: 'active', currentPeriodStart: '2026-10-22T14:01:24.000Z', currentPeriodEnd: '2026-11-22T14:01:24.000Z' } },
});

const commandCodeRows = (replies = commandCodeReplies()) => parseCommandCode(replies, { readAt: '2026-10-30T22:34:14.000Z' });
const rowAt = (rows, key) => rows.find(row => row.key === key);

test('puts every cap CommandCode sends beside the use against it', () => {
  const rows = commandCodeRows();
  const { fiveHour, weekly } = commandCodeReplies().credits.windowLimits;
  assert.deepEqual(
    [rowAt(rows, 'commandcode:hours'), rowAt(rows, 'commandcode:week')].map(row => [row?.kind, row?.label, row?.used, row?.allowance, row?.unit]),
    [['window', 'Last 5 hours', fiveHour.used, fiveHour.cap, 'credit'], ['window', 'This week', weekly.used, weekly.cap, 'credit']],
  );
  assert.equal(rowAt(rows, 'commandcode:hours').resetsAt, '2026-10-30T23:17:17.583Z');
  assert.equal(rowAt(rows, 'commandcode:week').resetsAt, '2026-11-05T17:15:43.432Z');
});

test('shows the month as the two provider numbers and says the total is not published', () => {
  const month = rowAt(commandCodeRows(), 'commandcode:month');
  assert.equal(month.used, 39.40002682020001);
  assert.equal(month.left, 30.7606230874);
  assert.equal(month.resetsAt, '2026-11-22T14:01:24.000Z');
  assert.match(month.note, /does not publish the month's total/);
  assert.equal(month.allowance, undefined);
});

// The rule this screen keeps: a number on it is never measured against a total we worked out.
// Every allowance on screen is a cap the provider sent, in the payload, on the day of the read.
test('measures use only against caps the provider sent', () => {
  const replies = commandCodeReplies();
  const published = Object.values(replies.credits.windowLimits)
    .filter(limit => typeof limit === 'object').map(limit => limit.cap);
  for (const row of commandCodeRows(replies)) {
    if (row.kind === 'window') assert.ok(published.includes(row.allowance), `${row.key} is measured against ${row.allowance}, which CommandCode never sent`);
    else assert.equal(row.allowance, undefined, `${row.key} invented an allowance`);
  }
});

test('does not call the grant used up while bought credit still works', () => {
  const spent = commandCodeRows();
  assert.equal(rowAt(spent, 'commandcode:hours').level, 'nearly-out');
  assert.match(rowAt(spent, 'commandcode:hours').note, /bought credit still works/);
  const noCredit = commandCodeReplies();
  noCredit.credits.credits.purchasedCredits = 0;
  const rows = commandCodeRows(noCredit);
  assert.equal(rowAt(rows, 'commandcode:hours').level, 'out');
  assert.equal(rowAt(rows, 'commandcode:hours').note, undefined);
});

test('keeps a window with no cap on screen and says the number is missing', () => {
  const replies = commandCodeReplies();
  delete replies.credits.windowLimits.weekly;
  const week = rowAt(commandCodeRows(replies), 'commandcode:week');
  assert.equal(week.kind, 'unreadable');
  assert.equal(week.problem, 'not-published');
  assert.equal(rowAt(commandCodeRows(replies), 'commandcode:hours').kind, 'window');
});

const repliesByAccount = () => ({
  claude: { limits: [{ kind: 'weekly_all', percent: 80, severity: 'warning', resets_at: '2026-10-31T05:00:00.000Z' }] },
  chatgpt: { rate_limit: { limit_reached: false, primary_window: { used_percent: 0, limit_window_seconds: 18000, reset_at: 1793412000 }, secondary_window: { used_percent: 54, limit_window_seconds: 604800, reset_at: 1794060943 } } },
  commandcode: commandCodeReplies(),
});

const readAll = async (replies = repliesByAccount()) => {
  const urls = {
    claude: () => replies.claude,
    chatgpt: () => replies.chatgpt,
    commandcode: url => url.endsWith('/alpha/billing/credits') ? replies.commandcode.credits
      : url.endsWith('/alpha/usage/summary') ? replies.commandcode.summary : replies.commandcode.subscription,
  };
  const fetchImpl = async url => {
    const id = Object.keys(urls).find(name => url.includes(name === 'claude' ? 'anthropic' : name === 'chatgpt' ? 'chatgpt.com' : 'commandcode'));
    return { ok: true, status: 200, json: async () => urls[id](url) };
  };
  return readAccountStatus({
    accounts: [{ id: 'claude', name: 'Claude subscription' }, { id: 'chatgpt', name: 'ChatGPT plan' }, { id: 'commandcode', name: 'CommandCode grant' }],
    getHeaders: async () => ({ authorization: 'Bearer test' }),
    fetchImpl,
    now: () => new Date('2026-10-30T22:34:14.000Z'),
  });
};

test('every number on the Start screen sits beside what it is measured against', async () => {
  const accounts = await readAll();
  const bare = accounts.flatMap(account => account.rows
    .filter(row => row.kind === 'window' ? !(Number.isFinite(row.allowance) && row.allowance > 0) : row.kind === 'spend' && !row.note)
    .map(row => `${account.id}:${row.key}`));
  assert.deepEqual(bare, [], 'these rows show a number with nothing to compare it to');
});

test('keeps the other accounts readable when one reply fails', async () => {
  const replies = repliesByAccount();
  const accounts = await readAccountStatus({
    accounts: [{ id: 'commandcode', name: 'CommandCode grant' }],
    getHeaders: async () => ({ authorization: 'Bearer test' }),
    fetchImpl: async url => url.endsWith('/alpha/usage/summary')
      ? { ok: false, status: 500, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => url.endsWith('/credits') ? replies.commandcode.credits : replies.commandcode.subscription },
    now: () => new Date('2026-10-30T22:34:14.000Z'),
  });
  const rows = accounts[0].rows;
  assert.equal(rowAt(rows, 'commandcode:month').kind, 'unreadable');
  assert.equal(rowAt(rows, 'commandcode:month').problem, 'refused');
  assert.equal(rowAt(rows, 'commandcode:hours').kind, 'window');
  assert.equal(rowAt(rows, 'commandcode:credit').kind, 'balance');
});

test('reads the two subscription accounts the way their providers send them', () => {
  // A window the provider leaves out keeps its row and says the number is missing.
  assert.deepEqual(parseAnthropic(repliesByAccount().claude).map(row => [row.key, row.kind, row.used ?? null, row.allowance ?? null, row.level ?? null]),
    [['claude:hours', 'unreadable', null, null, null], ['claude:week', 'window', 80, 100, 'nearly-out']]);
  assert.deepEqual(parseChatgpt(repliesByAccount().chatgpt).map(row => [row.key, row.used, row.allowance]),
    [['chatgpt:hours', 0, 100], ['chatgpt:week', 54, 100]]);
});
