// journey-events.mjs -- builder-side JUL-43 journey-accounting client.
//
// Deliberately holds no Axiom credential. Builders (agent worktrees) call
// recordEvent(), which POSTs to the trusted local relay
// (ops/journey-relay/relay.mjs, running as its own systemd service outside
// this repo) over 127.0.0.1 only. The relay -- not this module -- is the
// only thing that ever sees AXIOM_DATASET/AXIOM_TOKEN.
const RELAY_URL = process.env.JOURNEY_RELAY_URL || 'http://127.0.0.1:8943/events';

export async function recordEvent({
  event,
  attempted,
  reason,
  context,
  tokensUsed = null,
  quotaRemaining = null,
  interrupted = false,
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
  relayUrl = RELAY_URL,
}) {
  const record = { _time: now(), event, attempted, reason, context, tokensUsed, quotaRemaining, interrupted };
  try {
    const res = await fetchImpl(relayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.log(`(journey-events: relay responded HTTP ${res.status}) ${JSON.stringify(record)}`);
      return { sent: false, record };
    }
    const body = await res.json();
    return body;
  } catch (err) {
    console.log(`(journey-events: relay unreachable -- ${err.message}) ${JSON.stringify(record)}`);
    return { sent: false, record };
  }
}
