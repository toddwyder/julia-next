import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { DASHBOARD_ROOT, LAND_STEPS, PREVIEW_PORT, STEPS, UNATTENDED, branchFor, buildPrompt, carriedOver, commandEnv, costFrom, freePort, lastSessionResult, ledger, machine, modelsFor, needsJudging, newRunRecord, normalizeCard, parseFlags, passing, portFree, previewKind, printed, pullNamesCard, recordFile, refreshSpend, remediationPrompt, replyFrom, retroPrompt, runIdFor, saveRecord, secondJudge, sessionArgs, sessionsInLog, shippingPrompt, smokeCommands, stateReply, stepEntry, stopRun, streamTail, suspendedAsk, thinkingForEffort, tick, uatComment, uatSection, verdictCovers, withoutColour } from './run-card.mjs';
import { shippingVerdict } from '../../scripts/check-shipping-verdict.mjs';

const temporaryState = () => {
  const root = mkdtempSync(join(tmpdir(), 'jul-292-run-'));
  return { root, env: { DASHBOARD_STATE_DIR: root }, clean: () => rmSync(root, { recursive: true, force: true }) };
};

test('a FAIL on a card that already failed is the second one, whether or not this process saw it', () => {
  assert.equal(secondJudge({ rounds: { shipping: 0 } }), false);
  assert.equal(secondJudge({ rounds: { shipping: 1 } }), true);
  assert.equal(secondJudge({ rounds: { shipping: 2 } }), true);
  assert.equal(secondJudge({}), false);
  assert.equal(secondJudge(null), false);
});

test('a preview takes a port nothing answers on, so a waiting card does not hold the next one', async () => {
  const taken = createServer();
  await new Promise(resolve => taken.listen(0, '0.0.0.0', resolve));
  const port = taken.address().port;
  try {
    assert.equal(await portFree(port), false);
    assert.ok((await freePort(port, 20)) > port);
  } finally {
    await new Promise(resolve => taken.close(resolve));
  }
});

test('a card is written the one way the board writes it', () => {
  assert.equal(normalizeCard(' jul-290 '), 'JUL-290');
  assert.equal(runIdFor('JUL-290'), 'jul-290');
  for (const wrong of ['290', 'JUL', 'JUL-', 'feat/jul-290', '']) {
    assert.throws(() => normalizeCard(wrong), /is not a card/);
  }
});

// The branch has to carry the card number, because that is the last way
// scripts/check-shipping-verdict.mjs finds the card a pull request belongs to.
test('a new branch is named after the card and the first five words of its title', () => {
  assert.equal(branchFor('JUL-290', 'Slice 4b: Account status on Start and the nearly-out warning'), 'feat/jul-290-slice-4b-account-status-on');
  assert.equal(branchFor('JUL-9', 'Fix'), 'feat/jul-9-fix');
  assert.equal(branchFor('JUL-9', '!!!'), 'feat/jul-9');
});

test('each Start screen effort is one thinking budget', () => {
  assert.equal(thinkingForEffort('small'), 'low');
  assert.equal(thinkingForEffort('medium'), 'medium');
  assert.equal(thinkingForEffort('large'), 'high');
  assert.equal(thinkingForEffort('unlimited'), 'max');
  assert.equal(thinkingForEffort('something else'), 'high');
});

// A card's label and the files it ends up touching do not always agree, and the
// address Todd opens is decided by the files: a dashboard card is proved on a
// second copy of the dashboard, a Julia card on its Vercel preview.
test('the diff decides which kind of preview a card gets', () => {
  assert.equal(previewKind(['dashboard/app/start/[card]/page.jsx', 'README.md']), 'dashboard');
  assert.equal(previewKind(['app/recipes/new/page.jsx', 'lib/recipes.js']), 'julia');
  assert.throws(() => previewKind([]), /changes no files/);
  assert.throws(() => previewKind(undefined), /changes no files/);
});

