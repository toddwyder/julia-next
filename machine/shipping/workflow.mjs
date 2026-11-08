// The Shipping run as a Mastra workflow. One step gathers what the card asks
// for and where the code is; the next starts a fresh Execute subagent on the
// Shipping pick saved on the Start screen and lets it run the card's own
// commands. Neither step judges anything: the answer comes back as text and the
// machine writes it down.

import { getIssue } from '../../scripts/linear-cli.mjs';
import { bootHarness, loadMastra, stopHarness } from './harness.mjs';
import { criteriaFromCard, parseVerdict } from './determination.mjs';
import { createIdleWatch, reviewStops, IDLE_STOP_MS } from './stops.mjs';

export const WORKFLOW_ID = 'shipping';
export const FREE_MODEL = 'commandcode/reflection/beam:free';
export const PLAYBOOK = '.agents/skills/poteto-mode/playbooks/shipping.md';

const TRANSIENT = /(429|rate[ -]?limit|too many requests|temporarily unavailable|overloaded|ECONNRESET|socket hang up)/i;
const RETRY_WAITS_MS = [30_000, 90_000, 240_000];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The events that mean the review did something. A streaming model turn emits
// thousands of deltas, so only these move the idle clock.
const ACTIVITY = new Set([
  'agent_start',
  'agent_end',
  'tool_start',
  'tool_end',
  'tool_input_start',
  'tool_input_end',
  'subagent_start',
  'subagent_end',
  'subagent_tool_start',
  'subagent_tool_end',
  'usage_update',
]);

// The review used to be killed by a wall clock, verdict or not. Now each way a
// review can get nowhere has its own stop and its own reason: quiet, repeating,
// spinning, or over budget. A review that keeps working keeps running.
//
// The subagent tool reads its abort signal from the request context's
// `controller` entry (`controllerCtx?.abortSignal`), so this watch owns an
// AbortController and the review hands its signal over. `session.abortRun()`
// alone does nothing here: it aborts the session's own run, not the subagent
// stream the review is waiting on.
export function watchReview(session, { idleMs = IDLE_STOP_MS, onStop, log = () => {} } = {}) {
  const watch = createIdleWatch({ limitMs: idleMs });
  const controller = new AbortController();
  const unsubscribe = session.subscribe(event => {
    if (event?.type === 'usage_update' || ACTIVITY.has(event?.type)) watch.touch();
  });
  const disarm = watch.arm({
    onIdle: stop => {
      log(`The review had no activity for ${reviewLimitWords(idleMs)}, so it was stopped as stuck.`);
      controller.abort();
      onStop(stop);
    },
  });
  return {
    signal: controller.signal,
    stop: watch.idleStop.bind(watch),
    close() {
      disarm();
      unsubscribe?.();
    },
  };
}

const reviewLimitWords = ms => {
  const minutes = Math.round(ms / 60_000);
  if (minutes >= 1) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  return `${Math.round(ms / 1000)} seconds`;
};

async function askVerifier(subagent, payload, context, { log = () => {} } = {}) {
  for (let attempt = 0; ; attempt++) {
    const result = await subagent.execute(payload, context);
    const text = String(result?.content ?? '');
    const transient = TRANSIENT.test(text) && (/failed/i.test(text) || result?.isError);
    if (!transient) return { text, isError: Boolean(result?.isError) };
    if (attempt >= RETRY_WAITS_MS.length) return { text, isError: true };
    const wait = RETRY_WAITS_MS[attempt];
    log(`The model service is busy, waiting ${Math.round(wait / 1000)}s and asking the same model again.`);
    await sleep(wait);
  }
}

