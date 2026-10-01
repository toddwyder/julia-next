import { createHmac, timingSafeEqual } from 'node:crypto';
import { registerApiRoute } from '@mastra/core/server';

export function validReviewSignature(body: string, signature: string | undefined, secret: string | undefined): boolean {
  if (!secret || !signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

export const reviewerRoute = registerApiRoute('/julia/review-pr', {
  method: 'POST',
  requiresAuth: false,
  // `createHandler` gives the handler the running Mastra instance, so the
  // reviewer can run the app's registered, supported batching workflow for
  // large pull requests.
  createHandler: async ({ mastra }) => async c => {
    const body = await c.req.text();
    if (!validReviewSignature(body, c.req.header('x-julia-review-signature'), process.env.JULIA_REVIEW_ROUTE_SECRET))
      return c.json({ error: 'Unauthorized' }, 401);
    let input: { owner?: string; repo?: string; pullNumber?: number; headSha?: string };
    try { input = JSON.parse(body); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    if (!input.owner || !input.repo || !input.pullNumber || !input.headSha)
      return c.json({ error: 'Missing pull request identity' }, 400);
    try {
      const workflow = mastra.getWorkflow('crossMakerReviewWorkflow');
      const run = await workflow.createRun();
      const { runId } = await run.startAsync({ inputData: input });
      console.info(`Cross-maker review started: job=${runId} pr=${input.owner}/${input.repo}#${input.pullNumber} head=${input.headSha}`);
      return c.json({ jobId: runId }, 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Review failed';
      return c.json({ error: message }, 503);
    }
  },
});

export const reviewerStatusRoute = registerApiRoute('/julia/review-pr/:jobId', {
  method: 'GET',
  requiresAuth: false,
  createHandler: async ({ mastra }) => async c => {
    const jobId = c.req.param('jobId');
    if (!validReviewSignature(jobId, c.req.header('x-julia-review-signature'), process.env.JULIA_REVIEW_ROUTE_SECRET))
      return c.json({ error: 'Unauthorized' }, 401);
    try {
      const run = await mastra.getWorkflow('crossMakerReviewWorkflow').getWorkflowRunById(jobId);
      if (!run) return c.json({ error: 'Review job not found' }, 404);
      if (run.status === 'success') return c.json({ status: 'success', verdict: run.result });
      if (!['pending', 'running', 'waiting'].includes(run.status)) {
        console.error(`Cross-maker review stopped: job=${jobId} status=${run.status} error=${run.error?.message ?? 'unknown'}`);
        return c.json({ status: run.status, error: run.error?.message ?? 'Review stopped' });
      }
      return c.json({ status: run.status });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Review status unavailable';
      return c.json({ error: message }, 503);
    }
  },
});
