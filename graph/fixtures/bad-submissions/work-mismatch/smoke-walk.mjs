// smoke-walk.mjs: performs only a page-load check on the base URL.
// Makes exactly one request and returns no per-step results (violates AC4).
export async function smokeWalk(baseUrl, { fetch = globalThis.fetch } = {}) {
  const res = await fetch(baseUrl);
  return { ok: res.ok, status: res.status };
}
