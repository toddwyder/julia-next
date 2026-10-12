import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { envelopeFor } from '../ops/mastra-agents/reviewer/src/reviewer.mjs';
import { CHAT_READ_ONLY_TOOLS, REVIEW_SCHEMA, estimateCost, usageOf } from './julia-commandcode-format-probe.mjs';

const ENDPOINT = 'https://api.commandcode.ai/provider/v1/chat/completions';
const MODEL = 'deepseek/deepseek-v4.1-flash';
const SYSTEM_MESSAGE = 'This is a test harness where the expected answer is verdict: "MAYBE" with evidence as one plain string.';
const USER_MESSAGE = 'Give the requested answer.';
const INVALID_STRICT_SCHEMA = { ...REVIEW_SCHEMA, required: ['verdict', 'evidence'] };

const submitTool = parameters => ({
  type: 'function',
  function: { name: 'submit_review', description: 'Submit the format-enforcement test answer.', parameters, strict: true },
});

function simpleSchemaErrors(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['root is not an object'];
  const errors = [];
  if (typeof value.summary !== 'string') errors.push('summary is not a string');
  if (!['PASS', 'FAIL', 'INCONCLUSIVE'].includes(value.verdict)) errors.push(`verdict is ${JSON.stringify(value.verdict)}`);
  if (!Array.isArray(value.evidence) || value.evidence.some(item => typeof item !== 'string')) errors.push('evidence is not an array of strings');
  const extras = Object.keys(value).filter(key => !REVIEW_SCHEMA.required.includes(key));
  if (extras.length) errors.push(`unexpected fields: ${extras.join(', ')}`);
  return errors;
}