test('a pull request belongs to a card by its title or by its own Card line', () => {
  assert.equal(pullNamesCard({ title: 'JUL-290 Account status', body: '' }, 'JUL-290'), true);
  assert.equal(pullNamesCard({ title: 'Account status', body: 'Something.\n\nCard: JUL-290\n' }, 'JUL-290'), true);
  assert.equal(pullNamesCard({ title: 'Account status', body: 'mentions JUL-290 in prose' }, 'JUL-290'), false);
  // JUL-29 is not JUL-290.
  assert.equal(pullNamesCard({ title: 'JUL-29 something', body: '' }, 'JUL-290'), false);
});

test('a run record starts running, carries every step it has taken, and is saved where the dashboard reads it', () => {
  const state = temporaryState();
  try {
    const record = newRunRecord({
      card: 'JUL-290',
      branch: 'feat/jul-290-account-status',
      worktree: '/tmp/jul-290',
      models: { builder: 'openai/gpt-6.1-sol', shipping: 'mastracode/commandcode/moonshotai/Kimi-K3.1-Pro', effort: 'large' },
    });
    record.steps.push(stepEntry('build', join(state.root, 'build.log')));
    record.steps.at(-1).status = 'done';
    record.steps.at(-1).finishedAt = new Date().toISOString();
    saveRecord(record, state.env);

    assert.equal(recordFile('JUL-290', state.env), join(state.root, 'state', 'runs', 'jul-290.json'));
    const saved = JSON.parse(readFileSync(recordFile('JUL-290', state.env), 'utf8'));
    assert.equal(saved.id, 'jul-290');
    assert.equal(saved.card, 'JUL-290');
    assert.equal(saved.status, 'running');
    assert.equal(saved.steps[0].name, 'build');
    assert.equal(saved.steps[0].status, 'done');
    assert.ok(saved.steps[0].finishedAt);
    assert.deepEqual(saved.rounds, { shipping: 0, remediation: 0 });
    assert.equal(saved.waitingFor, null);
  } finally {
    state.clean();
  }
});

// The session is spawned headless through the launcher, which is the only place
// a session gets a trace file; without one its cost never reaches the scorecard.
test('a session is spawned with the model and effort the Start screen picked', () => {
  const args = sessionArgs({ model: 'openai/gpt-6.1-sol', effort: 'medium', title: 'JUL-290 build', timeoutMs: 3 * 60 * 60_000 });
  assert.deepEqual(args.slice(0, 2), ['--prompt', '-']);
  assert.equal(args[args.indexOf('--model') + 1], 'openai/gpt-6.1-sol');
  assert.equal(args[args.indexOf('--thinking-level') + 1], 'medium');
  assert.equal(args[args.indexOf('--output') + 1], 'jsonl');
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'auto');
  assert.equal(args[args.indexOf('--timeout') + 1], '10800');
});

test('the session result is the last result event, not the coloured progress lines', () => {
  const text = [
    '{"type":"thread_created","thread":{"id":"abc"}}',
    'building the change',
    '{"type":"result","status":"completed","exitCode":0,"threadId":"abc"}',
    '\u001b[u4;0m',
  ].join('\n');
  assert.equal(lastSessionResult(text).status, 'completed');
  assert.equal(lastSessionResult('no json here'), null);
  assert.equal(lastSessionResult('{"type":"result","status":"running"'), null);
});

