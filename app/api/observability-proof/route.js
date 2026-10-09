import { timingSafeEqual } from 'node:crypto';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Operator-controlled proof of a real caught application exception. Disabled
// unless a temporary secret is configured; never put that secret in the URL.
export async function POST(request) {
  const expected = process.env.JULIA_OBSERVABILITY_PROOF_TOKEN;
  const supplied = request.headers.get('x-julia-proof-token');
  if (!expected || !supplied || Buffer.byteLength(expected) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return new Response(null, { status: 404 });
  throw new Error('julia-next: controlled application error proof');
}
