export const PROBLEMS = Object.freeze(Object.fromEntries([
  'no-credential', 'sign-in-expired', 'refused', 'unreachable', 'shape-changed', 'not-published', 'key-refused',
].map(code => [code, code])));

export class ProblemError extends Error {
  constructor(problem, status) {
    super(PROBLEMS[problem] ?? PROBLEMS['unreachable']);
    this.problem = this.message;
    if (Number.isInteger(status) && status >= 100 && status <= 599) this.status = status;
  }
}

const number = value => Number.isFinite(value) && value >= 0;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const unreadable = (key, label, problem = 'not-published', status) => ({
  key, label, kind: 'unreadable', problem,
  ...(status === undefined ? {} : { status }),
});
const failed = (key, label, error) => unreadable(key, label,
  error instanceof ProblemError ? error.problem : 'unreachable',
  error instanceof ProblemError ? error.status : undefined);

export function levelOf({ used, allowance }, signal) {
  if (signal === 'out' || used >= allowance) return 'out';
  if (signal === 'nearly-out' || used / allowance >= 0.9) return 'nearly-out';
  return 'plenty';
}

// A reset the provider did not send keeps the row readable: the number is the point, and the
// view says the reset time was not given. Only a reset we cannot parse is a shape change.
function windowRow(key, label, used, allowance, unit, resetsAt, signal) {
  if (!number(used) || !number(allowance) || allowance === 0) return unreadable(key, label);
  if (resetsAt !== null && resetsAt !== undefined && !date(resetsAt)) return unreadable(key, label, 'shape-changed');
  return { key, label, kind: 'window', used, allowance, unit, resetsAt: resetsAt ?? null,
    level: levelOf({ used, allowance }, signal) };
}

export function parseAnthropic(payload, { readAt } = {}) {
  if (!Array.isArray(payload?.limits)) throw new ProblemError('shape-changed');
  return [['session', 'hours', 'Last 5 hours'], ['weekly_all', 'week', 'This week']].map(([kind, suffix, label]) => {
    const limit = payload.limits.find(item => item?.kind === kind);
    const signal = ['warning', 'critical', 'danger', 'error', 'exceeded'].includes(limit?.severity) ? 'nearly-out' : undefined;
    return windowRow(`claude:${suffix}`, label, limit?.percent, 100, 'percent', limit?.resets_at, signal);
  });
}

export function parseChatgpt(payload, { readAt } = {}) {
  if (!payload?.rate_limit || typeof payload.rate_limit !== 'object') throw new ProblemError('shape-changed');
  const limits = payload.rate_limit;
  const windows = [limits.primary_window, limits.secondary_window];
  return [[18000, 'hours', 'Last 5 hours'], [604800, 'week', 'This week']].flatMap(([seconds, suffix, label]) => {
    const window = windows.find(item => item?.limit_window_seconds === seconds);
    if (!window && windows.includes(null)) return [];
    const reset = number(window?.reset_at) && Number.isFinite(new Date(window.reset_at * 1000).getTime())
      ? new Date(window.reset_at * 1000).toISOString() : undefined;
    return [windowRow(`chatgpt:${suffix}`, label, window?.used_percent, 100, 'percent', reset,
      limits.limit_reached === true ? 'out' : undefined)];
  });
}

export function parseCommandCode({ credits, summary, subscription }, { readAt } = {}) {
  const used = summary?.totalMonthlyCredits;
  const remaining = credits?.credits?.monthlyCredits;
  // monthlyCredits is the remaining allowance: it falls as usage is billed, so the cap is used plus remaining.
  const allowance = number(used) && number(remaining) ? used + remaining : undefined;
  const balance = credits?.credits?.purchasedCredits;
  return [
    windowRow('commandcode:month', 'This month', used, allowance, 'usd', subscription?.data?.currentPeriodEnd),
    number(balance)
      ? { key: 'commandcode:credit', label: 'Bought credit', kind: 'balance', remaining: balance, unit: 'usd', level: 'plenty' }
      : unreadable('commandcode:credit', 'Bought credit'),
  ];
}

const endpoints = {
  claude: ['https://api.anthropic.com/api/oauth/usage'],
  chatgpt: ['https://chatgpt.com/backend-api/wham/usage'],
  commandcode: ['https://api.commandcode.ai/alpha/billing/credits',
    'https://api.commandcode.ai/alpha/usage/summary', 'https://api.commandcode.ai/alpha/billing/subscriptions'],
};

async function readEndpoint(url, headers, fetchImpl, authProblem = 'sign-in-expired') {
  let response;
  try { response = await fetchImpl(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(8000) }); }
  catch { throw new ProblemError('unreachable'); }
  if (!response.ok) throw new ProblemError(response.status === 401 || response.status === 403 ? authProblem : 'refused', response.status);
  try { return await response.json(); }
  catch (error) { throw new ProblemError(error?.name === 'SyntaxError' ? 'shape-changed' : 'unreachable'); }
}

export async function readAccountStatus({ accounts, getHeaders, fetchImpl = fetch, now = () => new Date() }) {
  return Promise.all(accounts.map(async ({ id, name }) => {
    const readAt = now().toISOString();
    try {
      if (!endpoints[id]) throw new ProblemError('shape-changed');
      const headers = await getHeaders(id);
      const authProblem = id === 'commandcode' ? 'key-refused' : 'sign-in-expired';
      let rows;
      if (id === 'commandcode') {
        const results = await Promise.allSettled(endpoints[id].map(url => readEndpoint(url, headers, fetchImpl, authProblem)));
        if (results.every(result => result.status === 'rejected')) throw results[0].reason;
        const [credits, summary, subscription] = results.map(result => result.value);
        rows = parseCommandCode({ credits, summary, subscription }, { readAt });
        const monthFailure = results.find(result => result.status === 'rejected');
        if (monthFailure) rows[0] = failed('commandcode:month', 'This month', monthFailure.reason);
        if (results[0].status === 'rejected') rows[1] = failed('commandcode:credit', 'Bought credit', results[0].reason);
      } else {
        const payload = await readEndpoint(endpoints[id][0], headers, fetchImpl, authProblem);
        rows = (id === 'claude' ? parseAnthropic : parseChatgpt)(payload, { readAt });
      }
      if (!rows.length) rows = [unreadable(id, name)];
      return { id, name, readAt, rows };
    } catch (error) {
      return { id, name, readAt, rows: [failed(id, name, error)] };
    }
  }));
}