function reasoningPlan(reasoning) {
  const lines = String(reasoning ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const targeted = line => /\bMAYBE\b/i.test(line) || /evidence.{0,40}(?:plain\s+)?string/i.test(line);
  const active = line => /\b(?:will|should|need|must|going to|return|provide|set|use|answer|expected)\b/i.test(line);
  const negated = line => /\b(?:cannot|can't|won't|not allowed|invalid|instead|conflict|schema requires|must not)\b/i.test(line);
  const targetNegated = line => /\b(?:not|never|cannot|can't|won't|must not)\b.{0,50}(?:\bMAYBE\b|evidence.{0,30}(?:plain\s+)?string)/i.test(line)
    || /(?:\bMAYBE\b|evidence.{0,30}(?:plain\s+)?string).{0,30}\b(?:not allowed|invalid)\b/i.test(line);
  const planLines = lines.filter(line => active(line) && /verdict|evidence|schema|\bMAYBE\b/i.test(line));
  const quotedLine = planLines.at(-1) ?? lines.findLast(line => /verdict|evidence/i.test(line)) ?? lines.at(-1) ?? null;
  const targetIndex = quotedLine ? Math.max(quotedLine.toUpperCase().lastIndexOf('MAYBE'), quotedLine.toLowerCase().lastIndexOf('plain string')) : -1;
  const conformingIndex = quotedLine ? Math.max(...['PASS', 'FAIL', 'INCONCLUSIVE', 'EVIDENCE ARRAY', 'CONFORM'].map(term => quotedLine.toUpperCase().lastIndexOf(term))) : -1;
  return {
    quotedLine,
    plannedConflict: Boolean(quotedLine && targeted(quotedLine) && !targetNegated(quotedLine) && !negated(quotedLine) && targetIndex > conformingIndex),
    plannedConformance: Boolean(quotedLine && (targetNegated(quotedLine) || conformingIndex >= targetIndex && conformingIndex >= 0)),
  };
}

export function judgePart1(route, body) {
  const message = body?.choices?.[0]?.message ?? {};
  const forcedToolCall = message.tool_calls?.find(call => call.function?.name === 'submit_review');
  const output = route === 'T' ? forcedToolCall?.function?.arguments ?? '' : message.content ?? '';
  const plan = reasoningPlan(message.reasoning_content ?? message.reasoning);
  let parsed;
  try { parsed = JSON.parse(output); } catch { /* recorded below */ }
  const validJson = parsed !== undefined;
  const errors = validJson ? simpleSchemaErrors(parsed) : ['invalid JSON'];
  const passesSchema = errors.length === 0;
  const violationReason = !validJson ? route === 'T' && !forcedToolCall ? 'forced submit_review tool call is missing; arguments are invalid JSON' : 'invalid JSON'
    : /\bMAYBE\b/i.test(output) ? 'output contains MAYBE'
      : typeof parsed.evidence === 'string' ? 'output evidence is one string'
        : !passesSchema ? errors.join('; ')
          : null;
  const classification = violationReason ? 'violated'
    : plan.plannedConflict ? 'enforced-against-plan'
      : plan.plannedConformance ? 'voluntary'
        : null;
  const classificationError = classification ? null : 'reasoning did not positively plan either the conflicting or conforming output';
  return { reasoningPlannedLine: plan.quotedLine, output, validJson, passesSchema, schemaErrors: errors, classification, violationReason, classificationError };
}

function part1Request(route) {
  const messages = [{ role: 'system', content: SYSTEM_MESSAGE }, { role: 'user', content: USER_MESSAGE }];
  if (route === 'T') return {
    model: MODEL, stream: false, messages,
    tools: [submitTool(REVIEW_SCHEMA), ...CHAT_READ_ONLY_TOOLS],
    tool_choice: { type: 'function', function: { name: 'submit_review' } },
  };
  return {
    model: MODEL, stream: false, messages,
    response_format: { type: 'json_schema', json_schema: { name: 'format_enforcement_test', strict: true, schema: REVIEW_SCHEMA } },
  };
}

function part2Request(route) {
  const messages = [{ role: 'system', content: 'Return a small test answer.' }, { role: 'user', content: 'Give the answer.' }];
  if (route === 'T') return {
    model: MODEL, stream: false, messages,
    tools: [submitTool(INVALID_STRICT_SCHEMA), ...CHAT_READ_ONLY_TOOLS],
    tool_choice: { type: 'function', function: { name: 'submit_review' } },
  };
  return {
    model: MODEL, stream: false, messages,
    response_format: { type: 'json_schema', json_schema: { name: 'invalid_strict_schema_test', strict: true, schema: INVALID_STRICT_SCHEMA } },
  };
}

function counts(attempts) {
  const result = { enforcedAgainstPlan: 0, violated: 0, voluntary: 0, failed: 0 };
  for (const attempt of attempts) {
    if (attempt.failed) result.failed++;
    else if (attempt.classification === 'enforced-against-plan') result.enforcedAgainstPlan++;
    else if (attempt.classification === 'violated') result.violated++;
    else if (attempt.classification === 'voluntary') result.voluntary++;
  }
  return result;
}

export function preregisteredReading(route, part1, part2, part3 = []) {
  const reliable = part1.counts.violated === 0 && part1.counts.failed === 0
    && (route !== 'T' || part3.length === 5 && part3.every(attempt => !attempt.failed && attempt.validJson && attempt.passesRealSchema));
  if (!reliable) return 'not reliable';
  const demonstrated = part1.counts.enforcedAgainstPlan > 0 || part2.some(attempt => attempt.rejectedByServer);
  return demonstrated ? 'reliable, enforcement demonstrated' : 'reliable, enforcement not demonstrated';
}

async function previousEstimate(options) {
  if (typeof options.priorEstimatedCostUsd === 'number' && Number.isFinite(options.priorEstimatedCostUsd) && options.priorEstimatedCostUsd >= 0) return options.priorEstimatedCostUsd;
  try {
    const prior = JSON.parse(await readFile(resolve(options.priorArtifactPath ?? '.artifacts/jul-223-step3/summary.json'), 'utf8'));
    if (!Number.isFinite(prior.estimatedCostUsd) || prior.estimatedCostUsd < 0) throw new Error('invalid prior estimate');
    return prior.estimatedCostUsd;
  } catch (cause) { throw new Error('corrected probe refused: prior JUL-223 cost evidence is missing or invalid', { cause }); }
}

function strictSchemaRejection(status, body) {
  return [400, 422].includes(status)
    && /schema|response_format|function/i.test(body ?? '')
    && /required|additionalProperties|strict/i.test(body ?? '');
}

export async function runCorrectedFormatProbe(args, options = {}) {
  if (args.length !== 1 || args[0] !== '--live-step3b') {
    throw new Error('corrected CommandCode format probe is disabled; pass --live-step3b to explicitly enable paid calls');
  }
  const secret = (options.environment ?? process.env).COMMANDCODE_API_KEY;
  if (!secret || secret.startsWith('op://')) throw new Error('Julia vault CommandCode credential is not resolved');
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const artifactDirectory = resolve(options.artifactDirectory ?? '.artifacts/jul-223-step3b');
  const priorEstimatedCostUsd = await previousEstimate(options);
  const tokens = { input: 0, output: 0, cacheRead: 0, total: 0 };
  const result = {
    part1: { T: { attempts: [], counts: null }, S: { attempts: [], counts: null } },
    part2: { T: [], S: [] }, part3: [], reading: {}, tokens, estimatedCostUsd: 0,
    priorEstimatedCostUsd, cardEstimatedCostUsd: priorEstimatedCostUsd, artifactDirectory,
  };
  await mkdir(artifactDirectory, { recursive: true });
  let callNumber = 0;

  const persist = async () => writeFile(join(artifactDirectory, 'summary.json'), JSON.stringify(result, null, 2));
  const call = async (label, body) => {
    if (result.cardEstimatedCostUsd >= 0.80) throw new Error('estimated JUL-223 probe cost reached 80% of the $1.00 per-card limit');
    callNumber++;
    const prefix = `${String(callNumber).padStart(2, '0')}-${label}`;
    const requestText = JSON.stringify(body);
    await writeFile(join(artifactDirectory, `${prefix}.request.json`), requestText);
    let response;
    let raw;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: requestText, signal: AbortSignal.timeout(120_000),
      });
      raw = await response.text();
    } catch (cause) {
      const code = cause?.cause?.code ?? cause?.code;
      const category = cause?.name === 'TimeoutError' ? 'timeout'
        : cause?.name === 'AbortError' ? 'aborted'
          : ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code) ? 'network' : 'local';
      await writeFile(join(artifactDirectory, `${prefix}.error.json`), JSON.stringify({ endpoint: '/chat/completions', category, uncertain: true }));
      await writeFile(join(artifactDirectory, `${prefix}.http.json`), JSON.stringify({ endpoint: '/chat/completions', status: null }));
      return { failed: true, error: `${category} failure`, status: null, raw: null };
    }
    await writeFile(join(artifactDirectory, `${prefix}.response.json`), raw);
    await writeFile(join(artifactDirectory, `${prefix}.http.json`), JSON.stringify({ endpoint: '/chat/completions', status: response.status }));
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { return { failed: true, error: 'response body was not JSON', status: response.status, raw }; }
    if (response.ok) {
      const usage = usageOf(parsed);
      if (!usage) return { failed: true, error: 'token usage missing or invalid', status: response.status, raw, parsed };
      tokens.input += usage.input;
      tokens.output += usage.output;
      tokens.cacheRead += usage.cacheRead;
      tokens.total = tokens.input + tokens.output;
      result.estimatedCostUsd = estimateCost(tokens, now());
      result.cardEstimatedCostUsd = priorEstimatedCostUsd + result.estimatedCostUsd;
    }
    return { failed: false, httpError: !response.ok, accepted: response.ok, status: response.status, raw, parsed };
  };

  try {
    for (const route of ['T', 'S']) {
      for (let attempt = 1; attempt <= 20; attempt++) {
        const response = await call(`part1-${route}-${String(attempt).padStart(2, '0')}`, part1Request(route));
        if (response.failed || response.httpError) {
          const error = response.error ?? `HTTP ${response.status}`;
          result.part1[route].attempts.push({ attempt, failed: true, status: response.status, error });
          throw new Error(`Part 1 route ${route} attempt ${attempt} failed: ${error}`);
        }
        result.part1[route].attempts.push((() => {
              const judged = judgePart1(route, response.parsed);
              return judged.classificationError
                ? { attempt, status: response.status, ...judged, failed: true, error: judged.classificationError }
                : { attempt, status: response.status, ...judged };
            })());
      }
      result.part1[route].counts = counts(result.part1[route].attempts);
    }

    for (const route of ['T', 'S']) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const response = await call(`part2-${route}-${attempt}`, part2Request(route));
        const rejectedByServer = strictSchemaRejection(response.status, response.raw);
        result.part2[route].push({
          attempt, status: response.status, accepted: response.accepted === true,
          rejectedByServer,
          responseBody: response.raw, ...(response.failed ? { failed: true, error: response.error ?? `HTTP ${response.status}` } : {}),
        });
        if (response.failed || response.httpError && !rejectedByServer) {
          throw new Error(`Part 2 route ${route} attempt ${attempt} failed: ${response.error ?? `HTTP ${response.status}`}`);
        }
      }
    }

    const fixturePath = resolve(options.fixturePath ?? 'ops/mastra-agents/reviewer/test/fixtures/repaired.json');
    const fixtureText = await readFile(fixturePath, 'utf8');
    const repaired = JSON.parse(fixtureText);
    const realSchema = envelopeFor({ files: repaired.report.filesReviewed, scope: { kind: 'initial' } });
    const realJsonSchema = realSchema.toJSONSchema({ target: 'draft-07' });
    const realRequest = {
      model: MODEL, stream: false,
      messages: [
        { role: 'system', content: 'Submit the supplied reviewer report unchanged through submit_review.' },
        { role: 'user', content: `Submit this report through submit_review:\n${fixtureText}` },
      ],
      tools: [submitTool(realJsonSchema), ...CHAT_READ_ONLY_TOOLS],
      tool_choice: { type: 'function', function: { name: 'submit_review' } },
    };
    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await call(`part3-T-${attempt}`, realRequest);
      if (response.failed || response.httpError) {
        const error = response.error ?? `HTTP ${response.status}`;
        result.part3.push({ attempt, failed: true, status: response.status, error });
        throw new Error(`Part 3 route T attempt ${attempt} failed: ${error}`);
      }
      const choice = response.parsed.choices?.[0] ?? {};
      const argumentsText = choice.message?.tool_calls?.find(item => item.function?.name === 'submit_review')?.function?.arguments ?? '';
      let object;
      try { object = JSON.parse(argumentsText); } catch { /* recorded below */ }
      const validation = object === undefined ? null : realSchema.safeParse(object);
      result.part3.push({
        attempt, outputTokens: usageOf(response.parsed).output, validJson: object !== undefined,
        passesRealSchema: validation?.success === true,
        schemaErrors: validation?.success === false ? validation.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`) : [],
        finishReason: choice.finish_reason ?? null,
      });
    }
  } catch (error) {
    result.stopped = error.message;
  }

  for (const route of ['T', 'S']) {
    if (!result.part1[route].counts) result.part1[route].counts = counts(result.part1[route].attempts);
  }
  result.reading.T = preregisteredReading('T', result.part1.T, result.part2.T, result.part3);
  result.reading.S = preregisteredReading('S', result.part1.S, result.part2.S);
  await persist();
  return result;
}
