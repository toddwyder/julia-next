// The builder is the session that made the change. A FAIL goes back to that
// same thread, so the fix carries the reasoning that made the change; when the
// thread is gone the machine starts a new builder and says so on the card.
// Everything here is either a pure order or one boot of the harness.

import fs from 'node:fs';
import path from 'node:path';

import { bootHarness, stopHarness } from '../shipping/harness.mjs';
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

function metadataOf(thread) {
  const metadata = thread?.metadata;
  if (!metadata || typeof metadata !== 'string') return metadata ?? {};
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
}

function textOf(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content?.parts)) return '';
  return content.parts
    .filter(part => part?.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n');
}

// The store keeps a user's turn with role `signal` and type `user`, so the
// role field alone finds nothing. Only the title and the user's own turns are
// read: an agent naming a neighbouring card must not claim it for this one.
export async function findBuilderThread({ session, repoRoot: root = repoRoot, card, limit = 500 }) {
  const pattern = cardPattern(card);
  const threads = await session.thread.list({});
  const inProject = threads.filter(thread => metadataOf(thread)?.projectPath === root);
  let newest = null;
  for (const thread of inProject) {
    const namedInTitle = pattern.test(String(thread.title ?? ''));
    if (!namedInTitle) {
      const messages = await session.thread.listMessages({ threadId: thread.id, limit });
      if (!messages.some(message => message?.type === 'user' && pattern.test(textOf(message)))) continue;
    }
    if (!newest || String(thread.updatedAt ?? '') > String(newest.updatedAt ?? '')) newest = thread;
  }
  return newest ? { threadId: newest.id, title: newest.title ?? '', updatedAt: newest.updatedAt ?? null } : null;
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

export function freshBuilderOrder({ card, pr, sha, determination, playbookText, criteria = [], playbook = BUG_FIX_PLAYBOOK }) {
  return [
    `You are a fresh builder. The session that wrote pull request #${pr} (${pullRequestUrl(pr)}) cannot be found, so nothing of that session is here.`,
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
    'The checkout is in front of you and the pull request branch is the one to fix. Shipping failed it with this determination, quoted word for word.',
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

async function freshSession({ root = repoRoot, order, modelId, log = console.log }) {
  const { session, booted } = await bootHarness({ cwd: root, createInitialThread: true });
  try {
    const threadId = session.thread.getId();
    if (modelId) await session.model.switch(modelId);
    log(`Started a fresh session ${threadId}${modelId ? ` on ${modelId}` : ''}.`);
    await session.sendMessage({ content: order });
    return { threadId, answer: await lastAssistantText(session, threadId) };
  } finally {
    await stopHarness(booted);
  }
}

// The resumed thread keeps the model it was built on, so no model is chosen here.
export async function handToBuilder({ root = repoRoot, card, pr, sha, determination, playbookText, criteria = [], log = console.log }) {
  const { session, booted } = await bootHarness({ cwd: root, createInitialThread: false });
  try {
    const found = await findBuilderThread({ session, repoRoot: root, card: card.identifier });
    if (!found) {
      log(`No builder session names ${card.identifier}, so the FAIL goes to a fresh one.`);
      return null;
    }
    await session.thread.switch({ threadId: found.threadId });
    log(`Resumed the builder's own session ${found.threadId} (${found.title}).`);
    await session.sendMessage({
      content: remediationOrder({ card, pr, sha, determination, playbookText }),
    });
    return { threadId: found.threadId, resumed: true };
  } finally {
    await stopHarness(booted);
  }
}

export async function startFreshBuilder({ root = repoRoot, card, pr, sha, determination, playbookText, criteria = [], modelId, log = console.log }) {
  const { threadId } = await freshSession({
    root,
    modelId,
    log,
    order: freshBuilderOrder({ card, pr, sha, determination, playbookText, criteria }),
  });
  return { threadId, resumed: false };
}

export async function investigate({ root = repoRoot, card, pr, determinations, playbookText, mayPost = true, modelId, log = console.log }) {
  return freshSession({
    root,
    modelId,
    log,
    order: investigationOrder({ card, pr, determinations, playbookText, mayPost }),
  });
}
