import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
const pullNumber = event.pull_request?.number;
const headSha = event.pull_request?.head?.sha;
if (!pullNumber || !headSha || !process.env.JULIA_REVIEW_ROUTE_SECRET || !process.env.GITHUB_TOKEN)
  throw new Error('Missing PR identity or reviewer credentials.');

const body = JSON.stringify({ owner, repo, pullNumber, headSha });
const signature = createHmac('sha256', process.env.JULIA_REVIEW_ROUTE_SECRET).update(body).digest('hex');
const response = await fetch('https://julia-factory.tail91f394.ts.net/julia/review-pr', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-julia-review-signature': signature },
  body,
});
if (!response.ok) throw new Error(`Mastra reviewer returned HTTP ${response.status}: ${await response.text()}`);
const { jobId } = await response.json();
if (!/^[a-zA-Z0-9-]{1,100}$/.test(jobId ?? '')) throw new Error('Mastra reviewer returned an invalid job id.');
console.log(`Cross-maker review job ${jobId} started for ${headSha}`);
let review;
// eslint-disable-next-line no-constant-condition -- #190 requires a 30-second status poll; GitHub Actions has no native watcher for a custom Mastra route. https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjobstimeout-minutes
while (true) {
  await new Promise(resolve => setTimeout(resolve, 30_000));
  const statusSignature = createHmac('sha256', process.env.JULIA_REVIEW_ROUTE_SECRET).update(jobId).digest('hex');
  const statusResponse = await fetch(`https://julia-factory.tail91f394.ts.net/julia/review-pr/${jobId}`, {
    headers: { 'x-julia-review-signature': statusSignature },
  });
  if (!statusResponse.ok) throw new Error(`Mastra reviewer status returned HTTP ${statusResponse.status}: ${await statusResponse.text()}`);
  const job = await statusResponse.json();
  if (job.status === 'success') {
    review = job.verdict;
    break;
  }
  if (!['pending', 'running', 'waiting'].includes(job.status))
    throw new Error(`Mastra reviewer stopped with status ${job.status}: ${job.error ?? 'unknown error'}`);
  console.log(`Cross-maker review job ${jobId} is ${job.status}`);
}
if (!['APPROVE', 'REQUEST_CHANGES'].includes(review.verdict) || review.headSha !== headSha || !review.body)
  throw new Error('Mastra reviewer returned an invalid or stale verdict.');

const currentResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`, {
  headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json' },
});
if (!currentResponse.ok) throw new Error(`Cannot recheck PR head: HTTP ${currentResponse.status}`);
const current = await currentResponse.json();
if (current.head.sha !== headSha) throw new Error('PR head changed after Mastra review.');

const reviewResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
  },
  body: JSON.stringify({ commit_id: headSha, body: review.body, event: review.verdict }),
});
if (!reviewResponse.ok) throw new Error(`GitHub review submission failed: HTTP ${reviewResponse.status}: ${await reviewResponse.text()}`);
const submitted = await reviewResponse.json();
console.log(`Submitted ${submitted.state} review ${submitted.html_url} for ${headSha}`);

// Factory routes PR conversation comments back to the original Work session.
// GitHub review webhooks alone are not routed there in the installed connector.
if (review.verdict === 'REQUEST_CHANGES') {
  const relayResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      body: `Cross-maker reviewer requested changes on ${headSha}: ${submitted.html_url}\n\nBuilder: address that GitHub review and push the repair to this PR branch.`,
    }),
  });
  if (!relayResponse.ok)
    throw new Error(`GitHub review relay failed: HTTP ${relayResponse.status}: ${await relayResponse.text()}`);
  console.log(`Relayed requested changes to Factory via PR comment ${(await relayResponse.json()).html_url}`);
}
