// One way a notice leaves the machine, and the processors that send one.
//
// A comment written with Todd's own key never notifies him, so a notice is the pair the
// stop-ping route already uses: a comment that mentions him, then an issueReminder he is
// notified about. Design: docs/adr/0024-run-scorecard-and-stop-ping.md.
//
// A notice never throws and never fails the run it reports on. It writes one line to
// stops.jsonl either way, so a notice that did not post is still visible.

import { randomUUID } from 'node:crypto';

import { linearGraphQL, postCommentToIssueId } from '../../scripts/linear-cli.mjs';
import { noticeSeen, recordNotice } from '../../scripts/notice-log.mjs';
import { CARD_PATH } from './schema.mjs';

export const TODD_PROFILE = 'https://linear.app/julia-next/profiles/toddwyder';

// Linear delivers a reminder as a notification; 30 seconds is the lead dashboard/lib/ping.js
// and stop-ping use, and it keeps a notice inside its minute.
const REMINDER_LEAD_MS = 30_000;

// A plain 429 is retried twice before the run fails, and a usage limit is not retried at all.
// Measured in jul-342-proto-resume/p4b3-retries.mjs: retryCount 0, 1, 2, then failure. A
// notice waits for the last attempt so a rate limit that recovers stays quiet.
export const RATE_LIMIT_ATTEMPTS = 2;

// The span chain from a processor to the run it belongs to is short; this is a stop for a
// malformed chain, not a depth the walk expects.
const MAX_SPAN_DEPTH = 12;

const ISSUE_ID_QUERY = 'query NoticeIssueId($id: String!) { issue(id: $id) { id } }';
const REMINDER_MUTATION = 'mutation NoticeReminder($id: String!, $at: DateTime!) { issueReminder(id: $id, reminderAt: $at) { success } }';

const oneLine = (value, limit = 400) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);

export const NOTICE_KINDS = Object.freeze(['usage-limit', 'rate-limit', 'model', 'authorization', 'content-filter', 'restart']);

// What headline each kind writes. The card and the run are printed below it.
const HEADLINES = {
  'usage-limit': ({ model }) => `a usage limit stopped the build on ${model}`,
  'rate-limit': ({ model }) => `every retry was rate limited on ${model}`,
  model: ({ model }) => `the provider refused the model ${model}`,
  authorization: ({ model }) => `the account was refused on ${model}`,
  'content-filter': ({ model }) => `the model refused the request on ${model}`,
  restart: ({ card }) => `Studio restarted while ${card || 'a run'} was still running`,
};

const CLOSINGS = {
  restart: 'The run was still marked running when Studio came back, so it picks up from its last saved step.',
};

const DEFAULT_CLOSING = 'The build stopped here. Nothing is needed from you to start it again: run the card from Studio.';

export function noticeBody({ kind, card, model, runId, detail, at }) {
  const fields = [
    `Card: ${card || 'unknown'}`,
    ...(model ? [`Model: ${model}`] : []),
    `Run: ${runId || 'unknown'}`,
    ...(detail ? [`Error: ${oneLine(detail)}`] : []),
    `At: ${at}`,
  ];
  return [
    `${TODD_PROFILE} Julia stopped: ${HEADLINES[kind]({ card, model })}.`,
    '',
    ...fields,
    '',
    CLOSINGS[kind] ?? DEFAULT_CLOSING,
  ].join('\n');
}

// A usage limit arrives as a 429 with the provider's own wording, so it is read by message
// before any status. A refused model can also arrive as a 403, so it is read before the
// authorization block.
export function classifyError(error, retryCount = 0) {
  const status = Number(error?.statusCode ?? error?.status ?? 0);
  const body = typeof error?.responseBody === 'string' ? error.responseBody : '';
  const text = `${error?.message ?? error ?? ''} ${body}`.toLowerCase();
  if (/usage limit|insufficient_quota|exceeded your current quota|quota exceeded/.test(text)) return 'usage-limit';
  if (/model_not_found|model .* does not exist|model `?[^ ]+`? not found|unknown model|not a valid model|model .* (?:is )?not available/.test(text)) return 'model';
  if (status === 401 || status === 403) return 'authorization';
  if (status === 429 && retryCount >= RATE_LIMIT_ATTEMPTS) return 'rate-limit';
  return null;
}

