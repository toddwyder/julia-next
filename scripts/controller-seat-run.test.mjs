// controller-seat-run.test.mjs -- JUL-98 step 8: the controller side of the
// single-command route (graph/controller/seat-run.mjs). A fake Orca terminal,
// a fake clock and a real temp folder stand in for the worker; the real route
// is proven on the server by scripts/controller-stand-in.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  launchFor, buildStepBrief, reportingInstructions, seatCommand, parseProgress, validateAnswer, costLineFor,
  runSeat, seatFilePaths, seatTag, MAX_BRIEF_B64, STUCK_AFTER_MS, PROGRESS_READ_MS, SEAT_ROUTES, cutOffOf, stopGroupCommand,
} from '../graph/controller/seat-run.mjs';
import { WORKER_SCRIPT_END_MARKER } from '../graph/controller/wiring.mjs';
import { formatCostLine } from '../graph/controller/cost.mjs';
import { ORCA_FIXTURE_DIR } from '../graph/controller/fixture-orca.mjs';
import { parseArgs as parseRunSeatArgs } from './run-seat.mjs';

const dirs = [];
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'seat-run-')); dirs.push(d); return d; };

const GEMINI = { entry: 'gemini', modelLabel: 'builder-gemini-flash', effort: 'medium' };
const DEEPSEEK = { entry: 'pi-deepseek', modelLabel: 'adversary-deepseek-pro', effort: 'high' };

test('the route runs ONLY a Gemini builder and a DeepSeek reviewer today, and says why it refuses anything else', () => {
  assert.deepEqual(SEAT_ROUTES, { builder: { entry: 'gemini', agent: 'agy' }, reviewer: { entry: 'pi-deepseek', agent: 'pi' } });
  const builder = launchFor('builder', GEMINI);
  assert.deepEqual({ agent: builder.agent, model: builder.model, effort: builder.effort }, { agent: 'agy', model: 'gemini-3.8-flash', effort: 'medium' });
  const reviewer = launchFor('reviewer', DEEPSEEK);
  assert.deepEqual({ agent: reviewer.agent, model: reviewer.model }, { agent: 'pi', model: 'deepseek-v4-pro' });

  const claude = launchFor('reviewer', { entry: 'claude', modelLabel: 'adversary-claude-opus', effort: 'medium' });
  assert.equal(claude.ok, false);
  assert.match(claude.reason, /runs only on pi-deepseek for now .*no backups yet.*"claude".*adversary-claude-opus/);
  assert.equal(launchFor('builder', { entry: 'claude', modelLabel: 'builder-claude-opus' }).ok, false);
  assert.equal(launchFor('builder', { entry: 'codex', modelLabel: 'builder-codex' }).ok, false);
});

test('the free stand-in is reachable only when the caller asks for it, never from a card', () => {
  assert.equal(launchFor('builder', { entry: 'stand-in' }).ok, false);
  const standIn = launchFor('builder', null, { standIn: true });
  assert.deepEqual({ ok: standIn.ok, agent: standIn.agent }, { ok: true, agent: 'stand-in' });
});

