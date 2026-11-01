// The builder is the session that made the change. A FAIL goes back to that
// same thread, so the fix carries the reasoning that made the change; when the
// thread is gone the machine starts a new builder and says so on the card.
// Everything here is either a pure order or one boot of the harness.

import fs from 'node:fs';
import path from 'node:path';

import { bootHarness, loadMastra, stopHarness } from '../shipping/harness.mjs';
import { repoRoot } from '../shipping/run-parts.mjs';

export const BUG_FIX_PLAYBOOK = '.agents/skills/poteto-mode/playbooks/bug-fix.md';
export const INVESTIGATION_PLAYBOOK = '.agents/skills/poteto-mode/playbooks/investigation.md';

export function readPlaybook(relative, root = repoRoot) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function cardPattern(card) {
  const escaped = String(card).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![0-9])`, 'i');
}

// The store keeps a thread's metadata as JSON bytes, not as text, so a row read
// straight from it has to be decoded before anything can be asked of it.
function textOf(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content?.parts)) return '';
  return content.parts
    .filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n');
}

// The store keeps a user's turn with role `signal` and type `user`, so the role
// field alone finds nothing. Only the title and the user's own turns are read: an
// agent naming a neighbouring card must not claim it for this one.
//
// The store is read directly, without booting a harness, because a boot claims the
// newest thread in the store: booting first would either fail on a live session or
// bind the wrong thread before this one could be chosen.
export async function findBuilderThread({ client, repoRoot: root = repoRoot, card }) {
  const pattern = cardPattern(card);
  // The project name is filtered in the query rather than in code: the store
  // keeps a thread's metadata encoded, and the path's bytes sit inside it as-is.
  const threads = await client.execute({
    sql: 'select id, title, updatedAt from mastra_threads where instr(metadata, ?) > 0 order by updatedAt desc',
    args: [Buffer.from(root, 'utf8')],
  });
  for (const thread of threads.rows) {
    if (pattern.test(String(thread.title ?? ''))) return found(thread);
    const named = await client.execute({
      sql: "select content from mastra_messages where thread_id = ? and type = 'user' and content like ? limit 20",
      args: [thread.id, `%${card}%`],
    });
    if (named.rows.some(row => pattern.test(String(row.content ?? '')))) return found(thread);
  }
  return null;
}

function found(thread) {
  return { threadId: thread.id, title: thread.title ?? '', updatedAt: thread.updatedAt ?? null };
}

// A boot takes the newest thread in the store, so the thread a caller wants has to
// be made the newest one first. The column the store orders by is the honest place
// to say "this thread is the live one now".
async function makeNewest(client, threadId) {
  await client.execute({
    sql: 'update mastra_threads set updatedAt = ? where id = ?',
    args: [new Date().toISOString(), threadId],
  });
}

export function pullRequestUrl(pr) {
  return `https://github.com/toddwyder/julia-next/pull/${pr}`;
}

function quote(label, text) {
  return [`--- ${label} ---`, String(text ?? '').trim(), `--- end ${label} ---`];
}

function playbookOrder(relative, text) {
  return [`The playbook for this round is ${relative}. Its text is below, word for word.`, '', ...quote(relative, text)];
}

export function remediationOrder({ card, pr, sha, determination, playbookText, playbook = BUG_FIX_PLAYBOOK }) {
  return [
    `You are the builder of pull request #${pr} (${pullRequestUrl(pr)}), and the Shipping agent has just failed this card: ${card.identifier} ${card.title}.`,
    '',
    `The code Shipping judged is commit ${sha}. Its determination is quoted below, word for word, with nothing taken out.`,
    '',
    ...quote('determination', determination),
    '',
    'Fix what the determination says is missing. Judge nothing else; leave a criterion Shipping already passed as it is.',
    '',
    ...playbookOrder(playbook, playbookText),
    '',
    'Push the fix to the branch the pull request is on, then stop. Do not move the card, do not comment on Linear, do not merge, and do not start the Shipping agent: the runner checks the fixed change and reports back.',
  ].join('\n');
}

export function freshBuilderOrder({ card, pr, sha, checkout, determination, playbookText, criteria = [], playbook = BUG_FIX_PLAYBOOK }) {
  return [
    `You are a fresh builder. The session that wrote pull request #${pr} (${pullRequestUrl(pr)}) could not be taken: it is gone from the store, or another process was still writing it. Nothing of that session is here.`,
    '',
    `The card is ${card.identifier}, quoted below, and Shipping judged commit ${sha} against it.`,
    '',
    '--- card ---',
    `# ${card.title}`,
    '',
    card.description ?? '',
    '--- end card ---',
    '',
    `The card asks for ${criteria.length} ${criteria.length === 1 ? 'criterion' : 'criteria'}:`,
    '',
    ...criteria.map((criterion, index) => `${index + 1}. ${criterion}`),
    '',
    // The builder changes the checkout of the pull request head, never the
    // repository the other sessions are working in.
    `The pull request head is checked out at ${checkout ?? 'the checkout in front of you'}, detached at commit ${sha}. Make the change there, and do not switch branches anywhere else.`,
    `Push it with \`git push origin HEAD:refs/heads/<branch>\`, naming the branch \`gh pr view ${pr} --json headRefName --jq .headRefName\` prints. Shipping failed it with this determination, quoted word for word.`,
    '',
    ...quote('determination', determination),
    '',
    ...playbookOrder(playbook, playbookText),
    '',
    'Push the fix to the branch the pull request is on, then stop. Do not move the card, do not comment on Linear, do not merge, and do not start the Shipping agent: the runner checks the fixed change and reports back.',
  ].join('\n');
}

