const rank = { plenty: 0, 'nearly-out': 1, out: 2 };

function problemText(row, name) {
  switch (row.problem) {
    case 'no-credential': return `The server has no sign-in or key for ${name}. Todd needs to add it.`;
    case 'key-refused': return `${name} refused its key. Todd needs to replace it.`;
    case 'sign-in-expired': return `${name} needs a new sign-in. Sign in again in Mastra Code.`;
    case 'refused': return Number.isInteger(row.status)
      ? `${name} answered with an error (HTTP ${row.status}).` : `${name} answered with an error.`;
    case 'unreachable': return `${name} could not be reached.`;
    case 'shape-changed': return `${name} answered in a shape this screen does not read.`;
    case 'not-published': return `${name} does not publish this number.`;
    default: return `${name} could not be read.`;
  }
}

export function accountView(account, { timeZone = 'UTC', locale = 'en-GB' } = {}) {
  const day = value => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone }).format(new Date(value));
  const amount = (value, unit) => unit === 'usd' ? `$${value.toFixed(2)}`
    : unit === 'credit' ? value.toFixed(2) : String(Math.round(value));
  const rows = account.rows.map(row => {
    let text;
    switch (row.kind) {
      case 'unreadable': text = `No number. ${problemText(row, account.name)}`; break;
      case 'balance': text = `${row.label}: ${amount(row.remaining, row.unit)} left. It does not expire.`; break;
      case 'spend': text = `${row.label}: ${amount(row.used, row.unit)} used. ${amount(row.left, row.unit)} of credit left. ${row.resetsAt
        ? `Renews ${day(row.resetsAt)}.`
        : 'The provider gave no reset time.'}`; break;
      case 'window': {
        const left = amount(Math.max(0, row.allowance - row.used), row.unit);
        const unitWord = row.unit === 'credit' ? ' credits' : '';
        const compared = `${amount(row.used, row.unit)} of ${amount(row.allowance, row.unit)}${unitWord} used, so ${left} left.`;
        text = row.used === 0 && row.resetsAt === null
          ? `${row.label}: nothing used yet, so ${left}${unitWord} left. This window starts with your first request.`
          : `${row.label}: ${compared} ${row.resetsAt
            ? `${row.unit === 'usd' ? 'Renews' : 'Resets'} ${day(row.resetsAt)}.`
            : 'The provider gave no reset time.'}`;
        break;
      }
      default: throw new Error('Unknown account row kind.');
    }
    return { key: row.key, text: row.note ? `${text} ${row.note}` : text, level: row.level ?? 'plenty' };
  });
  const level = rows.reduce((worst, row) => rank[row.level] > rank[worst] ? row.level : worst, 'plenty');
  let warning = null;
  if (level !== 'plenty') {
    const resets = account.rows.filter(row => row.level === level && row.resetsAt).map(row => row.resetsAt)
      .sort((a, b) => Date.parse(a) - Date.parse(b));
    const text = level === 'out'
      ? resets.length ? `${account.name} is used up until ${day(resets[0])}.`
        : `${account.name} is used up. The provider gave no reset time.`
      : `${account.name} is nearly used up. ${resets.length ? `It frees up on ${day(resets[0])}.` : 'The provider gave no reset time.'}`;
    warning = { name: account.name, text, level };
  }
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(account.readAt));
  return { id: account.id, name: account.name, level, rows, warning,
    readAtText: `on ${day(account.readAt)} at ${time} ${timeZone}` };
}
