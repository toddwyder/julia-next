/**
 * The supported way an operator (the systemd timer) asks the running Factory
 * process to run its DuckDB observability retention now (JUL-140).
 *
 * DuckDB allows one writer across processes, so the prune must run inside the
 * process that already holds the store. This route is that door: the systemd
 * unit POSTs to it, the running app runs the same supported `prune()` +
 * `CHECKPOINT` the daily schedule runs, and the response reports what happened.
 *
 * It is a custom route because Mastra exposes no supported unauthenticated
 * workflow-trigger door for a host timer; the established repository pattern
 * for that is a signed route (`reviewer/route.ts`). The body is empty; the
 * HMAC of an empty string with `JULIA_RETENTION_ROUTE_SECRET` is the
 * credential, so the secret never travels in the request.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { registerApiRoute } from '@mastra/core/server';
import { runObservabilityRetention } from './observability-retention.js';

export function validRetentionSignature(signature: string | undefined, secret: string | undefined): boolean {
  if (!secret || !signature || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update('').digest('hex');
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}

export const observabilityRetentionRoute = registerApiRoute('/julia/run-retention', {
  method: 'POST',
  requiresAuth: false,
  handler: async c => {
    const signature = c.req.header('x-julia-retention-signature');
    if (!validRetentionSignature(signature, process.env.JULIA_RETENTION_ROUTE_SECRET)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    try {
      const result = await runObservabilityRetention();
      return c.json({
        action: result.action,
        bytesBefore: result.bytesBefore,
        bytesAfter: result.bytesAfter,
        pruned: result.pruned,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Retention run failed';
      return c.json({ error: message }, 503);
    }
  },
});
