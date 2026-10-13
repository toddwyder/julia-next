// Stage one of JUL-223 deliberately leaves provider execution disabled while
// retaining the proven read-only tools, raw-response capture, and durable
// small-piece report seam for the minimum-reviewer rebuild.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod/v4';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { verifyEvidenceQuote } from './quote-check.mjs';
import { commandCodeCostEstimate } from './commandcode-cost.mjs';
import { reviewGenerationOptions } from './contract.mjs';
import { createModelJournal } from './model-journal.mjs';
import { createReviewBudget } from './review-budget.mjs';
import { durableWrite, verifyRunEvidenceLimit } from './run-file.mjs';
import { createReviewResourceBudget, recordReviewSystemError, reviewLimitForReason } from './resource-budget.mjs';

const exec = promisify(execFile);
export { envelopeFor, reviewedFilesSchema } from './reviewer-report.mjs';
export const STANDING_RULES = `# Standing rules for the reviewer
- Every quote must appear word for word in the named file or diff at the reviewed commit.
- No arbitrary caps or limits; flag any new one.
- Never ask Todd; anything needing a human parks the card with a visible reason.
- Agents never create tickets, merge, or delete.
- Prefer stock Mastra features; flag custom code that duplicates one.
- Flag missing tests and missing logging.`;

export function reviewerInstructions(role, standards) {
  return `${role}\n\n# Repository coding standards\n\n${standards}\n\n${STANDING_RULES}`;
}

const safePath = path => {
  if (!path || path.includes('..') || path.startsWith('/') || path.startsWith('\\')) throw new Error('unsafe repository path');
  return path;
};

