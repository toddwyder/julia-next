import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

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
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`Mastra reviewer start returned HTTP ${response.status}`);
const { jobId } = await response.json();
if (!/^[a-zA-Z0-9-]{1,100}$/.test(jobId ?? '')) throw new Error('Mastra reviewer returned an invalid job id.');
console.log(`Cross-maker review job ${jobId} started for ${headSha}`);
let review;
let completed = false;
const statusSignature = createHmac('sha256', process.env.JULIA_REVIEW_ROUTE_SECRET).update(jobId).digest('hex');
const jobUrl = `https://julia-factory.tail91f394.ts.net/julia/review-pr/${jobId}`;
async function cancelJob() {
  try {
    const canceled = await fetch(jobUrl, {
      method: 'DELETE', headers: { 'x-julia-review-signature': statusSignature },
      signal: AbortSignal.timeout(5000),
    });
    if (!canceled.ok) console.error(`Could not cancel Cross-maker job ${jobId}: HTTP ${canceled.status}`);
  } catch {
    console.error(`Could not cancel Cross-maker job ${jobId}: request failed`);
  }
}
// Cancel the paid server run when Node receives an action cancellation signal.
// https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation
if (process.env.GITHUB_ACTIONS === 'true' && process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void cancelJob().finally(() => process.exit(130));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
// Bound elapsed wall time even when individual status requests are slow.
const deadline = Date.now() + 30 * 60_000;
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(30_000, remaining)));
    if (Date.now() >= deadline) break;
    let statusResponse;
    try {
      statusResponse = await fetch(jobUrl, {
        headers: { 'x-julia-review-signature': statusSignature },
        signal: AbortSignal.timeout(Math.min(30_000, Math.max(1, deadline - Date.now()))),
      });
    } catch {
      throw new Error(`Cross-maker review job ${jobId} status request failed or timed out`);
    }
    if (!statusResponse.ok) throw new Error(`Mastra reviewer status returned HTTP ${statusResponse.status} for job ${jobId}`);
    const job = await statusResponse.json();
    if (job.status === 'success') {
      completed = true;
      review = job.verdict;
      break;
    }
    if (!['pending', 'running', 'waiting'].includes(job.status))
      throw new Error(`Mastra reviewer job ${jobId} stopped with status ${job.status}`);
    console.log(`Cross-maker review job ${jobId} is ${job.status}`);
  }
} catch (error) {
  await cancelJob();
  throw error;
}
if (!completed) {
  await cancelJob();
  throw new Error(`Cross-maker review job ${jobId} did not finish within 30 minutes.`);
}
if (!review || typeof review !== 'object' || !['APPROVE', 'REQUEST_CHANGES'].includes(review.verdict)
    || review.headSha !== headSha || typeof review.body !== 'string' || !review.body)
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
if (!reviewResponse.ok) throw new Error(`GitHub review submission failed: HTTP ${reviewResponse.status}`);
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
    throw new Error(`GitHub review relay failed: HTTP ${relayResponse.status}`);
  console.log(`Relayed requested changes to Factory via PR comment ${(await relayResponse.json()).html_url}`);
}