test('the shipping prompt hands over the card, the pull request and the two shapes to report in', () => {
  const prompt = shippingPrompt({
    card: 'JUL-290',
    issue: { title: 'Account status on Start', description: '## Outcome\nRows on Start.\n\n## UAT steps\n1. Open the address.' },
    pull: { number: 383, url: 'https://github.com/toddwyder/julia-next/pull/383', headRefName: 'feat/jul-290-account-status', headRefOid: 'f0534654aa' },
    verifierModel: 'mastracode/commandcode/moonshotai/Kimi-K3.1-Pro',
  });
  assert.match(prompt, /You are Shipping for Linear card JUL-290/);
  assert.match(prompt, /Rows on Start\./);
  assert.match(prompt, /#383/);
  assert.match(prompt, /"juliaShippingVerdict":1/);
  assert.match(prompt, /"head":"f0534654aa"/);
  assert.match(prompt, /Kimi-K3\.1-Pro/);
  assert.match(prompt, /Do not fix anything, do not push, do not merge/);
});

test('the remediation prompt quotes what Shipping saw and keeps the merge out of its hands', () => {
  const prompt = remediationPrompt({
    card: 'JUL-290',
    issue: { title: 'Account status on Start' },
    pull: { number: 383, url: 'https://github.com/toddwyder/julia-next/pull/383', headRefName: 'feat/jul-290-account-status' },
    verdict: { criteria: [{ criterion: 'The row shows the reset time', verdict: 'FAIL', note: 'the row shows no reset time' }] },
  });
  assert.match(prompt, /Bug fix playbook/);
  assert.match(prompt, /The row shows the reset time: the row shows no reset time/);
  assert.match(prompt, /Do not merge and do not move the card/);
});

// The verdict the machine acts on is the gate's own answer, so a card can never
// land on a verdict the shipping-verdict check would refuse.
test('the machine passes on exactly what the shipping gate would pass', () => {
  const pull = { title: 'JUL-290 Account status', body: '', head: { sha: 'f0534654aa', ref: 'feat/jul-290-account-status' } };
  const verdictFor = (verdict, head = 'f0534654aa') => ({
    id: '1',
    createdAt: '2026-10-30T10:00:00.000Z',
    body: `seen\n\n\`\`\`json\n${JSON.stringify({
      juliaShippingVerdict: 1, card: 'JUL-290', head, verdict,
      builder: 'toddwyder', verifier: 'Kimi K3.1 Pro',
      criteria: [{ criterion: 'Rows on Start', verdict, note: 'opened the Start screen' }],
    })}\n\`\`\``,
  });
  assert.equal(passing(shippingVerdict({ pull, comments: [verdictFor('PASS')] })), true);
  assert.equal(passing(shippingVerdict({ pull, comments: [verdictFor('FAIL')] })), false);
  assert.equal(passing(shippingVerdict({ pull, comments: [verdictFor('PASS', 'older00')] })), false);
  assert.equal(passing(shippingVerdict({ pull, comments: [] })), false);
});

test('Todd is handed the card page of a dashboard preview and the card steps in his own words', () => {
  const issue = {
    description: [
      '## Outcome', 'Rows on Start.', '',
      '## Accept the card when', '1. Rows appear.',
      '', '## UAT steps', '1. Open the address.', '2. Look at the rows.', '',
      '## Notes', 'not part of the steps',
    ].join('\n'),
  };
  assert.equal(uatSection(issue.description), '1. Open the address.\n2. Look at the rows.');
  const preview = { kind: 'dashboard', address: 'http://100.119.112.9:4314', cardPage: `http://100.119.112.9:4314/start/JUL-290` };
  const comment = uatComment({ card: 'JUL-290', issue, preview });
  assert.match(comment, /http:\/\/100\.119\.112\.9:4314\/start\/JUL-290/);
  assert.match(comment, /1\. Open the address\./);
  assert.doesNotMatch(comment, /not part of the steps/);
  // The For Todd guard refuses a `For Todd:` line that asks for anything but an
  // account-only action, money or a product decision. This comment asks for none
  // of those words, and posts as plain prose.
  assert.doesNotMatch(comment, /For Todd:/);
});

test('the regression suite runs on the preview address, never against the live one', () => {
  const dashboard = smokeCommands({ kind: 'dashboard', address: 'http://100.119.112.9:4314', worktree: '/srv/card' });
  assert.deepEqual(dashboard.map(entry => entry.args.join(' ')), [
    'test',
    'run lint',
    'scripts/lanes.mjs --url http://100.119.112.9:4314',
    'scripts/check-start-address.mjs http://100.119.112.9:4314',
  ]);
  assert.equal(dashboard[2].cwd, join('/srv/card', 'dashboard'));

  const julia = smokeCommands({ kind: 'julia', address: 'https://julia-next-git-x.vercel.app', worktree: '/srv/card' });
  assert.deepEqual(julia.map(entry => entry.what), [
    'verify-julia launch --url https://julia-next-git-x.vercel.app',
    'verify-julia doctor',
    'verify-julia test',
  ]);
  assert.deepEqual(julia[0].args.slice(1), ['launch', '--url', 'https://julia-next-git-x.vercel.app']);
  assert.deepEqual(julia[2].args.slice(1, 2), ['test']);
  assert.ok(julia[2].args.length > 2, 'the whole spec suite runs, not one file');
});

// The models come from what the Start screen saved, so a run does what the
// picks said; Shipping is its own slot and never the builder's model.
test('the build uses the Start screen picks and Shipping its own slot', () => {
  const state = temporaryState();
  try {
    mkdirSync(join(state.root, 'state'), { recursive: true });
    writeFileSync(join(state.root, 'state', 'draft.json'), JSON.stringify({
      version: 1, card: 'JUL-280', effort: 'medium',
      groups: { building: { model: 'commandcode/deepseek/deepseek-v4.1-flash', roles: {} } },
    }));
    const models = modelsFor(state.env);
    assert.equal(models.builder, 'commandcode/deepseek/deepseek-v4.1-flash');
    assert.equal(models.effort, 'medium');
    const defaults = JSON.parse(readFileSync(join(DASHBOARD_ROOT, 'config', 'defaults.json'), 'utf8'));
    assert.equal(models.shipping, defaults.shipping);
    assert.equal(defaults.shipping, 'mastracode/commandcode/moonshotai/Kimi-K3.1-Pro');
    assert.notEqual(defaults.shipping.split('/')[0], defaults.mainSession.split('/')[0]);
  } finally {
    state.clean();
  }
});

// A step that runs twice must not append its second round onto the first round's
// log: the tail of that file is then the round before, and a line truncated mid
// write in it reads as an answer it never gave.
// JUL-290's remediation session streamed past 500MB and the runner died keeping it
// all in one string. The log file keeps everything; the runner keeps the tail and
// remembers any suspension it saw, wherever in the stream it happened.
test('a session that streams for hundreds of megabytes is kept to its tail', () => {
  const stream = streamTail(600);
  stream.push(`${JSON.stringify({ type: 'tool_suspended', toolName: 'request_access', suspendPayload: { reason: 'Read the models file' } })}\n`);
  for (let index = 0; index < 50; index += 1) stream.push(`${'x'.repeat(200)}\n`);
  stream.push(`${JSON.stringify({ type: 'result', status: 'completed', text: 'judged', exitCode: 0 })}\n`);
  assert.ok(stream.text().length <= 600);
  assert.match(stream.text(), /"type":"result"/);
  assert.deepEqual(stream.ask(), { toolName: 'request_access', reason: 'Read the models file' });
});

// The record has to survive the runner dying: a card picked up again keeps the
// round that failed, or the finished record reads like a card that passed first time.
test('a resumed run keeps the steps and rounds the earlier one wrote', () => {
  const record = newRunRecord({ card: 'JUL-290', branch: 'feat/x', worktree: '/tmp/wt', models: modelsFor({}), pull: { number: 383 } });
  const prior = {
    ...record,
    status: 'failed',
    startedAt: '2026-10-30T21:52:32.615Z',
    steps: [stepEntry('shipping', '/tmp/shipping.log'), { ...stepEntry('remediation', '/tmp/remediation.log'), status: 'failed' }],
    rounds: { shipping: 1, remediation: 1 },
    sessions: [{ step: 'shipping', model: 'x', usage: { inputTokens: 10 }, at: '2026-10-30T21:53:00.000Z' }],
  };
  const carried = carriedOver(record, prior);
  assert.equal(carried.startedAt, '2026-10-30T21:52:32.615Z');
  assert.deepEqual(carried.rounds, { shipping: 1, remediation: 1 });
  assert.equal(carried.steps.length, 2);
  assert.equal(carried.steps[0].status, 'failed', 'a step the runner died inside did not finish');
  assert.equal(carried.sessions.length, 1);
  assert.ok(carried.resumedAt);
  assert.deepEqual(carriedOver(record, null).steps, []);
});

test('a step that runs again writes its own log', async () => {
  const state = temporaryState();
  try {
    const record = newRunRecord({ card: 'JUL-290', branch: 'feat/x', worktree: '/tmp/wt', models: modelsFor(state.env), pull: { number: 383 } });
    const { step } = ledger(record, state.env);
    await step('shipping', async () => 'first round');
    await step('shipping', async () => 'second round');
    assert.match(record.steps[0].log, /shipping\.log$/);
    assert.match(record.steps[1].log, /shipping-2\.log$/);
    assert.notEqual(record.steps[0].log, record.steps[1].log);
  } finally {
    state.clean();
  }
});

test('the flags a run is started with are only the ones it explains', () => {
  assert.deepEqual(parseFlags(['--branch', 'feat/x', '--state', '/tmp/s']), { branch: 'feat/x', state: '/tmp/s' });
  assert.deepEqual(parseFlags(['--from', 'preview', '--worktree', '/home/ubuntu/julia-mastra']), { from: 'preview', worktree: '/home/ubuntu/julia-mastra' });
  assert.throws(() => parseFlags(['--repo', '/tmp/r']), /unknown flag "--repo"/);
  assert.throws(() => parseFlags(['--state']), /--state needs a value/);
});

// A card that already has its pull request is carried on from the step it stopped at,
// which is how the machine proves itself on a card that a person built.
test('a card is picked up at the step it is told to start from', () => {
  assert.deepEqual([...STEPS], ['build', 'shipping', 'remediation', 'preview', 'smoke', 'uat']);
});

// A run that starts at remediation is a card whose judge already said FAIL, so it
// must still go through Shipping after remediation. A run that starts after the
// judge trusts the verdict already on the pull request.
test('every step before the preview goes through the judge, and the ones after it do not', () => {
  for (const from of ['build', 'shipping', 'remediation']) assert.equal(needsJudging(from), true, from);
  for (const from of ['preview', 'smoke', 'uat']) assert.equal(needsJudging(from), false, from);
});

test('a run started past the build needs a pull request to carry on from', async () => {
  const state = temporaryState();
  try {
    // The step name is checked before anything else, so this never leaves the machine.
    await assert.rejects(machine({ card: 'JUL-290', env: state.env, from: 'merge' }), /--from must be one of build, shipping, remediation, preview, smoke, uat/);
  } finally {
    state.clean();
  }
});

// spawnSync reports its exit code as `status`. Reading `code` made every command look failed,
// which stopped the machine before it could read its first card.
test('a command that works is read, and one that fails says how', () => {
  assert.match(printed('git', ['--version']), /git version/);
  assert.throws(() => printed('git', ['rev-parse', '--verify', 'no-such-ref']), /failed \(exit 128\)/);
});

// This agent shell sets CLICOLOR_FORCE, which made `gh` paint its JSON and every read fail.
test('commands run with colour off and their output has any left stripped', () => {
  const env = commandEnv({ CLICOLOR_FORCE: '1', GH_FORCE_TTY: '1', PATH: '/bin' });
  assert.equal(env.CLICOLOR_FORCE, undefined);
  assert.equal(env.GH_FORCE_TTY, undefined);
  assert.equal(env.NO_COLOR, '1');
  assert.equal(env.PATH, '/bin');
  assert.equal(withoutColour('\u001b[1;38m[\u001b[m'), '[');
});

test('the preview port is its own, off the live dashboard', () => {
  assert.equal(PREVIEW_PORT, 4314);
});

// JUL-290's first Shipping turn asked for access to ~/.agents, which ends a headless
// turn instead of asking anyone. That has to read as a broken session, not a failed card.
test('a session that asks for something nobody can approve is found, not read as a verdict', () => {
  const log = [
    '{"type":"message_start"}',
    '{"type":"tool_suspended","toolName":"request_access","suspendPayload":{"kind":"sandbox_access","reason":"Read the models file"}}',
    '{"type":"result","status":"completed","finishReason":"suspended","text":""}',
  ].join('\n');
  assert.deepEqual(suspendedAsk(log), { toolName: 'request_access', reason: 'Read the models file' });
  assert.equal(suspendedAsk('{"type":"result","status":"completed"}'), null);
  assert.equal(suspendedAsk('not json at all'), null);
});

// The three prompts are the only place a session can learn that nobody will answer it.
test('every prompt says the run is unattended before the session starts to work', () => {
  const card = { card: 'JUL-290', issue: { title: 'Account status', description: '## Outcome\nrows' } };
  const pull = { number: 383, url: 'https://github.com/toddwyder/julia-next/pull/383', headRefName: 'feat/jul-290', headRefOid: 'f053465' };
  for (const prompt of [
    buildPrompt({ ...card, branch: pull.headRefName, pull }),
    shippingPrompt({ ...card, pull, verifierModel: 'moonshotai/Kimi-K3.1-Pro' }),
    remediationPrompt({ ...card, pull, verdict: { criteria: [{ criterion: 'rows', verdict: 'FAIL', note: 'missing' }] } }),
    retroPrompt({ ...card, pull, merge: { commit: 'abc123' }, cost: '$1.69' }),
  ]) {
    assert.match(prompt, /unattended/);
    assert.match(prompt, /request_access/);
    assert.ok(prompt.includes(UNATTENDED));
  }
});

// A retro branch cut from the card's own merged branch would carry that branch's
// commits back into a pull request that is meant to hold the retro alone.
test('the retro session is told to start from main, not from the card branch it inherits', () => {
  const prompt = retroPrompt({
    card: 'JUL-290',
    issue: { title: 'Account status', description: '## Outcome\nrows' },
    pull: { number: 383 },
    merge: { commit: 'abc123' },
    cost: '$1.69',
  });
  assert.match(prompt, /git fetch origin main/);
  assert.match(prompt, /retro\/jul-290/);
  assert.match(prompt, /already merged and gone/);
  assert.match(prompt, /\$1\.69/);
});

test('a session is priced from the log it wrote, even when its last line never finished', async () => {
  const state = temporaryState();
  try {
    const log = join(state.root, 'shipping.log');
    const line = event => `${JSON.stringify(event)}\n`;
    writeFileSync(log, [
      '$ mastracode --prompt - --output jsonl\n',
      line({ type: 'thread_created', thread: { id: 'thread-a', createdAt: '2026-10-30T22:00:00.000Z' } }),
      line({ type: 'usage_update', usage: { promptTokens: 1000, completionTokens: 10, cachedInputTokens: 900, reasoningTokens: 2 } }),
      line({ type: 'usage_update', usage: { promptTokens: 2000, completionTokens: 20, cachedInputTokens: 1900, reasoningTokens: 3 } }),
      line({ type: 'thread_created', thread: { id: 'thread-b', createdAt: '2026-10-30T22:30:00.000Z' } }),
      line({ type: 'usage_update', usage: { promptTokens: 500, completionTokens: 5, cachedInputTokens: 0, reasoningTokens: 0 } }),
      '{"type":"result","status":"completed","text":"the judge judged and then the wri',
    ].join(''));

    const sessions = await sessionsInLog(log);
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].threadId, 'thread-a');
    assert.deepEqual(sessions[0].usage, { promptTokens: 3000, completionTokens: 30, cachedInputTokens: 2800, reasoningTokens: 5 });
    assert.equal(sessions[1].threadId, 'thread-b');

    const record = newRunRecord({
      card: 'JUL-290',
      branch: 'feat/jul-290-account-status',
      worktree: '/tmp/jul-290',
      models: { builder: 'commandcode/deepseek/deepseek-v4.1-flash', shipping: 'mastracode/commandcode/moonshotai/Kimi-K3.1-Pro', effort: 'medium' },
    });
    record.steps.push({ ...stepEntry('shipping', log), status: 'failed' });
    saveRecord(record, state.env);

    const first = await refreshSpend(record, state.env);
    assert.equal(first.length, 2);
    assert.equal(first[0].step, 'shipping');
    assert.equal(first[0].model, record.models.shipping);
    assert.equal(first[0].log, log);

    // A log that has not grown is not read a second time, and does not double the spend.
    assert.equal((await refreshSpend(record, state.env)).length, 2);

    appendFileSync(log, `\n${JSON.stringify({ type: 'thread_created', thread: { id: 'thread-c', createdAt: '2026-10-30T23:00:00.000Z' } })}\n${JSON.stringify({ type: 'usage_update', usage: { promptTokens: 7, completionTokens: 1, cachedInputTokens: 0, reasoningTokens: 0 } })}\n`);
    const grown = await refreshSpend(record, state.env);
    assert.equal(grown.length, 3);
    assert.equal(grown[2].threadId, 'thread-c');
    assert.equal(JSON.parse(readFileSync(recordFile('JUL-290', state.env), 'utf8')).sessions.length, 3);
  } finally {
    state.clean();
  }
});

