// health-route.test.mjs -- JUL-44 step 4, seam S1.
//
// S1 is the HTTP behavior of the dynamically rendered health endpoint, not
// merely the presence of a `force-dynamic` marker (that invariant is the
// separate tripwire in dynamic-route.test.mjs). This test imports the handler
// and calls it directly, so it holds the route to its stated contract:
// status 200, JSON content type, and the exact body `{"status":"ok"}`.
//
// The handler uses only the web-standard `Response`, so this runs under
// `node --test` with no node_modules installed.
import test from 'node:test';
import assert from 'node:assert/strict';

import { GET } from '../app/api/health/route.js';

test('GET /api/health returns 200 JSON with the exact health body', async () => {
  const response = await GET();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.deepEqual(await response.json(), { status: 'ok' });
});
