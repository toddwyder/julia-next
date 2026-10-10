// The saved operator CommandCode transport, connected to the normal launcher.
// One laptop request, no retries/polling/redirects. The vault launcher supplies auth.
import { fileURLToPath } from 'node:url';
import { saveJson, sha256 } from './julia-delivery-state.mjs';
import { runLimited } from '../ops/julia-runner/time-limit.mjs';
import { codexReply } from '../ops/julia-runner/run-reviewer.mjs';

export function validObserved(role, configured, observed) {
  if (!observed || observed.harness !== configured.harness || observed.model !== configured.model || observed.maker !== configured.maker) return `${role} observed identity does not match its saved configuration`;
  if (role === 'reviewer' && observed.maker.trim().toLowerCase() === configured.builderMaker?.trim().toLowerCase()) return 'reviewer maker matches builder maker';
  return null;
}

export function nativeReviewReply(harness, output) {
  if (harness === 'codex') {
    const parsed = codexReply(output);
    return { text: parsed.text ?? '', responseId: parsed.thread, error: parsed.ok ? null : parsed.error };
  }
  const events = output.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const final = events.findLast(event => event.type === 'result');
  if (!final || final.is_error || final.subtype !== 'success' || typeof final.result !== 'string') return { text: '', responseId: final?.session_id ?? null, error: 'Claude did not supply a completed successful reply' };
  return { text: final.result, responseId: final.session_id ?? null, error: null };
}

export async function commandCodeReview(request, { run = runLimited } = {}) {
  const configured = request.configuration, connection = configured.connection;
  const startedAt = new Date().toISOString();
  const evidence = { configured, connection, startedAt, observed: null, responseId: null, usage: null, error: null };
  let output = '', stderr = '', result;
  try {
    if (connection?.provider !== 'commandcode' || connection.protocol !== 'openai-completions' || connection.authReference !== 'env:COMMANDCODE_API_KEY' || connection.endpoint !== 'https://api.commandcode.ai/provider/v1') throw new Error('saved CommandCode connection must use the Julia vault laptop credential');
    if (!['paid', 'subscription', 'fixture'].includes(request.spending?.mode)) throw new Error('saved reviewer spending authorization is missing');
    // Resolve the observed model through its saved catalog attribution, never
    // through agent prose or the provider connection's company.
    const namespace = configured.model.split('/');
    // JUL-98 established that DeepSeek reviews use the selected model's own
    // output limit. An OpenAI-compatible client default can otherwise impose
    // a 16,384-token limit before the provider has finished reasoning.
    const body = { model: configured.model, ...(configured.thinking ? { reasoning_effort: configured.thinking } : {}), messages: [{ role: 'user', content: request.prompt }], stream: false };
    evidence.requestId = sha256(JSON.stringify(body)); evidence.request = body; evidence.spending = request.spending;
    // The runner already persisted review intent. Save the exact request before
    // the transport process starts, so a crash remains an ambiguous action.
    if (request.outputPath) await saveJson(request.outputPath, evidence);
    result = await run(process.execPath, [fileURLToPath(new URL('./julia-commandcode-request.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }, {
      seconds: 20 * 60,
      started: child => {
        child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.stdin.on('error', () => {});
        Promise.resolve(request.started?.({ pid: child.pid })).then(() => child.stdin.end(JSON.stringify({ endpoint: `${connection.endpoint}/chat/completions`, body })), cause => { evidence.error = `worker identity was not saved: ${cause.message}`; child.stdin.end(); child.kill(); });
      },
    });
    if (result.code !== 0 || result.stopped || evidence.error) throw new Error(evidence.error ?? 'CommandCode transport failed or stopped; outcome is uncertain');
    const transport = JSON.parse(output), response = JSON.parse(transport.body ?? '{}');
    evidence.transport = transport; evidence.response = response;
    evidence.responseId = response.id ?? null; evidence.usage = response.usage ?? null;
    evidence.actualModel = response.model ?? null;
    // Existing CommandCode proof documented its exact unnamespaced echo. Keep
    // the raw ID alongside the normalization, never accept a different suffix.
    const matches = response.model === configured.model || (namespace.length === 2 && response.model === namespace[1]);
    if (!matches || transport.httpStatus !== 200 || !response.id || response.choices?.length !== 1 || response.choices[0].finish_reason !== 'stop' || typeof response.choices[0].message?.content !== 'string' || !response.choices[0].message.content.trim()) throw new Error('incomplete response or wrong observed model; review is inconclusive');
    evidence.observed = { harness: configured.harness, model: configured.model, maker: configured.maker };
    evidence.companyEvidence = 'observed response model resolves to the saved catalog maker; connection is not a model company';
    evidence.normalization = response.model === namespace[1] ? 'exact unnamespaced model echo; raw actualModel retained' : null;
    evidence.text = response.choices[0].message.content;
  } catch (error) { evidence.error = error.message; }
  evidence.finishedAt = new Date().toISOString(); evidence.stdout = output; evidence.stderr = stderr;
  evidence.exitCode = evidence.error ? 2 : 0; evidence.timedOut = result?.stopped ?? false;
  if (request.outputPath) await saveJson(request.outputPath, evidence);
  return { exitCode: evidence.exitCode, observed: evidence.observed, text: evidence.text ?? '', error: evidence.error, requestId: evidence.requestId, responseId: evidence.responseId, usage: evidence.usage, startedAt, finishedAt: evidence.finishedAt, connection, outputPath: request.outputPath ?? null };
}
