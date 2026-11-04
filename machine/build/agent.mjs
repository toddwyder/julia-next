// The build runs the way an interactive session runs: the stock session from
// `bootHarness`, the repo's own skills, shell and files, and the stock
// `subagent` tool for child agents. Nothing about how the agent works is special
// to the machine; only when it stops is.

// An hour is the ceiling a build gets before the step aborts the run and the
// card stops with the reason written down. A card that needs longer is a card
// that should have been sliced.
export const BUILD_TIME_LIMIT_MS = 60 * 60_000;

export function kickoffPrompt(card) {
  return [
    'Read .agents/skills/poteto-mode/SKILL.md and follow it.',
    '',
    `Build Linear card ${card}. Read the whole card first, including Todd's dated decisions on it, and move it to Implementation when you start.`,
    '',
    'Open the pull request in the same step as your first push, name only this card in its description, and keep pushing as you go.',
    'When the build is ready and the pull request is up to date, stop. The machine starts Shipping.',
    'Only a product decision or one approval in Todd\'s own account may reach him. Decide the rest and log it in the decision log.',
  ].join('\n');
}

export function textOf(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content?.parts)) return '';
  return content.parts
    .filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n');
}

// Only the messages this run added count: an aborted run writes no answer, and
// the last assistant message already in the thread belongs to an earlier run.
export async function lastAssistantAnswer(session, threadId, since) {
  const messages = await session.thread.listMessages({ threadId, limit: 500 });
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    if (since && String(message.createdAt ?? '') < since) continue;
    const text = textOf(message).trim();
    if (text) return text;
  }
  return '';
}

// The session streams with the controller's own run budget, which names a
// ceiling of 1000 steps for every stream and resume it starts
// (`buildSharedRunOptions` in the installed agent controller). The stock API
// offers no per-call limit, so the build gets that ceiling and the child agents
// get `SUBAGENT_MAX_STEPS` from the harness — both explicit, neither a default.
//
// The clock is a stop, not a kill: `session.abort()` ends the run the way a
// person pressing stop does, so the session stays usable and the record keeps
// what the build did before the limit.
export async function runBuild({
  session,
  card,
  model = null,
  timeLimitMs = BUILD_TIME_LIMIT_MS,
  span = null,
  log = console.log,
}) {
  const threadId = session.thread.getId();
  if (model) await session.model.switch(model);
  const startedAt = new Date().toISOString();
  const begin = Date.now();

  let timedOut = false;
  let timer = null;
  const send = session.sendMessage({
    content: kickoffPrompt(card),
    ...(span ? { tracingContext: { currentSpan: span } } : {}),
    untilIdle: true,
  });
  send.catch(() => {});
  const limit = new Promise(resolve => {
    timer = setTimeout(() => {
      timedOut = true;
      log(`build: the ${Math.round(timeLimitMs / 60_000)} minute clock fired; aborting the build's run.`);
      session.abort();
      resolve(null);
    }, timeLimitMs);
    timer.unref?.();
  });

  try {
    await Promise.race([send, limit]);
  } finally {
    clearTimeout(timer);
  }

  const elapsedMs = Date.now() - begin;
  const answer = timedOut ? '' : await lastAssistantAnswer(session, threadId, startedAt);
  return { threadId, answer, timedOut, elapsedMs };
}
