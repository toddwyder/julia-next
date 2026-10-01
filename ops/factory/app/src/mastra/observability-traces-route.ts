/**
 * Unauthenticated localhost route for reading observability trace records.
 *
 * Exposes Mastra's DuckDB observability storage domain to local programs
 * (e.g. `ops/factory/monday-note-run.mjs`) without requiring WorkOS session auth.
 * Restricted to loopback callers only and pagination is capped.
 */
import { registerApiRoute } from '@mastra/core/server';

function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const parts = host.split(':');
  const hostname = parts[0]?.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function isLoopbackIp(ip: string | undefined): boolean {
  if (!ip) return false;
  const trimmed = ip.trim().toLowerCase();
  return (
    trimmed === '127.0.0.1' ||
    trimmed === '::1' ||
    trimmed === '::ffff:127.0.0.1' ||
    trimmed === 'localhost'
  );
}

function getSocketRemoteAddress(c: any): string | undefined {
  const nodeReq = c.env?.incoming ?? (c.req as any)?.raw;
  const socket = nodeReq?.socket ?? nodeReq?.client;
  return socket?.remoteAddress;
}

export const tracesRoute = registerApiRoute('/julia/observability/traces', {
  method: 'GET',
  requiresAuth: false,
  createHandler: async ({ mastra }) => async (c) => {
    try {
      // Loopback access restriction: only local callers on the host machine are permitted.
      // Check underlying TCP socket first if available to prevent Host/X-Forwarded spoofing.
      const socketIp = getSocketRemoteAddress(c);
      if (socketIp && !isLoopbackIp(socketIp)) {
        return c.json({ error: 'Forbidden: loopback access only' }, 403);
      }

      const host = c.req.header('host');
      const forwardedFor = c.req.header('x-forwarded-for');
      const realIp = c.req.header('x-real-ip');

      if (!isLoopbackHost(host)) {
        return c.json({ error: 'Forbidden: loopback access only' }, 403);
      }

      if (forwardedFor) {
        const ips = forwardedFor.split(',').map((s: string) => s.trim());
        if (!ips.every((ip: string) => isLoopbackIp(ip))) {
          return c.json({ error: 'Forbidden: loopback access only' }, 403);
        }
      }

      if (realIp && !isLoopbackIp(realIp)) {
        return c.json({ error: 'Forbidden: loopback access only' }, 403);
      }

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
          const parsed = JSON.parse(paginationParam);
          const page = Math.max(0, Number(parsed.page) || 0);
          const perPage = Math.min(Math.max(1, Number(parsed.perPage) || 50), 100);
          pagination = { page, perPage };
        } catch {
          return c.json({ error: 'Invalid pagination query param' }, 400);
        }
      } else {
        pagination = { page: 0, perPage: 50 };
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