// The one function every notice leaves through. It returns what happened instead of
// throwing, so a processor may call it without changing the run's own failure.
export async function notice(
  { kind, card = '', model = '', runId = '', detail = '' },
  { apiKey = process.env.LINEAR_API_KEY, fetchImpl = fetch, stops, now = () => new Date() } = {},
) {
  if (!NOTICE_KINDS.includes(kind)) throw new Error(`unknown notice kind: ${kind}`);
  const at = now().toISOString();
  const line = { id: randomUUID(), at, kind, card: card || null, model: model || null, runId: runId || null, detail: oneLine(detail) || null };
  if (noticeSeen({ kind, runId }, stops)) return { ...line, posted: false, skipped: `already noticed ${kind} for this run` };
  if (!card) {
    recordNotice({ ...line, posted: false, error: 'the run named no card' }, stops);
    return { ...line, posted: false, error: 'the run named no card' };
  }
  const body = noticeBody({ ...line, detail, at });
  try {
    const { issue } = await linearGraphQL(ISSUE_ID_QUERY, { id: card }, { apiKey, fetchImpl });
    if (typeof issue?.id !== 'string' || !issue.id) throw new Error(`no issue id for ${card}`);
    const comment = await postCommentToIssueId(issue.id, body, { apiKey, fetchImpl });
    const remindAt = new Date(now().getTime() + REMINDER_LEAD_MS).toISOString();
    const { issueReminder } = await linearGraphQL(REMINDER_MUTATION, { id: issue.id, at: remindAt }, { apiKey, fetchImpl });
    const sent = { ...line, comment: comment?.url ?? null, commentId: comment?.id ?? null, remindAt, reminded: issueReminder?.success === true, posted: true };
    recordNotice(sent, stops);
    return sent;
  } catch (error) {
    const failed = { ...line, posted: false, error: error.message };
    recordNotice(failed, stops);
    return failed;
  }
}

// What a processor's span says about the run it sits under. Mastra stamps the workflow run's
// id on the run span's metadata and the run's input on the span itself, so a notice names the
// run and its card without reading storage again.
export function runFacts({ tracingContext, requestContext } = {}) {
  const run = spanChain(tracingContext?.currentSpan).find(span => span.type === 'workflow_run' && (span.entityId ?? span.attributes?.workflowId) === CARD_PATH);
  return {
    runId: run?.metadata?.runId ?? '',
    card: oneLine(requestContext?.get?.('card') ?? '', 64) || oneLine(run?.input?.card ?? '', 64),
  };
}

function spanChain(span, depth = MAX_SPAN_DEPTH) {
  return span && depth > 0 ? [span, ...spanChain(span.parent, depth - 1)] : [];
}

// The processors the Lead and every helper carry. The model is the one the agent was built
// with, so the notice names Todd's pick rather than whatever the provider echoes back.
export function noticeProcessors({ model = '', notify = notice } = {}) {
  const send = async (kind, { tracingContext, requestContext }, detail) => {
    const { card, runId } = runFacts({ tracingContext, requestContext });
    await notify({ kind, card, model, runId, detail });
  };
  return {
    // Pinned to the budget Mastra already applies once an agent carries its own error processor,
    // so the setting is stated instead of warned about on every boot.
    maxProcessorRetries: 3,
    errorProcessors: [
      {
        id: 'machine-notice-api-error',
        async processAPIError({ error, retryCount, tracingContext, requestContext }) {
          const kind = classifyError(error, retryCount);
          if (kind) await send(kind, { tracingContext, requestContext }, `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`);
        },
      },
    ],
    outputProcessors: [
      {
        id: 'machine-notice-content-filter',
        async processOutputStep({ finishReason, messages, tracingContext, requestContext }) {
          // A content refusal never throws, so it reaches this step and not processAPIError.
          if (finishReason === 'content-filter') await send('content-filter', { tracingContext, requestContext }, `finishReason ${finishReason}`);
          return messages;
        },
      },
    ],
  };
}

// A run the last Studio process left running is the one thing a restart must say. One notice
// per run, and none for a run that a later boot would report a second time.
export async function announceRestarts({ storage, notify = notice } = {}) {
  if (!storage?.getStore) return [];
  let runs;
  try {
    const workflows = await storage.getStore('workflows');
    ({ runs = [] } = (await workflows?.listWorkflowRuns({ workflowName: CARD_PATH, perPage: false })) ?? {});
  } catch {
    // A store that cannot list its runs is a reason to skip the notice, not to fail the boot.
    return [];
  }
  return Promise.all(runs.map(run => runningRun(run)).filter(Boolean).map(interrupted => notify(interrupted)));
}

// A killed run's last saved snapshot carries the card on the workflow's own input. Its `value`
// map is empty until the run finishes, which a run left `running` never did.
function runningRun(run) {
  let snapshot = run.snapshot;
  if (typeof snapshot === 'string') {
    try { snapshot = JSON.parse(snapshot); } catch { return null; }
  }
  if (snapshot?.status !== 'running') return null;
  return {
    kind: 'restart',
    card: snapshot?.context?.input?.card ?? snapshot?.value?.card ?? '',
    runId: run.runId,
    detail: `still running at ${run.updatedAt?.toISOString?.() ?? 'an unrecorded time'}`,
  };
}