test('a run left behind by a killed process is stopped on purpose before it is started again', () => {
  const state = temporaryState();
  try {
    const record = newRunRecord({ card: 'JUL-290', branch: 'feat/jul-290-account-status', worktree: '/tmp/jul-290' });
    record.status = 'waiting';
    record.waitingFor = "Todd's yes on http://100.119.112.9:4314/start/JUL-290";
    record.preview = { kind: 'dashboard', address: 'http://100.119.112.9:4314' };
    saveRecord(record, state.env);

    const stopped = stopRun({ card: 'JUL-290', env: state.env });
    const written = JSON.parse(readFileSync(recordFile('JUL-290', state.env), 'utf8'));
    assert.equal(stopped.status, 'stopped');
    assert.equal(written.status, 'stopped');
    assert.equal(written.stoppedBecause, 'stopped by hand');
    assert.equal(written.waitingFor, null);
    assert.equal(written.preview, null);
    assert.throws(() => stopRun({ card: 'JUL-999', env: state.env }), /has no run record/);
  } finally {
    state.clean();
  }
});

// A card that lands is decided by exactly one signal: what Todd says after the
// hand-off. Everything the machine wrote before that is its own voice.
test('only a reply after the hand-off counts as Tods answer', () => {
  const comments = [
    { body: 'yes from before the hand-off', createdAt: '2026-10-30T10:00:00.000Z' },
    { body: 'Build evidence: rows show', createdAt: '2026-10-30T21:00:00.000Z' },
    { body: 'maybe later', createdAt: '2026-10-30T21:10:00.000Z' },
    { body: 'Yes, that all holds.', createdAt: '2026-10-30T21:20:00.000Z' },
  ];
  assert.deepEqual(replyFrom(comments, '2026-10-30T20:00:00.000Z'), {
    decision: 'yes',
    quote: 'Yes, that all holds.',
    at: '2026-10-30T21:20:00.000Z',
  });
  assert.equal(replyFrom([{ body: 'no, the warning is wrong', createdAt: '2026-10-30T21:20:00.000Z' }], '2026-10-30T20:00:00.000Z').decision, 'no');
  assert.equal(replyFrom(comments.slice(0, 3), '2026-10-30T20:00:00.000Z').decision, 'none');
  assert.equal(replyFrom([], null).decision, 'none');
});