export function investigationOrder({ card, pr, determinations, playbookText, mayPost = true, playbook = INVESTIGATION_PLAYBOOK }) {
  const lines = [
    `The Shipping agent has failed ${card.identifier} twice, and the loop has stopped. Your job is the root cause, not a repair.`,
    '',
    `The two determinations on pull request #${pr} (${pullRequestUrl(pr)}) are quoted below, word for word.`,
    '',
  ];
  determinations.forEach((item, index) => {
    lines.push(`Review ${item.round ?? index + 1} on commit ${item.sha ?? 'unknown'}:`);
    lines.push(...quote('determination', item.answer ?? item.determination));
    lines.push('');
  });
  lines.push(...playbookOrder(playbook, playbookText), '');
  lines.push(
    'Name both causes: the cause in the work, meaning what the change got wrong, and the cause in the process, meaning which step, prompt or check let it through. A finding that says the session was sloppy is not a cause.'
  );
  if (mayPost) {
    lines.push(
      `Post one comment per cause on the card: write the cause to a file and run \`node scripts/linear-cli.mjs comment ${card.identifier} --file <path>\`.`
    );
  } else {
    lines.push('Post nothing: no Linear comment, no pull request comment, no card change.');
  }
  lines.push(
    'Do not fix anything, do not push, do not merge, do not move the card. End your answer with one line that starts `ROOT CAUSE: ` and finishes the sentence in plain words.',
    'The checkout in front of you is the pull request head, so the code is there to read.'
  );
  return lines.join('\n');
}

export function rootCauseFrom(answer) {
  const text = String(answer ?? '');
  const marked = /^[ \t>*#-]*ROOT CAUSE[ \t]*:[ \t]*(.+)$/im.exec(text);
  if (marked) return marked[1].trim();
  const paragraphs = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  return paragraphs.length > 0 ? paragraphs[paragraphs.length - 1] : '';
}

async function lastAssistantText(session, threadId) {
  const messages = await session.thread.listMessages({ threadId, limit: 200 });
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    const text = textOf(message).trim();
    if (text) return text;
  }
  return '';
}

async function freshSession({ root = repoRoot, runDir, storeName = 'session', order, modelId, log = console.log }) {
  // A fresh session keeps its own store. The shared store already holds the
  // builder's thread, and a boot against it would claim that thread instead of
  // starting a new one.
  fs.mkdirSync(runDir, { recursive: true });
  const store = path.join(runDir, `${storeName}.db`);
  const storage = { backend: 'libsql', url: `file:${store}`, isRemote: false };
  const { session, booted } = await bootHarness({ cwd: root, createInitialThread: true, storage });
  try {
    const threadId = session.thread.getId();
    if (modelId) await session.model.switch(modelId);
    log(`Started a fresh session ${threadId}${modelId ? ` on ${modelId}` : ''}.`);
    await session.sendMessage({ content: order });
    return { threadId, answer: await lastAssistantText(session, threadId), store };
  } finally {
    await stopHarness(booted);
  }
}

// The resumed thread keeps the model it was built on, so no model is chosen here.
export async function handToBuilder({ root = repoRoot, card, pr, sha, determination, playbookText, log = console.log }) {
  const tools = await loadMastra();
  const client = tools.createClient({ url: `file:${tools.databasePath()}` });
  let target;
  let busy = null;
  try {
    const found = await findBuilderThread({ client, repoRoot: root, card: card.identifier });
    if (!found) {
      log(`No builder session names ${card.identifier}, so the FAIL goes to a fresh one.`);
      return null;
    }
    busy = tools.threadLockOwner(found.threadId);
    if (busy) {
      log(`The builder session ${found.threadId} is still being written by process ${busy}, so the FAIL goes to a fresh one.`);
      return null;
    }
    await makeNewest(client, found.threadId);
    target = found.threadId;
  } finally {
    client.close();
  }

  const booted = await bootOnThread(tools, { root, threadId: target });
  try {
    if (booted.session.thread.getId() !== target) await booted.session.thread.switch({ threadId: target });
    log(`Resumed the builder's own session ${target}.`);
    await booted.session.sendMessage({
      content: remediationOrder({ card, pr, sha, determination, playbookText }),
    });
    return { threadId: target, resumed: true, store: tools.databasePath() };
  } finally {
    await stopHarness(booted.booted);
  }
}

// Another session can become the newest thread between the touch and the boot. A
// second attempt re-touches, so the loop settles once no run is writing the store.
async function bootOnThread(tools, { root, threadId, attempts = 3 }) {
  for (let attempt = 1; ; attempt++) {
    const client = tools.createClient({ url: `file:${tools.databasePath()}` });
    try {
      await makeNewest(client, threadId);
    } finally {
      client.close();
    }
    try {
      return await bootHarness({ cwd: root, createInitialThread: false });
    } catch (error) {
      if (error?.name !== 'ThreadLockError' || attempt >= attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }
}

export async function startFreshBuilder({ root = repoRoot, checkout, runDir, card, pr, sha, determination, playbookText, criteria = [], modelId, log = console.log }) {
  const { threadId, store } = await freshSession({
    root: checkout ?? root,
    runDir,
    storeName: 'fresh-builder',
    modelId,
    log,
    order: freshBuilderOrder({ card, pr, sha, checkout, determination, playbookText, criteria }),
  });
  return { threadId, resumed: false, store };
}

export async function investigate({ root = repoRoot, checkout, runDir, card, pr, determinations, playbookText, mayPost = true, modelId, log = console.log }) {
  return freshSession({
    // Read the code the review read: the checkout of the pull request head.
    root: checkout ?? root,
    runDir,
    storeName: 'investigation',
    modelId,
    log,
    order: investigationOrder({ card, pr, determinations, playbookText, mayPost }),
  });
}
