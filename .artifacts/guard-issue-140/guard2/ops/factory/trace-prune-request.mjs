#!/usr/bin/env node
// trace-prune-request.mjs -- issue #140 review: the systemd route that makes
// the running Factory process actually run its supported DuckDB retention.
//
// The earlier unit only ran the read-only size check and set an env flag that
// claimed retention was configured. That is not a prune. DuckDB allows one
// writer across processes, so the prune has to run inside the process that
// holds the store: this program signs an empty body with the root-owned route
// secret and POSTs to the app's `/julia/run-retention` route, which runs the
// same supported `prune()` + `CHECKPOINT` the daily schedule runs. A non-zero
// exit is a failed prune and shows in the journal; it never pretends success.
//
// No credential is ever printed. `requestRetentionRun` is the testable seam;
// `main` is the only place the real environment and `fetch` are read.
import { createHmac } from 'node:crypto';

/** The route the app registers (see app/src/mastra/observability-retention-route.ts). */
export const RETENTION_ROUTE_PATH = '/julia/run-retention';

/**
 * The HMAC the route checks: HMAC-SHA256 of the empty request body. The secret
 * never leaves this process, and the request carries no data.
 */
export function retentionSignature(secret) {
  return createHmac('sha256', secret).update('').digest('hex');
}

/**
 * Ask the running Factory process to run retention now and return its report.
 *
 * Any transport error, non-2xx status, or `error` field throws: the caller must
 * treat a failed prune as failed, never as a silent success.
 */
export async function requestRetentionRun({ factoryUrl, secret, fetchImpl = fetch }) {
  if (!factoryUrl) throw new Error('retention request requires the Factory URL');
  if (!secret) throw new Error('retention request requires the route secret');
  const base = factoryUrl.replace(/\/$/, '');
  const response = await fetchImpl(`${base}${RETENTION_ROUTE_PATH}`, {
    method: 'POST',
    headers: { 'x-julia-retention-signature': retentionSignature(secret) },
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    // fall through to the status check below
  }
  if (!response.ok || body?.error) {
    const detail = body?.error ?? `HTTP ${response.status}`;
    throw new Error(`retention run failed: ${detail}`);
  }
  return body;
}

async function main() {
  const factoryUrl = process.env.MONDAY_NOTE_FACTORY_URL?.trim() || process.env.MASTRACODE_PUBLIC_URL?.trim();
  const secret = process.env.JULIA_RETENTION_ROUTE_SECRET?.trim();
  const report = await requestRetentionRun({ factoryUrl, secret });
  console.log(
    `trace-retention action=${report.action} bytes_before=${report.bytesBefore} bytes_after=${report.bytesAfter} ` +
      `tables=${Array.isArray(report.pruned) ? report.pruned.length : 0}`,
  );
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`trace-retention: failed: ${error.message}`);
    process.exit(1);
  });
}
