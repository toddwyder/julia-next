// relay.mjs -- the trusted Axiom-delivery boundary for JUL-43 journey events.
//
// Runs as its own systemd service (root, NOT the 'runner' builder account),
// bound to 127.0.0.1 only. Holds AXIOM_DATASET/AXIOM_TOKEN in its own
// process environment, loaded from a root-owned 0400 env file that lives
// outside this repo and outside any builder worktree. Builder code never
// sees the token: it only POSTs event JSON to this relay over localhost.
import http from 'node:http';

const PORT = Number(process.env.JOURNEY_RELAY_PORT || 8943);
const AXIOM_DATASET = process.env.AXIOM_DATASET;
const AXIOM_TOKEN = process.env.AXIOM_TOKEN;
const AXIOM_INGEST_URL = (dataset) => `https://api.axiom.co/v1/datasets/${encodeURIComponent(dataset)}/ingest`;

const SECRET_SHAPED_PATTERNS = [
  /\b(?:ghs|ghp|gho|ghu|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi,
];
function redact(v) {
  if (v === null || v === undefined) return v;
  let out = String(v);
  for (const p of SECRET_SHAPED_PATTERNS) out = out.replace(p, '[redacted]');
  return out;
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/events') {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 65536) req.destroy(); });
  req.on('end', async () => {
    let incoming;
    try {
      incoming = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ sent: false, error: 'invalid JSON' }));
      return;
    }
    const record = {
      _time: incoming._time || new Date().toISOString(),
      event: incoming.event,
      attempted: redact(incoming.attempted),
      reason: redact(incoming.reason),
      context: redact(incoming.context),
      tokensUsed: incoming.tokensUsed ?? null,
      quotaRemaining: incoming.quotaRemaining ?? null,
      interrupted: !!incoming.interrupted,
    };
    if (!AXIOM_DATASET || !AXIOM_TOKEN) {
      console.log(`(relay: not sent -- AXIOM_DATASET/AXIOM_TOKEN not configured on this relay) ${JSON.stringify(record)}`);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ sent: false, record }));
      return;
    }
    try {
      const r = await fetch(AXIOM_INGEST_URL(AXIOM_DATASET), {
        method: 'POST',
        headers: { Authorization: `Bearer ${AXIOM_TOKEN}`, 'Content-Type': 'application/x-ndjson' },
        body: `${JSON.stringify(record)}\n`,
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) {
        console.log(`relay: Axiom delivery FAILED (HTTP ${r.status})`);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ sent: false, record, status: r.status }));
        return;
      }
      console.log(`relay: delivered event=${record.event}`);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ sent: true, record }));
    } catch (err) {
      console.log(`relay: Axiom delivery FAILED (${err.message})`);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ sent: false, record }));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`journey-relay listening on 127.0.0.1:${PORT} (dataset configured: ${!!AXIOM_DATASET})`);
});