test('the brief names the seat\'s own standing orders, the card and the step, and carries a prior finding only when there is one', () => {
  const card = { identifier: 'JUL-92', title: 'Docs match', url: 'https://linear.app/x' };
  const first = buildStepBrief({ seat: 'builder', card, step: { title: 'Docs match', brief: 'Fix the docs.' } });
  assert.match(first, /\.claude\/skills\/julia-builder\/SKILL\.md/);
  assert.match(first, /Fix the docs\./);
  assert.doesNotMatch(first, /finding you are fixing/);
  const second = buildStepBrief({ seat: 'builder', card, step: { title: 'Docs match', brief: 'Fix the docs.', priorFinding: 'F1: the rename missed CLAUDE.md' } });
  assert.match(second, /## The review finding you are fixing\n\nF1: the rename missed CLAUDE.md/);
  assert.throws(() => buildStepBrief({ seat: 'consultant', card, step: { title: 't' } }), /no worker skill/);
});

test('the reporting instructions name the exact two files, the five-minute stuck rule and the time limit', () => {
  const text = reportingInstructions({ seat: 'reviewer', tag: 'round-2-reviewer', timeLimitMs: 20 * 60000 });
  assert.match(text, /\.julia\/round-2-reviewer\.progress\.jsonl/);
  assert.match(text, /\.julia\/round-2-reviewer\.answer\.json/);
  assert.match(text, /five minutes, you are treated as stuck/);
  assert.match(text, /20 minutes/);
  assert.match(text, /"verdict":"changes_needed"/);
  assert.match(reportingInstructions({ seat: 'builder', tag: 'round-1-builder', timeLimitMs: 60000 }), /"outcome":"done"/);
});

test('the command carries the brief as base64 that run-seat.mjs decodes back EXACTLY, ends with the marker, and refuses a quote in a path', () => {
  const brief = `# JUL-92\nIt's "quoted" and $HOME and \`ticks\`\n`;
  const command = seatCommand({
    worktreePath: '/home/runner/orca/workspaces/julia-next/jul-92-work-a1', seat: 'builder',
    launch: { agent: 'agy', model: 'gemini-3.8-flash', effort: 'medium' }, tag: 'round-1-builder', timeLimitMs: 30 * 60000, brief,
  });
  assert.ok(command.endsWith(`; echo "${WORKER_SCRIPT_END_MARKER}:$?"`));
  // Round-trip through run-seat.mjs's own parser, with the shell quoting undone.
  const argv = command.split('; echo')[0].split(' ').slice(2).map((part) => part.replace(/^'|'$/g, ''));
  const parsed = parseRunSeatArgs(argv);
  assert.equal(parsed.brief, brief);
  assert.equal(parsed.timeoutSeconds, 1800);
  assert.equal(parsed.tag, 'round-1-builder');
  assert.throws(() => seatCommand({ worktreePath: "/tmp/it's", seat: 'builder', launch: { agent: 'agy', model: 'm', effort: 'low' }, tag: 'round-1-builder', timeLimitMs: 1000, brief: 'b' }), /quote/);
});

test('a brief too big to carry safely in a command is refused, not sent cut', () => {
  const huge = 'x'.repeat(Math.ceil(MAX_BRIEF_B64 * 0.8));
  assert.throws(() => seatCommand({ worktreePath: '/w', seat: 'builder', launch: { agent: 'agy', model: 'm', effort: 'low' }, tag: 'round-1-builder', timeLimitMs: 1000, brief: huge }), /over the 36000/);
});

test('progress lines are read in the old mailbox shape -- payload as an object OR as Orca sent it, a JSON string -- and junk is counted, not guessed', () => {
  const text = [
    JSON.stringify({ type: 'status', subject: 'red', body: '', payload: { phase: 'tdd' }, created_at: 'T1' }),
    'not json at all',
    JSON.stringify({ type: 'heartbeat', subject: 'still here', payload: '{"phase":"tdd"}', created_at: 'T2' }),
    '',
  ].join('\n');
  const read = parseProgress(text);
  assert.equal(read.entries.length, 2);
  assert.equal(read.invalid, 1);
  assert.equal(read.last.type, 'heartbeat');
  assert.equal(read.last.phase, 'tdd');
  assert.equal(read.lastStatus.subject, 'red');
});

test('an answer is checked for shape: the outcome or verdict must be one of the two, and changes need findings', () => {
  assert.equal(validateAnswer('builder', { outcome: 'done', summary: 's' }), null);
  assert.match(validateAnswer('builder', { outcome: 'succeeded', summary: 's' }), /not "done" or "blocked"/);
  assert.match(validateAnswer('builder', { outcome: 'done' }), /no summary/);
  assert.equal(validateAnswer('reviewer', { verdict: 'approve' }), null);
  assert.match(validateAnswer('reviewer', { verdict: 'CHANGES NEEDED' }), /not "approve" or "changes_needed"/);
  assert.match(validateAnswer('reviewer', { verdict: 'changes_needed' }), /named no findings/);
  assert.match(validateAnswer('reviewer', null), /not a JSON object/);
});

test('cost lines: DeepSeek from its own saved JSON stream, Gemini from the two allowance readings, the stand-in as a zero line -- and a failure is a named read-failed line', () => {
  const run = { startedAt: '2026-09-23T05:00:00.000Z', endedAt: '2026-09-23T05:06:00.000Z' };
  const stream = readFileSync(join(ORCA_FIXTURE_DIR, 'cost.pi.seat-json-stream.multi-turn.jsonl'), 'utf8');
  const pi = costLineFor({ seat: 'reviewer', launch: { agent: 'pi', model: 'deepseek-v4-pro' }, run, outText: stream });
  assert.ok(!pi.readFailed, pi.reason);
  assert.ok(pi.totalTokens > 0);
  assert.match(formatCostLine(pi), /\*\*Reviewer\*\* -- .* tokens -- .* 6 min -- \$/);

  const before = { 'gemini-weekly': { remaining: 0.9, resetTime: 'W' }, 'gemini-5h': { remaining: 0.8, resetTime: 'H' } };
  const after = { 'gemini-weekly': { remaining: 0.89, resetTime: 'W' }, 'gemini-5h': { remaining: 0.7, resetTime: 'H' } };
  const agy = costLineFor({ seat: 'builder', launch: { agent: 'agy', model: 'gemini-3.8-flash' }, run: { ...run, allowanceBefore: before, allowanceAfter: after }, outText: '' });
  assert.equal(agy.billing, 'allowance');
  assert.match(formatCostLine(agy), /weekly 1\.00%/);

  const standIn = costLineFor({ seat: 'builder', launch: { agent: 'stand-in', model: 'stand-in' }, run });
  assert.match(formatCostLine(standIn), /\$0\.0000/);

  const noAllowance = costLineFor({ seat: 'builder', launch: { agent: 'agy', model: 'gemini-3.8-flash' }, run: { ...run, allowanceError: 'agy not signed in' } });
  assert.equal(noAllowance.readFailed, true);
  assert.match(formatCostLine(noAllowance), /cost read failed: the Gemini allowance could not be read: agy not signed in/);
  const empty = costLineFor({ seat: 'reviewer', launch: { agent: 'pi', model: 'deepseek-v4-pro' }, run, outText: '' });
  assert.equal(empty.readFailed, true);
});

// ---------------------------------------------------------------------------
// runSeat, end to end against a fake terminal and a fake clock
// ---------------------------------------------------------------------------

function harness({ worktreePath, script }) {
  // `script(step, api)` is called on every terminal read; it may write files and
  // return lines. The clock only moves when the controller sleeps.
  let clock = 0;
  let reads = 0;
  const closed = [];
  const created = [];
  const stops = [];
  const boundaries = {
    stopAnswer: null, // (lines) the stop terminal prints, or a function run when it is read
    async workerTerminalCreateImpl(args) {
      created.push(args);
      if (args.title.startsWith('julia-stop-')) { stops.push(args); return { terminal: { handle: 'term_stop' } }; }
      return { terminal: { handle: 'term_seat' } };
    },
    async terminalReadImpl({ terminal }) {
      if (terminal === 'term_stop') {
        const answer = typeof boundaries.stopAnswer === 'function' ? boundaries.stopAnswer() : boundaries.stopAnswer;
        return { terminal: { tail: answer ?? [], nextCursor: 1 } };
      }
      reads += 1;
      const lines = script(reads, { clock: () => clock }) ?? [];
      return { terminal: { tail: lines, nextCursor: reads } };
    },
    async terminalCloseImpl(args) { closed.push(args); },
  };
  return {
    boundaries,
    closed,
    created,
    stops,
    options: {
      worktreePath,
      boundaries,
      nowMs: () => clock,
      sleepImpl: async (ms) => { clock += ms; },
      warn: () => {},
    },
  };
}

function seatDir(worktreePath, tag) {
  const paths = seatFilePaths(worktreePath, tag);
  mkdirSync(paths.dir, { recursive: true });
  return paths;
}

const standInLaunch = { agent: 'stand-in', model: 'stand-in', effort: 'low' };
const runRecord = (extra = {}) => JSON.stringify({ startedAt: '2026-09-23T05:00:00.000Z', endedAt: '2026-09-23T05:01:00.000Z', exitCode: 0, timedOut: false, spawnError: null, ...extra });

test('a seat that finishes: the answer is read from its FILE, the progress step goes on the card once per change, and the terminal is closed', async () => {
  const worktreePath = tempDir();
  const paths = seatDir(worktreePath, 'round-1-builder');
  const shown = [];
  const h = harness({
    worktreePath,
    script: (read) => {
      if (read === 1) appendFileSync(paths.progress, `${JSON.stringify({ type: 'status', subject: 'writing the test', payload: { phase: 'red' } })}\n`);
      if (read === 2) appendFileSync(paths.progress, `${JSON.stringify({ type: 'heartbeat', subject: 'still here', payload: { phase: 'red' } })}\n`);
      if (read === 3) appendFileSync(paths.progress, `${JSON.stringify({ type: 'status', subject: 'making it pass', payload: { phase: 'green' } })}\n`);
      if (read === 4) {
        writeFileSync(paths.answer, JSON.stringify({ outcome: 'done', summary: 'committed' }));
        writeFileSync(paths.run, runRecord());
        return ['run-seat: round-1-builder exited 0; answer written', `${WORKER_SCRIPT_END_MARKER}:0`];
      }
      return ['...'];
    },
  });
  const result = await runSeat({
    ...h.options, seat: 'builder', round: 1, launch: standInLaunch, brief: '# the brief',
    progressReadMs: 0,
    onProgress: async (p) => { shown.push(p.status.subject); },
  });
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.answer, { outcome: 'done', summary: 'committed' });
  assert.deepEqual(shown, ['writing the test', 'making it pass'], 'a heartbeat does not re-post the same step');
  assert.equal(result.progress.entries.length, 3);
  assert.deepEqual(h.closed, [{ terminal: 'term_seat' }]);
  assert.equal(h.created[0].title, 'julia-seat-round-1-builder');
  assert.match(h.created[0].command, /--brief-b64 [A-Za-z0-9+/=]+; echo/);
  assert.equal(result.costLine.seat, 'builder');
});