export function reviewTask({ pr, sha, checkout, card, criteria, open = [] }) {
  const numbers = open.length > 0 ? open : criteria.map((_, index) => index + 1);
  const listed = numbers.map(number => `${number}. ${criteria[number - 1]}`).join('\n');
  return [
    `You are the Shipping agent for pull request #${pr} in this checkout.`,
    '',
    `Read ${PLAYBOOK} first and follow it. You are reviewing code you did not write, and only a verdict from an agent that runs the change itself counts. A green pipeline is not a verdict.`,
    '',
    `The code under review is already checked out here: ${checkout}`,
    `Commit under review: ${sha}`,
    '',
    `The card is ${card.identifier}, quoted between the fences. Its criteria are the only things you judge.`,
    '',
    '--- card ---',
    `# ${card.title}`,
    '',
    card.description ?? '',
    '--- end card ---',
    '',
    'For each criterion, run the command it names, exactly as written, inside this checkout. Decide from what the command printed and the exit code it gave. You may also run read-only commands to look around (cat, ls, git show, git diff, git log). Dependencies are already installed in the root and in dashboard/. Do not run npm ci, npm install, or any installer, and do not edit, commit, push, or otherwise change the checkout.',
    '',
    'Start the app in the background when you need to check it, keep working while it runs, and read its output with `get_process_output` without `wait`. A blocking wait on a running process is refused, because a server does not exit and the wait would hold the whole review. To wait for a server to come up, run a bounded check such as `for i in 1 2 3 4 5 6 7 8 9 10; do curl -fsS http://127.0.0.1:PORT/api/health && exit 0; sleep 1; done; exit 1`.',
    '',
    `Judge exactly ${numbers.length === 1 ? 'this criterion' : `these ${numbers.length} criteria`}, and use the number shown beside each one:`,
    '',
    listed,
    '',
    'Answer in exactly this shape, with nothing before it and nothing after it:',
    '',
    'VERDICT: PASS | PASS+NOTES | FAIL',
    `CRITERION ${numbers[0] ?? 1}: PASS | FAIL — one sentence naming the command you ran and what it returned`,
    'NOTES: one short paragraph on anything a reader should know',
  ].join('\n');
}

