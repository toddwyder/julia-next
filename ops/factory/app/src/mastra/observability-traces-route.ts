/**
 * Unauthenticated localhost route for reading observability trace records.
 *
 * Exposes Mastra's DuckDB observability storage domain to local programs
 * (e.g. `ops/factory/monday-note-run.mjs`) without requiring WorkOS session auth.
 */
import { registerApiRoute } from '@mastra/core/server';

export const tracesRoute = registerApiRoute('/julia/observability/traces', {
  method: 'GET',
  requiresAuth: false,
  createHandler: async ({ mastra }) => async (c) => {
    try {
      const startedAtParam = c.req.query('startedAt');
      const paginationParam = c.req.query('pagination');

      let startedAt: { start?: string; end?: string; startExclusive?: boolean; endExclusive?: boolean } | undefined;
      let pagination: { page?: number; perPage?: number } | undefined;

      if (startedAtParam) {
        try {
          startedAt = JSON.parse(startedAtParam);
        } catch {
          return c.json({ error: 'Invalid startedAt query param' }, 400);
        }
      }
      if (paginationParam) {
        try {
          pagination = JSON.parse(paginationParam);
        } catch {
          return c.json({ error: 'Invalid pagination query param' }, 400);
        }
      }

      const storage = mastra.getStorage();
      const obsStore: any = await storage?.getStore('observability');
      if (!obsStore) {
        return c.json({ error: 'Observability storage not configured' }, 503);
      }

      if (typeof obsStore.listTraces === 'function') {
        const result = await obsStore.listTraces({ startedAt, pagination });
        return c.json(result);
      }

      return c.json({ error: 'Observability storage does not support listTraces' }, 501);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to query observability traces';
      return c.json({ error: message }, 500);
    }
  },
});
