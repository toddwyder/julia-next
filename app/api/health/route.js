// A deliberately dynamic route handler: JUL-44 step 4.
//
// The rest of this app is static, so on Vercel no Node server runtime would
// ever start and `instrumentation.js`'s `register()` (and its boot telemetry)
// would never run. Reading request headers forces a dynamic Node runtime to
// boot in production while keeping the handler testable with no Next.js imports.
export async function GET(request) {
  request?.headers?.get('x-health-probe');
  return Response.json({ status: 'ok', ...(process.env.VERCEL_GIT_COMMIT_SHA ? { commit: process.env.VERCEL_GIT_COMMIT_SHA } : {}) });
}
