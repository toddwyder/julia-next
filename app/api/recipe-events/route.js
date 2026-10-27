import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

import { FIREBASE_WEB_CONFIG } from '../../../lib/firebase-project.js';
import { parseRecipeEvent, recordRecipeEvent } from '../../../lib/recipe-events.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Only a browser signed in to Julia's Firebase project can report, and only
// the fields parseRecipeEvent allows.
export async function POST(request) {
  const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) return new Response(null, { status: 401 });
  try {
    const app = getApps()[0] ?? initializeApp({ projectId: FIREBASE_WEB_CONFIG.projectId });
    await getAuth(app).verifyIdToken(token);
  } catch {
    return new Response(null, { status: 401 });
  }
  const event = parseRecipeEvent(await request.json().catch(() => null));
  if (!event) return new Response(null, { status: 400 });
  const result = await recordRecipeEvent(event);
  console.info(JSON.stringify({ event: 'julia-next.recipe-event', ...event, axiom: result.axiom.status, sentry: result.sentry?.status }));
  return new Response(null, { status: 204 });
}