export function reviewerTools(repoRoot, base, commit, sources = {}) {
  const git = args => exec('git', args, { cwd: repoRoot, windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  return {
    list_candidate_files: createTool({ id: 'list_candidate_files', description: 'List files changed by the immutable candidate only. Read-only.', inputSchema: z.object({}), execute: async () => (await git(['diff', '--name-only', `${base}...${commit}`])).stdout.split(/\r?\n/).filter(Boolean) }),
    read_candidate_diff: createTool({ id: 'read_candidate_diff', description: 'Read only the immutable candidate diff.', inputSchema: z.object({}), execute: async () => (await git(['diff', '--binary', `${base}...${commit}`])).stdout }),
    read_candidate_file: createTool({ id: 'read_candidate_file', description: 'Read one file at the immutable candidate commit only.', inputSchema: z.object({ path: z.string().min(1) }), execute: async ({ path }) => (await git(['show', `${commit}:${safePath(path)}`])).stdout }),
    verify_evidence_quote: createTool({
      id: 'verify_evidence_quote', description: 'Verify one evidence quote byte-for-byte in its immutable source.',
      inputSchema: z.object({ source: z.string().min(1), quote: z.string().min(1) }),
      execute: async ({ source, quote }) => verifyEvidenceQuote(repoRoot, commit, source, quote, sources),
    }),
    verify_evidence_quotes: createTool({
      id: 'verify_evidence_quotes', description: 'Verify a batch of evidence quotes against immutable sources.',
      inputSchema: z.object({ citations: z.array(z.object({ source: z.string().min(1), quote: z.string().min(1) })).min(1) }),
      execute: async ({ citations }) => Promise.all(citations.map(async citation => ({ ...citation, ...await verifyEvidenceQuote(repoRoot, commit, citation.source, citation.quote, sources) }))),
    }),
  };
}

const rawUsageByResponseId = new Map();

export function captureCommandCodeResponse(body) {
  const capturedAt = new Date();
  const estimate = commandCodeCostEstimate(body?.usage, capturedAt);
  if (typeof body?.id !== 'string' || !body.id) throw new Error('reviewer refused: CommandCode response identity is missing or unknown');
  const captured = { responseId: body.id, usage: body.usage, capturedAt, estimate };
  rawUsageByResponseId.set(body.id, captured);
  return captured;
}

export async function checkedFetch(url, init, recordCost = async () => {}, rawAnswer = null, beforeRequest = async () => {}, recordModelEvent = async () => {}) {
  const requestBody = init?.body ? JSON.parse(String(init.body)) : {};
  await beforeRequest(requestBody);
  await recordModelEvent({ kind: 'request', body: requestBody });
  const response = await fetch(url, init);
  const rawBody = await response.clone().text();
  await recordModelEvent({ kind: 'response', raw: rawBody });
  let body;
  try { body = JSON.parse(rawBody); }
  catch { throw new Error('reviewer refused: CommandCode response token usage is missing or unknown'); }
  const choice = body?.choices?.[0];
  const rawText = choice?.message?.content;
  const rawResponse = choice?.finish_reason === 'tool_calls' ? JSON.stringify(choice?.message)
    : (typeof rawText === 'string' && rawText.length > 0 ? rawText : null);
  if (rawAnswer && rawResponse) {
    await durableWrite(rawAnswer.rawAnswerPath, rawResponse);
    rawAnswer.saved = true;
    rawAnswer.responseId = typeof body?.id === 'string' ? body.id : null;
  }
  const captured = captureCommandCodeResponse(body);
  await recordModelEvent({ kind: 'usage', responseId: captured.responseId, usage: captured.usage, estimate: captured.estimate });
  await recordCost(captured);
  return response;
}

function responseMetadata(parsedBody) {
  const responseId = parsedBody?.id;
  const raw = typeof responseId === 'string' ? rawUsageByResponseId.get(responseId) : undefined;
  if (!raw) throw new Error('reviewer refused: CommandCode response identity is missing or unknown');
  rawUsageByResponseId.delete(responseId);
  return { commandcode: { responseId, usage: raw.usage, cost: raw.estimate } };
}

export const commandCodeMetadata = {
  extractMetadata: async ({ parsedBody }) => responseMetadata(parsedBody),
  createStreamExtractor: () => {
    let responseId;
    return {
      processChunk(chunk) { if (typeof chunk?.id === 'string') responseId = chunk.id; },
      buildMetadata: () => responseMetadata({ id: responseId }),
    };
  },
};

export async function generateRecordedReview({ agent, prompt, generationOptions, verdictPath, rawAnswer, recorder, submitted, failureDetail = null, onSystemError = async () => {} }) {
  let result;
  try {
    result = await agent.generate(prompt, generationOptions);
  } catch (error) {
    const raw = rawAnswer.saved ? `; raw answer: ${rawAnswer.rawAnswerPath}` : '';
    const reason = `reviewer technical failure: ${error?.message ?? String(error)}${raw}`;
    const failure = await recorder.recordTechnicalFailure(`${verdictPath}.failure.json`, reason, {
      rawAnswerPath: rawAnswer.saved ? rawAnswer.rawAnswerPath : null,
      runId: rawAnswer.runId, candidateCommit: rawAnswer.candidateCommit, responseId: rawAnswer.responseId,
    });
    await onSystemError(reason, failure);
    throw new Error(reason, { cause: error });
  }
  if (submitted()) return result;
  const detail = failureDetail?.() ?? 'the model ended without a successful submit_report call';
  const raw = rawAnswer.saved ? `; raw answer: ${rawAnswer.rawAnswerPath}` : '';
  const reason = `reviewer technical failure: ${detail}${raw}`;
  const failure = await recorder.recordTechnicalFailure(`${verdictPath}.failure.json`, reason, {
    rawAnswerPath: rawAnswer.saved ? rawAnswer.rawAnswerPath : null,
    runId: rawAnswer.runId, candidateCommit: rawAnswer.candidateCommit, responseId: rawAnswer.responseId,
  });
  await onSystemError(reason, failure);
  throw new Error(reason);
}

export function rawAnswerPathFor(verdictPath, runId, candidateCommit) {
  const safeFilePart = value => String(value).replace(/[^a-zA-Z0-9._-]/g, '_');
  return resolve(dirname(verdictPath), `${safeFilePart(runId)}.${safeFilePart(candidateCommit)}.reviewer-raw.txt`);
}

export async function createReviewerRuntime({ runDirectory, cardBudgetPath, input, spending, startedAt = Date.now(), now = Date.now, verdictSaved = () => false, progress = () => [], resourceMeasurements = {} }) {
  if (spending?.mode !== 'paid' || spending.maxUsd !== 0.50 || spending.cumulativeMaxUsd !== 1) {
    throw new Error('reviewer refused: runtime requires the approved $0.50 paid limit and $1 cumulative card limit');
  }
  if (!cardBudgetPath || spending.ledgerPath !== cardBudgetPath) throw new Error('reviewer refused: runtime requires the authorized cumulative card ledger path');
  const warnings = [];
  const terminalPath = join(runDirectory, 'terminal-state.json');
  const resources = await createReviewResourceBudget({ runDirectory, terminalPath, progress, ...resourceMeasurements });
  const budget = await createReviewBudget({ path: join(runDirectory, 'review-budget.json'), maxUsd: spending.maxUsd, cardPath: cardBudgetPath, cardMaxUsd: spending.cumulativeMaxUsd, startedAt, now });
  const journal = await createModelJournal({ path: join(runDirectory, 'model-events.json'), verdictSaved, warnings });
  const generationOptions = reviewGenerationOptions(input.files, input.criteria);
  const fetchWithBudgets = async (url, init, rawAnswer = null) => {
    const memorySignal = resources.beginAgentStep();
    await resources.beforeDispatch();
    const signals = [init?.signal, memorySignal].filter(Boolean);
    const boundedInit = { ...init, signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals) };
    const stepStartedAt = performance.now();
    try {
      return await checkedFetch(url, boundedInit, budget.recordResponse, rawAnswer, budget.beforeRequest, journal.record);
    } finally {
      resources.recordProviderStep(performance.now() - stepStartedAt);
      await resources.sample();
    }
  };
  const onSystemError = async (reason, failure = {}) => {
    resources.finishAgentStep();
    return recordReviewSystemError({
      terminalPath,
      progress: () => failure.acceptedPieces ?? progress(),
      limit: reviewLimitForReason(reason),
      reason,
      measured: await resources.summary(),
    });
  };
  const generate = async options => {
    let result;
    try {
      result = await generateRecordedReview({ ...options, generationOptions, onSystemError });
    } finally {
      resources.finishAgentStep();
    }
    try {
      resources.assertWithinLimits();
    } catch (error) {
      const reason = `reviewer technical failure: ${error.message}`;
      const failure = await options.recorder.recordTechnicalFailure(`${options.verdictPath}.failure.json`, reason, {
        rawAnswerPath: options.rawAnswer.saved ? options.rawAnswer.rawAnswerPath : null,
        runId: options.rawAnswer.runId,
        candidateCommit: options.rawAnswer.candidateCommit,
        responseId: options.rawAnswer.responseId,
      });
      await onSystemError(reason, failure);
      throw new Error(reason, { cause: error });
    }
    await durableWrite(join(runDirectory, 'review-measurements.json'), `${JSON.stringify({
      state: 'COMPLETED',
      budget: await budget.summary(),
      resources: await resources.summary(),
      recordedAt: new Date().toISOString(),
    })}\n`, { root: runDirectory });
    return result;
  };
  return {
    generationOptions,
    fetch: fetchWithBudgets,
    generate,
    verifyEvidence: () => verifyRunEvidenceLimit(runDirectory),
    budgetSummary: budget.summary,
    resourceSummary: resources.summary,
    warnings,
  };
}

export async function runReviewer() {
  const error = new Error('reviewer reset is incomplete; paid execution is disabled until the JUL-224 trust test passes');
  error.providerAcceptance = 'not-accepted';
  error.costUsd = 0;
  throw error;
}

async function readStandardInput(stream = process.stdin) {
  stream.setEncoding('utf8');
  let input = '';
  for await (const chunk of stream) input += chunk;
  return input;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let request;
  try {
    request = JSON.parse(await readStandardInput());
    await runReviewer(request);
  } catch (error) {
    if (request?.verdictPath && error?.providerAcceptance === 'not-accepted' && error?.costUsd === 0) {
      await durableWrite(`${request.verdictPath}.failure.json`, `${JSON.stringify({
        kind: 'technical-failure', stage: 'reviewer-start', reason: error.message,
        providerAcceptance: error.providerAcceptance, costUsd: error.costUsd,
      })}\n`, { root: dirname(request.verdictPath) });
    }
    console.error(error.message);
    process.exitCode = 1;
  }
}