test('STUCK: a running seat whose progress file has not changed for five minutes is stopped, and the card is told what it last said', async () => {
  const worktreePath = tempDir();
  const paths = seatDir(worktreePath, 'round-1-builder');
  const h = harness({
    worktreePath,
    script: (read) => {
      if (read === 1) appendFileSync(paths.progress, `${JSON.stringify({ type: 'status', subject: 'thinking', payload: { phase: 'plan' }, created_at: 'T0' })}\n`);
      return ['...'];
    },
  });
  const result = await runSeat({ ...h.options, seat: 'builder', round: 1, launch: standInLaunch, brief: 'b', timeLimitMs: 60 * 60000 });
  assert.equal(result.ok, false);
  assert.equal(result.stuck, true);
  assert.match(result.reason, /stopped as stuck: its progress file had not changed for 5 minutes \(last report: status "thinking" at T0\)/);
  assert.deepEqual(h.closed.map((c) => c.terminal).sort(), ['term_seat'], 'with no pid file there is no stop terminal to close');
  assert.equal(STUCK_AFTER_MS, 5 * 60000);
  assert.equal(PROGRESS_READ_MS, 60000);
});

test('STUCK counts from the start when a seat never reports at all', async () => {
  const worktreePath = tempDir();
  seatDir(worktreePath, 'round-1-reviewer');
  const h = harness({ worktreePath, script: () => ['...'] });
  const result = await runSeat({ ...h.options, seat: 'reviewer', round: 1, launch: standInLaunch, brief: 'b' });
  assert.equal(result.stuck, true);
  assert.match(result.reason, /it never reported at all/);
});

