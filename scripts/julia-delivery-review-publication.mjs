// A completed delivery review is durable only after GitHub confirms the
// commit-bound PR comment below. Local run files and worker output remain
// evidence, but are never a substitute for this public record.
import { spawnSync } from 'node:child_process';

const SHA = /^[0-9a-f]{40}$/i;
const DIGEST = /^[0-9a-f]{64}$/i;
const REPO = 'toddwyder/julia-next';

function gh(args, { input } = {}) {
  return spawnSync('gh', ['api', ...args], { encoding: 'utf8', input, windowsHide: true });
}

function json(run, args, options) {
  const result = run(args, options);
  if (result?.status !== 0) throw new Error(`GitHub API request failed: ${String(result?.stderr ?? result?.error?.message ?? '').trim() || 'gh api did not succeed'}`);
  try { return JSON.parse(result.stdout); } catch { throw new Error('GitHub API returned invalid JSON'); }
}

function reviewKind(scope) { return scope?.kind === 'repair' ? 'REPAIR' : 'INITIAL'; }

function markerOf({ candidate, input, round, verdict, state = 'completed' }) {
  if (!SHA.test(candidate?.commit ?? '') || !DIGEST.test(input?.digest ?? '') || !Number.isInteger(round) || round < 0 || !['PASS', 'FAIL', 'INCONCLUSIVE'].includes(verdict) || !['completed', 'incomplete'].includes(state)) throw new Error('review publication has no valid candidate, input identity, round, verdict or state');
  return `<!-- julia-delivery-review:v1 candidate=${candidate.commit} input=${input.digest} round=${round} verdict=${verdict} state=${state} -->`;
}

function evidenceLinks(candidate, input) {
  const links = [
    `- Candidate commit: [\`${candidate.commit}\`](https://github.com/${REPO}/commit/${candidate.commit})`,
  ];
  if (SHA.test(candidate.base ?? '')) links.push(`- Checked diff: [\`${candidate.base.slice(0, 12)}...${candidate.commit.slice(0, 12)}\`](https://github.com/${REPO}/compare/${candidate.base}...${candidate.commit})`);
  const files = Object.keys(input.sources ?? {}).filter(source => /^(file|repair-file):/.test(source)).map(source => source.replace(/^(file|repair-file):/, ''));
  for (const file of [...new Set(files)].sort()) links.push(`- Reviewed code: [\`${file}\`](https://github.com/${REPO}/blob/${candidate.commit}/${file})`);
  return links;
}

export function reviewCommentBody(publication) {
  const { issueId, round, candidate, input, verdict, report = null, state = 'completed', reason = null } = publication;
  const marker = markerOf(publication);
  const kind = reviewKind(input.scope);
  const authoritative = state === 'completed' && ['PASS', 'FAIL'].includes(verdict);
  const findings = Array.isArray(report?.findings) ? report.findings : [];
  const findingText = findings.length
    ? findings.map((finding, index) => `- **F${index + 1}:** ${finding.requirement ?? 'Blocking finding'} — ${finding.file ?? 'unspecified file'}:${finding.location ?? '?'}. ${finding.consequence ?? ''}`.trim()).join('\n')
    : '- No blocking findings.';
  return [
    marker,
    `## Julia delivery review — ${kind} — ${verdict}`,
    '',
    authoritative
      ? '> **Authoritative completed review.** This verdict is bound to the candidate and checked input below.'
      : `> **Incomplete or inconclusive attempt — not an authoritative review verdict.** ${reason ?? 'Do not use this attempt to accept or reject the candidate.'}`,
    '',
    `- Delivery item: \`${issueId}\``,
    `- Review round: ${round + 1} (${kind.toLowerCase()})`,
    `- Candidate SHA: \`${candidate.commit}\``,
    `- Review input digest: \`sha256:${input.digest}\``,
    '',
    '### Durable evidence',
    ...evidenceLinks(candidate, input),
    '',
    '### Blocking findings',
    findingText,
    '',
    '### Checked review report',
    '```json',
    JSON.stringify(report ?? { reason }, null, 2),
    '```',
  ].join('\n');
}

function matchingMarker(comment, marker) { return typeof comment?.body === 'string' && comment.body.includes(marker); }

function confirmed(comment, expected) {
  return Number.isSafeInteger(comment?.id) && comment.body === expected && typeof comment.html_url === 'string' && comment.html_url.startsWith('https://github.com/');
}

// The laptop's existing signed-in GitHub CLI is the Linear-card GitHub
// mechanism. It deliberately does not use Factory's publisher App.
export function githubReviewPublisher({ run = gh } = {}) {
  return async (publication) => {
    const expected = reviewCommentBody(publication);
    const marker = markerOf(publication);
    const { candidate } = publication;
    const prs = json(run, ['-H', 'Accept: application/vnd.github+json', `repos/${REPO}/commits/${candidate.commit}/pulls`]);
    const exact = Array.isArray(prs) ? prs.filter(pr => pr?.head?.sha === candidate.commit) : [];
    if (exact.length !== 1 || !Number.isSafeInteger(exact[0].number)) throw new Error('GitHub has no single pull request at the reviewed candidate SHA; durable review publication cannot be confirmed');
    const pr = exact[0];
    const comments = json(run, ['-H', 'Accept: application/vnd.github+json', `repos/${REPO}/issues/${pr.number}/comments?per_page=100`]);
    if (!Array.isArray(comments) || comments.length === 100) throw new Error('GitHub review-comment history is incomplete; durable review publication cannot be confirmed');
    const prior = comments.filter(comment => matchingMarker(comment, marker));
    if (prior.length > 1) throw new Error('multiple GitHub records claim this review identity; durable review publication cannot be confirmed');
    let comment = prior[0];
    if (!comment) comment = json(run, ['--method', 'POST', '--input', '-', '-H', 'Accept: application/vnd.github+json', `repos/${REPO}/issues/${pr.number}/comments`], { input: JSON.stringify({ body: expected }) });
    if (!Number.isSafeInteger(comment?.id)) throw new Error('GitHub did not return a review-comment identity; durable review publication cannot be confirmed');
    const readBack = json(run, ['-H', 'Accept: application/vnd.github+json', `repos/${REPO}/issues/comments/${comment.id}`]);
    if (!confirmed(readBack, expected)) throw new Error('GitHub review record could not be confirmed after publication');
    return { confirmed: true, authoritative: publication.state !== 'incomplete', id: readBack.id, url: readBack.html_url, pr: pr.number };
  };
}
