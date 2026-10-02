import { CompositeAuth, SimpleAuth } from '@mastra/core/server';
import type { IMastraAuthProvider } from '@mastra/auth';

// Supported static-token authentication for the timer, composed with WorkOS.
// https://mastra.ai/docs/auth/simple-auth
// The service identity cannot change traces, run agents, or access Factory cards.
export function costNoteAuth(workos: IMastraAuthProvider, token?: string): IMastraAuthProvider {
  if (!token?.trim()) return workos;
  const reader = new SimpleAuth({
    tokens: { [token]: { id: 'monday-note-reader', role: 'observability-reader' } },
    authorizeUser: (_user, request) => {
      const web = request instanceof Request ? request : request.raw;
      return Boolean(web && web.method === 'GET' &&
        /^(?:\/api\/observability\/traces\/(?:light|[^/]+\/light)|\/julia\/cost-traces\/[^/]+\/spans(?:\/[^/]+)?)$/.test(new URL(web.url, 'http://localhost').pathname));
    },
  });
  return new CompositeAuth([reader, workos]);
}