test('a seat that keeps reporting is NOT stuck, however long it takes -- until its time limit', async () => {
  const worktreePath = tempDir();
  const paths = seatDir(worktreePath, 'round-1-builder');
  let n = 0;
  const h = harness({
    worktreePath,
    script: () => { n += 1; appendFileSync(paths.progress, `${JSON.stringify({ type: 'heartbeat', subject: `beat ${n}` })}\n`); return ['...']; },
  });
  const result = await runSeat({ ...h.options, seat: 'builder', round: 1, launch: standInLaunch, brief: 'b', timeLimitMs: 12 * 60000 });
  assert.equal(result.stuck, undefined);
  assert.equal(result.timedOut, true);
  assert.match(result.reason, /ran past its 12-minute limit/);
});

test('a seat run-seat.mjs stopped at its limit is reported as timed out, from the run record', async () => {
  const worktreePath = tempDir();
  const paths = seatDir(worktreePath, 'round-1-builder');
  const h = harness({
    worktreePath,
    script: (read) => {
      if (read === 2) { writeFileSync(paths.run, runRecord({ timedOut: true, exitCode: null })); return [`${WORKER_SCRIPT_END_MARKER}:0`]; }
      return ['...'];
    },
  });
  const result = await runSeat({ ...h.options, seat: 'builder', round: 1, launch: standInLaunch, brief: 'b', timeLimitMs: 30 * 60000 });
  assert.equal(result.timedOut, true);
  assert.match(result.reason, /30-minute limit/);
});

