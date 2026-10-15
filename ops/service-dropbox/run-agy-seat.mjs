// Antigravity helpers retained for the current delivery-recovery workflow.
// The recovery turn deliberately omits --model so agy chooses its current
// default, then records the model agy actually resolved in its log.

const EFFORT_LEVELS = ['low', 'medium', 'high'];
const DEFAULT_EFFORT = 'medium';

function normalizeEffort(effort) {
  return EFFORT_LEVELS.includes(effort) ? effort : DEFAULT_EFFORT;
}

export function buildAgyDeliverySpec(prompt, { effort = DEFAULT_EFFORT, cwd, printTimeout = '0', logFile } = {}) {
  const args = [
    '--output-format', 'stream-json',
    '--print-timeout', printTimeout,
    '--dangerously-skip-permissions',
    '--disable-slash-commands',
    '--effort', normalizeEffort(effort),
  ];
  if (logFile) args.push('--log-file', logFile);
  args.push('--print', prompt);
  return { command: 'agy', args, options: cwd ? { cwd } : {} };
}

export function parseAgyDeliveryResult(text) {
  const events = String(text).split(/\r?\n/).filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const init = events.find(event => event.event === 'init');
  const results = events.filter(event => event.event === 'result').map(event => event.result);
  const final = results.at(-1);
  const model = init?.init?.model ?? null;
  const conversationId = init?.conversation_id ?? null;
  const response = final?.response ?? null;
  const invalid = !init || !final || results.some(result => result?.conversation_id !== init.conversation_id);
  if (invalid) return { ok: false, errorText: 'agy delivery turn did not finish with a matching result', response, model, conversationId, usage: final?.usage ?? null };
  if (final.status !== 'SUCCESS' || final.denied_actions?.length || !String(response ?? '').trim()) {
    return { ok: false, errorText: String(final.error ?? (final.denied_actions?.length ? 'agy was denied a tool' : 'agy gave no completed reply')), response, model, conversationId, usage: final.usage ?? null };
  }
  return { ok: true, errorText: null, response, model, conversationId, usage: final.usage ?? null };
}

// agy 1.3.4 stopped including its selected model in the stream-json init
// event. A unique --log-file still records the resolved model and the turn's
// conversation id. Require both and reject ambiguity rather than guessing.
export function parseAgyDeliveryModelLog(text, conversationId) {
  const log = String(text);
  if (!conversationId || !log.includes(`conversation ${conversationId}`)) return null;
  const models = [...log.matchAll(/Resolving model\s+([^\s]+)/g)].map(match => match[1]);
  const unique = [...new Set(models)];
  return unique.length === 1 ? unique[0] : null;
}