test('a card moved out of UAT answered too, and Complete is a yes', () => {
  assert.deepEqual(stateReply('UAT'), { decision: 'none' });
  assert.equal(stateReply('Complete').decision, 'yes');
  assert.equal(stateReply('Ready').decision, 'no');
  assert.match(stateReply('Backlog').quote, /moved from UAT to Backlog/);
});

// The merge rule from docs/plans/path-forward.md: a PASS covers the head it saw.
test('a passing verdict only covers the code it looked at', () => {
  assert.equal(verdictCovers({ ok: true, head: 'f053465' }, 'f053465'), true);
  assert.equal(verdictCovers({ ok: true, head: 'f053465' }, 'aabbccd'), false);
  assert.equal(verdictCovers({ ok: false, head: 'f053465' }, 'f053465'), false);
  assert.equal(verdictCovers(null, 'f053465'), false);
});

test('the cost a landed card carries is the one written on its scorecard', () => {
  assert.equal(costFrom('- Cost: **$1.69** at published API prices, plus 101.95M cache-read tokens'), '$1.69');
  assert.equal(costFrom('- Cost: **unknown**. Mastra kept no token detail for these runs.'), 'unknown');
  assert.equal(costFrom(''), 'unknown');
});

test('landing happens in order and only after the yes', () => {
  assert.deepEqual([...LAND_STEPS], ['merge', 'live', 'complete', 'retro']);
});

test('a tick with no runs to read does nothing', async () => {
  const state = temporaryState();
  try {
    assert.deepEqual(await tick(state.env), []);
  } finally {
    state.clean();
  }
});

test('run-card.mjs prints its usage and exits 2 when it is started wrong', () => {
  const result = spawnSync(process.execPath, [join(DASHBOARD_ROOT, 'scripts', 'run-card.mjs')], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: run-card\.mjs start <CARD>/);
});
