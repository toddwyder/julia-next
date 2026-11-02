// The merge gate reads the pull request's own published determinations, not a
// file on this machine. The comment is what Shipping wrote when it passed, it
// survives a crash, and it carries the commit it judged, so a change that
// arrived after the review cannot ride in on the old verdict.

const PASSING = new Set(['PASS', 'PASS+NOTES']);

const HEADER = /^Shipping agent:[ \t]*([A-Z+ ]+?)[ \t]*(?:\(review (\d+) of (\d+)\))?[ \t]*$/i;
const COMMIT = /\*\*Commit\*\*[ \t]*`?([0-9a-f]{7,40})`?/i;
const CARD = /\*\*Card\*\*[ \t]*`?([A-Z]+-\d+)`?/i;
const PULL = /\*\*Pull request\*\*[ \t]*#?(\d+)/i;

export function sameCommit(a, b) {
  const left = String(a ?? '').toLowerCase();
  const right = String(b ?? '').toLowerCase();
  if (left.length < 7 || right.length < 7) return false;
  return left.startsWith(right) || right.startsWith(left);
}

// One Shipping comment, reduced to what the gate needs. Anything that is not a
// determination (a human comment, a ping, a card note) parses to null.
export function parseShippingComment({ body = '', url = null, createdAt = null } = {}) {
  const lines = String(body).split(/\r?\n/);
  const header = HEADER.exec(lines[0]?.trim() ?? '');
  if (!header) return null;
  const verdict = header[1].toUpperCase().replace(/\s+/g, '');
  if (!['PASS', 'PASS+NOTES', 'FAIL', 'NOVERDICT'].includes(verdict)) return null;
  const rest = lines.slice(1).join('\n');
  const commit = COMMIT.exec(rest)?.[1]?.toLowerCase() ?? null;
  return {
    verdict: verdict === 'NOVERDICT' ? null : verdict,
    round: header[2] ? Number(header[2]) : null,
    of: header[3] ? Number(header[3]) : null,
    sha: commit,
    card: CARD.exec(rest)?.[1] ?? null,
    pr: PULL.exec(rest) ? Number(PULL.exec(rest)[1]) : null,
    url,
    createdAt,
  };
}

export function determinationsFor(comments, { card, pr }) {
  return (comments ?? [])
    .map(parseShippingComment)
    .filter(Boolean)
    .filter(item => item.pr === pr && item.card === card);
}

// The verdict that decides the merge is the newest one, and only if it judged
// the commit that is on the pull request now.
export function decideLanding({ comments, card, pr, head, headUrl = null }) {
  const found = determinationsFor(comments, { card, pr });
  const verdicts = found.map(item => item.verdict ?? 'NO VERDICT');
  const base = { card, pr, head, rounds: found.length, verdicts, commentUrl: found.at(-1)?.url ?? null };
  if (found.length === 0) {
    return { ...base, pass: false, verdict: null, reason: `no Shipping determination on pull request #${pr} names ${card}` };
  }
  const latest = found.at(-1);
  if (!latest.verdict) {
    return { ...base, pass: false, verdict: null, reason: `the newest determination on pull request #${pr} came back without a verdict` };
  }
  if (!PASSING.has(latest.verdict)) {
    return { ...base, pass: false, verdict: latest.verdict, reason: `the newest determination on pull request #${pr} says ${latest.verdict}` };
  }
  if (!sameCommit(latest.sha, head)) {
    return {
      ...base,
      pass: false,
      verdict: latest.verdict,
      reason: `the newest determination judged ${latest.sha}, but the pull request head is ${head}${headUrl ? ` (${headUrl})` : ''}`,
    };
  }
  return { ...base, pass: true, verdict: latest.verdict, reason: `${latest.verdict} on ${latest.sha}` };
}

export function gateNote(decision) {
  if (decision.pass) return `${decision.card}: ${decision.reason}, ${decision.rounds} Shipping round${decision.rounds === 1 ? '' : 's'}.`;
  return `${decision.card}: not merging, because ${decision.reason}.`;
}