test('a seat that ends without an answer, or with a wrong one, is refused with the reason -- never guessed', async () => {
  const worktreePath = tempDir();
  const paths = seatDir(worktreePath, 'round-1-reviewer');
  const finishWith = (answer) => harness({
    worktreePath,
    script: () => {
      writeFileSync(paths.run, runRecord());
      if (answer === null) rmSync(paths.answer, { force: true }); else writeFileSync(paths.answer, answer);
      return [`${WORKER_SCRIPT_END_MARKER}:0`];
    },
  });
  let h = finishWith(null);
  let result = await runSeat({ ...h.options, seat: 'reviewer', round: 1, launch: standInLaunch, brief: 'b' });
  assert.match(result.reason, /without a usable answer: no answer file was written/);
  h = finishWith('{"verdict":"CHANGES NEEDED"}');
  result = await runSeat({ ...h.options, seat: 'reviewer', round: 1, launch: standInLaunch, brief: 'b' });
  assert.match(result.reason, /answered, but the reviewer's answer has verdict "CHANGES NEEDED"/);
  h = finishWith('not json');
  result = await runSeat({ ...h.options, seat: 'reviewer', round: 1, launch: standInLaunch, brief: 'b' });
  assert.match(result.reason, /answer file is not valid JSON/);
});

test('run-seat.mjs itself failing is reported with its exit status and last lines', async () => {
  const worktreePath = tempDir();
  seatDir(worktreePath, 'round-1-builder');
  const h = harness({ worktreePath, script: () => ['run-seat: missing --brief-b64', `${WORKER_SCRIPT_END_MARKER}:2`] });
  const result = await runSeat({ ...h.options, seat: 'builder', round: 1, launch: standInLaunch, brief: 'b' });
  assert.match(result.reason, /run-seat\.mjs exited 2 -- .*missing --brief-b64/);
});

test('the tag names the round and the seat, so round 2 can never read round 1\'s answer', () => {
  assert.equal(seatTag(2, 'reviewer'), 'round-2-reviewer');
  assert.notEqual(seatFilePaths('/w', seatTag(1, 'builder')).answer, seatFilePaths('/w', seatTag(2, 'builder')).answer);
});

// ---------------------------------------------------------------------------
// PR #102 review fixes, and Todd's cut-off case (23 Sep)
// ---------------------------------------------------------------------------

test('THE STOP kills the agent\'s process group AS THE WORKER, from its pid file, and is confirmed when the group is gone', async () => {
  const worktreePath = tempDir();
  const paths = seatDir(worktreePath, 'round-1-builder');
  writeFileSync(paths.pid, JSON.stringify({ pid: 4242, pgid: 4242 }));
  let killed = false;
  const h = harness({
    worktreePath,
    // After the kill, run-seat.mjs sees its agent exit, writes its record and
    // prints its end marker -- exactly what the real one does.
    script: () => (killed ? (writeFileSync(paths.run, runRecord({ exitCode: null, signal: 'SIGTERM' })), [`${WORKER_SCRIPT_END_MARKER}:0`]) : ['...']),
  });
  h.boundaries.stopAnswer = () => { killed = true; return ['JULIA_STOP:gone', `${WORKER_SCRIPT_END_MARKER}:0`]; };
  const result = await runSeat({ ...h.options, seat: 'builder', round: 1, launch: standInLaunch, brief: 'b' });
  assert.equal(result.stuck, true);
  assert.equal(result.stopConfirmed, true);
  assert.equal(result.stop.gone, true);
  assert.doesNotMatch(result.reason, /NOT confirmed/);
  assert.equal(h.stops.length, 1);
  assert.equal(h.stops[0].title, 'julia-stop-round-1-builder');
  assert.equal(h.stops[0].command, stopGroupCommand(4242));
  assert.deepEqual(h.closed.map((c) => c.terminal).sort(), ['term_seat', 'term_stop'], 'both terminals are closed afterwards');
  assert.ok(result.run, 'the run record written after the kill is read');
});

test('a stop that cannot be confirmed says so and why -- no pid file, or a group that survives -- and closing the terminal alone never counts as a stop', async () => {
  const worktreePath = tempDir();
  const paths = seatDir(worktreePath, 'round-1-builder');
  let h = harness({ worktreePath, script: () => ['...'] });
  let result = await runSeat({ ...h.options, seat: 'builder', round: 1, launch: standInLaunch, brief: 'b' });
  assert.equal(result.stopConfirmed, false);
  assert.match(result.reason, /the stop is NOT confirmed \(the agent's process group is not known \(no pid file was written\); no run record within 60 s\), so the seat may still be running/);

  writeFileSync(paths.pid, JSON.stringify({ pid: 4242, pgid: 4242 }));
  h = harness({ worktreePath, script: () => ['...'] });
  h.boundaries.stopAnswer = ['JULIA_STOP:alive', `${WORKER_SCRIPT_END_MARKER}:0`];
  result = await runSeat({ ...h.options, seat: 'builder', round: 1, launch: standInLaunch, brief: 'b', timeLimitMs: 90000, stuckAfterMs: 60 * 60000 });
  assert.equal(result.timedOut, true);
  assert.match(result.reason, /ran past its 90-second limit/);
  assert.match(result.reason, /NOT confirmed \(process group 4242 is still alive after TERM and KILL/);
});

test('the stop line is refused for anything but a plain process group number', () => {
  assert.match(stopGroupCommand(4242), /^kill -TERM -- -4242 .*kill -KILL -- -4242 .*JULIA_STOP:gone/);
  for (const bad of [0, 1, -5, 1.5, '4242', '4242; rm -rf /', null]) assert.throws(() => stopGroupCommand(bad), /refusing to build a stop/);
});

const cutOffStream = [
  JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }),
  JSON.stringify({ type: 'message_end', message: { role: 'assistant', stopReason: 'length', usage: { input: 125, output: 16384, reasoning: 16384, totalTokens: 39421 }, provider: 'commandcode', model: 'deepseek/deepseek-v4-pro' } }),
].join('\n');

test('a reply CUT OFF at its output limit is reported as exactly that, not as a missing verdict (Todd, 23 Sep)', async () => {
  assert.deepEqual(cutOffOf(cutOffStream), { stopReason: 'length', outputTokens: 16384, reasoningTokens: 16384 });
  assert.equal(cutOffOf(cutOffStream.replace('"length"', '"stop"')), null);
  assert.equal(cutOffOf(''), null);

  const worktreePath = tempDir();
  const paths = seatDir(worktreePath, 'round-1-reviewer');
  const h = harness({
    worktreePath,
    script: () => {
      writeFileSync(paths.run, runRecord());
      writeFileSync(paths.out, cutOffStream);
      return [`${WORKER_SCRIPT_END_MARKER}:0`];
    },
  });
  const result = await runSeat({ ...h.options, seat: 'reviewer', round: 1, launch: standInLaunch, brief: 'b' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.cutOff, { stopReason: 'length', outputTokens: 16384, reasoningTokens: 16384 });
  assert.match(result.reason, /reply was CUT OFF at its output limit \(stop reason "length", 16384 output tokens, 16384 of them thinking\) before it wrote its answer/);
  assert.doesNotMatch(result.reason, /without a usable answer/);
});

test('an effort label that is not low, medium or high is refused in words, never passed on to throw mid-carry', () => {
  const refused = launchFor('reviewer', { ...DEEPSEEK, effort: "high'x" });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /effort "high'x" is not one of low, medium, high/);
});
