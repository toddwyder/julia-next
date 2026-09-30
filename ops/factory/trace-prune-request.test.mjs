// trace-prune-request.test.mjs -- issue #140 review: the systemd route must run
// the actual supported prune, not only a read-only check.
//
// The unit's ExecStart is this program. It signs an empty body with the
// root-owned route secret and POSTs to the running app, which runs the same
// supported DuckDB `prune()` + `CHECKPOINT` the daily schedule runs. These tests
// drive a fake `fetch`, so nothing reaches a live service and no credential is
// printed. A failed prune must throw (and so exit non-zero), never read as ok.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { RETENTION_ROUTE_PATH, requestRetentionRun, retentionSignature } from './trace-prune-request.mjs';

function fakeFetch(response) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        async json() { return response.body; },
      };
    },
  };
}

test('the request targets the app retention route with the signed empty body', async () => {
  const secret = 'route-secret';
  const fake = fakeFetch({ status: 200, body: { action: 'routine-prune', bytesBefore: 10, bytesAfter: 10, pruned: [] } });

  const report = await requestRetentionRun({ factoryUrl: 'https://factory.example/', secret, fetchImpl: fake.fetch });

  assert.equal(report.action, 'routine-prune');
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].url, `https://factory.example${RETENTION_ROUTE_PATH}`);
  assert.equal(fake.calls[0].init.method, 'POST');
  // The signature is HMAC-SHA256 of the empty body, the same value the route
  // recomputes; the secret itself is never in the request.
  const expected = createHmac('sha256', secret).update('').digest('hex');
  assert.equal(fake.calls[0].init.headers['x-julia-retention-signature'], expected);
  assert.equal(JSON.stringify(fake.calls[0].init.headers).includes(secret), false);
});

test('a failed prune (HTTP error or error field) throws so the timer exits non-zero', async () => {
  const secret = 'route-secret';

  await assert.rejects(
    () => requestRetentionRun({ factoryUrl: 'https://factory.example', secret, fetchImpl: fakeFetch({ status: 503, body: { error: 'store still over budget' } }).fetch }),
    /store still over budget/,
  );
  await assert.rejects(
    () => requestRetentionRun({ factoryUrl: 'https://factory.example', secret, fetchImpl: fakeFetch({ status: 500, body: null }).fetch }),
    /HTTP 500/,
  );
});

test('a missing URL or secret fails before any request', async () => {
  const fake = fakeFetch({ status: 200, body: {} });
  await assert.rejects(() => requestRetentionRun({ factoryUrl: '', secret: 'x', fetchImpl: fake.fetch }), /Factory URL/);
  await assert.rejects(() => requestRetentionRun({ factoryUrl: 'https://x', secret: '', fetchImpl: fake.fetch }), /route secret/);
  assert.equal(fake.calls.length, 0);
});

test('the installed systemd unit runs this prune program, not the read-only checker', () => {
  const service = readFileSync(new URL('./julia-factory-trace-retention.service', import.meta.url), 'utf8');
  assert.match(service, /ExecStart=.*trace-prune-request\.mjs/);
  assert.doesNotMatch(service, /ExecStart=.*trace-retention\.mjs/);
  // It no longer relies on an env flag claiming retention is configured.
  assert.doesNotMatch(service, /MASTRACODE_DUCKDB_RETENTION/);
  // The route secret comes from a root-owned environment file, never argv.
  assert.match(service, /EnvironmentFile=/);
});

test('the app exposes the signed retention route and hands the store a checkpoint', () => {
  // The systemd program calls this route inside the process that owns the
  // DuckDB lock; the entry must register the route and wire the documented
  // CHECKPOINT the guard needs. Text assertions so this runs without
  // node_modules.
  const entry = readFileSync(new URL('./app/src/mastra/index.ts', import.meta.url), 'utf8');
  const route = readFileSync(new URL('./app/src/mastra/observability-retention-route.ts', import.meta.url), 'utf8');

  assert.match(entry, /observabilityRetentionRoute/);
  assert.match(entry, /apiRoutes:.*observabilityRetentionRoute/s);
  assert.match(entry, /checkpoint:\s*\(\)\s*=>\s*observabilityDuckDB\.db\.execute\('CHECKPOINT'\)/);
  assert.match(route, /registerApiRoute\('\/julia\/run-retention'/);
  assert.match(route, /x-julia-retention-signature/);
  assert.match(route, /JULIA_RETENTION_ROUTE_SECRET/);
});
