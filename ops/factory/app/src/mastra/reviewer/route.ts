import { createHmac, timingSafeEqual } from 'node:crypto';
import { registerApiRoute } from '@mastra/core/server';
import { reviewInput } from './workflows/cross-maker-review-workflow';

const serverStartedAt = Date.now();

function safeErrorType(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : 'Error';
}

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
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const validated = reviewInput.safeParse(parsed);
    if (!validated.success) return c.json({ error: 'Invalid pull request identity' }, 400);
    const input = validated.data;
    try {
      const workflow = mastra.getWorkflow('crossMakerReviewWorkflow');
      const resourceId = `${input.owner}/${input.repo}#${input.pullNumber}`;
      const active = await workflow.listActiveWorkflowRuns();
      for (const prior of active.runs.filter(run => run.resourceId === resourceId)) {
        await (await workflow.createRun({ runId: prior.runId })).cancel();
        console.info(`Cross-maker review superseded: job=${prior.runId} pr=${resourceId}`);
      }
      const run = await workflow.createRun({ resourceId });
      const { runId } = await run.startAsync({ inputData: input });
      console.info(`Cross-maker review started: job=${runId} pr=${input.owner}/${input.repo}#${input.pullNumber} head=${input.headSha}`);
      return c.json({ jobId: runId }, 202);
    } catch (error) {
      console.error(`Cross-maker review start failed: pr=${input.owner}/${input.repo}#${input.pullNumber} type=${safeErrorType(error)}`, error);
      return c.json({ error: 'Review could not start' }, 503);
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
      const workflow = mastra.getWorkflow('crossMakerReviewWorkflow');
      const run = await workflow.getWorkflowRunById(jobId);
      if (!run) return c.json({ error: 'Review job not found' }, 404);
      if (run.status === 'success') {
        console.info(`Cross-maker review completed: job=${jobId} verdict=${run.result?.verdict ?? 'missing'} head=${run.result?.headSha ?? 'missing'}`);
        return c.json({ status: 'success', verdict: run.result });
      }
      const createdAt = run.createdAt ? new Date(run.createdAt).getTime() : NaN;
      if (['pending', 'running', 'waiting'].includes(run.status) && createdAt < serverStartedAt) {
        await (await workflow.createRun({ runId: jobId })).cancel();
        console.error(`Cross-maker review interrupted by restart: job=${jobId}`);
        return c.json({ status: 'canceled', error: 'Review interrupted by server restart' });
      }
      if (!['pending', 'running', 'waiting'].includes(run.status)) {
        console.error(`Cross-maker review stopped: job=${jobId} status=${run.status} type=${safeErrorType(run.error)}`, run.error);
        return c.json({ status: run.status, error: 'Review job failed' });
      }
      return c.json({ status: run.status });
    } catch (error) {
      console.error(`Cross-maker review status failed: job=${jobId} type=${safeErrorType(error)}`, error);
      return c.json({ error: 'Review status unavailable' }, 503);
    }
  },
});

export const reviewerCancelRoute = registerApiRoute('/julia/review-pr/:jobId', {
  method: 'DELETE',
  requiresAuth: false,
  createHandler: async ({ mastra }) => async c => {
    const jobId = c.req.param('jobId');
    if (!validReviewSignature(jobId, c.req.header('x-julia-review-signature'), process.env.JULIA_REVIEW_ROUTE_SECRET))
      return c.json({ error: 'Unauthorized' }, 401);
    try {
      const workflow = mastra.getWorkflow('crossMakerReviewWorkflow');
      const run = await workflow.getWorkflowRunById(jobId);
      if (!run) return c.json({ error: 'Review job not found' }, 404);
      if (!['pending', 'running', 'waiting'].includes(run.status)) return c.json({ status: run.status });
      await (await workflow.createRun({ runId: jobId })).cancel();
      console.info(`Cross-maker review canceled: job=${jobId}`);
      return c.json({ status: 'canceled' });
    } catch (error) {
      console.error(`Cross-maker review cancellation failed: job=${jobId} type=${safeErrorType(error)}`, error);
      return c.json({ error: 'Review cancellation unavailable' }, 503);
    }
  },
});
