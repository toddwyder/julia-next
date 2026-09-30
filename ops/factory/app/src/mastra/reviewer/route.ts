import { createHmac, timingSafeEqual } from 'node:crypto';
import { registerApiRoute } from '@mastra/core/server';
import { reviewPullRequest } from './review-pr';

export function validReviewSignature(body: string, signature: string | undefined, secret: string | undefined): boolean {
  if (!secret || !signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

export const reviewerRoute = registerApiRoute('/julia/review-pr', {
  method: 'POST',
  requiresAuth: false,
  handler: async c => {
    const body = await c.req.text();
    if (!validReviewSignature(body, c.req.header('x-julia-review-signature'), process.env.JULIA_REVIEW_ROUTE_SECRET))
      return c.json({ error: 'Unauthorized' }, 401);
    let input: { owner?: string; repo?: string; pullNumber?: number; headSha?: string };
    try { input = JSON.parse(body); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    if (!input.owner || !input.repo || !input.pullNumber || !input.headSha)
      return c.json({ error: 'Missing pull request identity' }, 400);
    try {
      const result = await reviewPullRequest(input.owner, input.repo, input.pullNumber, input.headSha);
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Review failed';
      return c.json({ error: message }, 503);
    }
  },
});