export async function runShipping({
  pr,
  sha,
  checkout,
  card,
  cardRecord = null,
  criteria: only = null,
  modelId,
  storage,
  idleMs = IDLE_STOP_MS,
  log = console.log,
}) {
  if (!modelId) throw new Error('runShipping needs the Shipping pick saved on the Start screen; the machine carries no default.');
  const { z, createWorkflow, createStep } = await loadMastra();
  const traceFile = process.env.MASTRA_OBSERVABILITY_DB_PATH ?? null;
  // The three step-boundary stops ride on the subagent definition, which is how
  // the controller reaches `stopWhen`. The idle case needs a watch instead.
  const stops = reviewStops();
  const { booted, session, mastra, requestContext, subagent } = await bootHarness({
    cwd: checkout,
    storage,
    stopWhen: stops.conditions,
    refuseBlockingWait: true,
  });
  // A review can be stopped by the watch while it is blocked inside a tool, so
  // the stop is held here and read after the run settles either way.
  const stopped = { stop: null, watch: null };

  const inputSchema = z.object({ pr: z.number(), sha: z.string(), checkout: z.string(), card: z.string() });
  const cardSchema = z.object({
    identifier: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    url: z.string().nullable(),
  });
  const contextSchema = z.object({
    pr: z.number(),
    sha: z.string(),
    checkout: z.string(),
    card: cardSchema,
    criteria: z.array(z.string()),
    // The criteria this review may judge, by the number they have on the card.
    // The full list stays in card order so every number keeps its meaning.
    open: z.array(z.number()),
  });
  const reviewSchema = z.object({
    ...contextSchema.shape,
    answer: z.string(),
    modelId: z.string(),
    judged: z.array(z.number()).default([]),
  });

  const gather = createStep({
    id: 'gather',
    inputSchema,
    outputSchema: contextSchema,
    execute: async ({ inputData }) => {
      // A caller that already read the card hands it over, so the review can run
      // on a machine whose Linear key is gone. Otherwise the card is read here.
      let issue = cardRecord;
      if (!issue) {
        const apiKey = process.env.LINEAR_API_KEY;
        if (!apiKey) throw new Error('LINEAR_API_KEY is not set, so the machine cannot read the card.');
        issue = await getIssue(inputData.card, { apiKey });
      }
      if (!issue) throw new Error(`Linear returned no card for ${inputData.card}`);
      const criteria = criteriaFromCard(issue.description);
      if (criteria.length === 0) throw new Error(`${inputData.card} names no criteria, so there is nothing to judge.`);
      // A later review is handed the criteria still open, so it covers what the
      // last one did not judge instead of judging everything again.
      const wanted = new Set((only ?? []).map(Number).filter(number => number >= 1 && number <= criteria.length));
      const open = wanted.size > 0 ? [...wanted].sort((a, b) => a - b) : criteria.map((_, index) => index + 1);
      if (open.length === 0) throw new Error(`${inputData.card} has no criterion left open, so there is nothing to judge.`);
      log(`Card ${issue.identifier} names ${criteria.length} criterion(s), ${open.length} of them open; the code is at ${inputData.sha}.`);
      return {
        pr: inputData.pr,
        sha: inputData.sha,
        checkout: inputData.checkout,
        card: {
          identifier: issue.identifier,
          title: issue.title,
          description: issue.description ?? '',
          url: issue.url ?? null,
        },
        criteria,
        open,
      };
    },
  });

  const review = createStep({
    id: 'review',
    inputSchema: contextSchema,
    outputSchema: reviewSchema,
    execute: async ({ inputData }) => {
      const task = reviewTask(inputData);
      log(`Starting a fresh Execute subagent on ${modelId}.`);
      // The watch starts armed, because the idle case is silence rather than a
      // step boundary: a review blocked inside a tool call emits nothing.
      // It owns the abort signal, so a quiet review is stopped inside its tool.
      const existing = requestContext.get('controller') ?? {};
      stopped.watch = watchReview(session, {
        idleMs,
        log,
        onStop: stop => {
          stopped.stop = stop;
        },
      });
      requestContext.set('controller', { ...existing, abortSignal: stopped.watch.signal });
      const answer = await askVerifier(
        subagent,
        { agentType: 'execute', task, modelId },
        { workspace: session.getWorkspace(), requestContext, mastra },
        { log }
      );
      stopped.watch.close();
      stopped.watch = null;
      log(`The Shipping agent answered: ${answer.text.split(/\r?\n/)[0]}`);
      return { ...inputData, answer: answer.text, modelId, judged: judgedCriteria(answer.text) };
    },
  });

  const workflow = createWorkflow({ id: WORKFLOW_ID, inputSchema, outputSchema: reviewSchema })
    .then(gather)
    .then(review)
    .commit();
  mastra.addWorkflow(workflow);

  const run = await workflow.createRun();
  log(`Mastra workflow run ${run.runId} started.`);
  const started = Date.now();
  let result;
  try {
    result = await run.start({ inputData: { pr, sha, checkout, card } });
  } finally {
    stopped.watch?.close();
  }
  const elapsedMs = Date.now() - started;

  // A stop ends the review where it stands. The verdicts it already reached are
  // in the trace, and the caller writes them down beside the reason. An aborted
  // review still reaches the answer path, so the stop the watch took is read
  // first, before anything the run itself reports.
  const stop = stopped.stop ?? stops.fired.stop ?? runStopped(result);
  const output = result?.status === 'success' ? result.result : null;
  // A stopped review's text is quoted as it came: the verdicts it reached are
  // still read from it, and the reason it stopped is written beside them.
  return {
    runId: run.runId,
    status: stop ? 'stopped' : result?.status ?? 'stopped',
    elapsedMs,
    output,
    verdict: output?.answer ? parseVerdict(output.answer) : null,
    stop,
    error: stop ? stop.detail : result?.status === 'success' ? null : JSON.stringify(result?.error ?? result?.status),
    traceFile,
    booted,
  };
}

// A `stopWhen` condition stops the loop without failing the step, so the run's
// own status does not name it. Mastra reports the reason, and it says the
// condition matched rather than which one.
function runStopped(result) {
  if (!result || result.status === 'success') return null;
  const text = JSON.stringify(result.error ?? result.status);
  if (!/stop_condition|stop condition/i.test(text)) return null;
  return { kind: 'stopped', detail: 'a stop condition ended the review where it stood' };
}
