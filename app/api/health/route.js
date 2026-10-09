// A deliberately dynamic route handler: JUL-44 step 4.
//
// The rest of this app is static, so on Vercel no Node server runtime would
// ever start and `instrumentation.js`'s `register()` (and its boot telemetry)
// would never run. This handler forces a Node runtime to boot in production.
// It uses only the web-standard `Response`, so it stays testable and has no
// dependency on Next.js internals.
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ status: 'ok', ...(process.env.VERCEL_GIT_COMMIT_SHA ? { commit: process.env.VERCEL_GIT_COMMIT_SHA } : {}) });
}
