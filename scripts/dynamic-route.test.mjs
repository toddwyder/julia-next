// dynamic-route.test.mjs -- JUL-44 step 4 invariant.
//
// A Next.js app deployed on Vercel with no dynamic route is built as an
// all-static site: no Node server runtime ever starts, so `instrumentation.js`'s
// `register()` never runs and the boot telemetry never fires. The deployment
// must therefore always contain at least one route handler that opts out of
// static rendering. This test is the tripwire that fails loudly if the app
// silently drifts back to all-static.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const APP_DIR = path.resolve(import.meta.dirname, '..', 'app');

const DYNAMIC_MARKERS = [
  /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/,
  /export\s+const\s+revalidate\s*=\s*0\b/,
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function routeFiles() {
  return walk(APP_DIR).filter((p) => path.basename(p) === 'route.js');
}

test('at least one app/**/route.js opts out of static rendering', () => {
  const routes = routeFiles();
  assert.ok(routes.length > 0, 'app/ must contain at least one route.js handler');

  const dynamic = routes.filter((file) => {
    const source = readFileSync(file, 'utf8');
    return DYNAMIC_MARKERS.some((marker) => marker.test(source));
  });

  assert.ok(
    dynamic.length > 0,
    `no route.js under app/ is marked dynamic; a Node runtime will never boot.\n` +
      `route files found: ${routes.map((p) => path.relative(APP_DIR, p)).join(', ')}`,
  );
});
