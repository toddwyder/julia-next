// controller-seat-run.test.mjs -- JUL-98 step 8: the controller side of the
// single-command route (graph/controller/seat-run.mjs). A fake Orca terminal,
// a fake clock and a real temp folder stand in for the worker; the real route
// is proven on the server by scripts/controller-stand-in.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, appendFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  launchFor, buildStepBrief, reportingInstructions, seatCommand, parseProgress, validateAnswer, costLineFor,
  runSeat, seatFilePaths, seatTag, MAX_BRIEF_B64, STUCK_AFTER_MS, PROGRESS_READ_MS, SEAT_ROUTES, cutOffOf, stopSeatCommand, newSeatToken,
} from '../graph/controller/seat-run.mjs';
import { WORKER_SCRIPT_END_MARKER } from '../graph/controller/wiring.mjs';
import { formatCostLine } from '../graph/controller/cost.mjs';
import { ORCA_FIXTURE_DIR } from '../graph/controller/fixture-orca.mjs';
import { parseArgs as parseRunSeatArgs } from './run-seat.mjs';
import { spawn, execFileSync } from 'node:child_process';

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

test('the historical brief carries the card, step and a prior finding only when there is one', () => {
  const card = { identifier: 'JUL-92', title: 'Docs match', url: 'https://linear.app/x' };
  const first = buildStepBrief({ seat: 'builder', card, step: { title: 'Docs match', brief: 'Fix the docs.' } });
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
  assert.match(text, /for five minutes this file does not change and you show no other sign of work, you are treated as stuck/);
  assert.match(text, /Your times are not trusted/);
  assert.match(text, /20 minutes/);
  assert.match(text, /"verdict":"changes_needed"/);
  assert.match(reportingInstructions({ seat: 'builder', tag: 'round-1-builder', timeLimitMs: 60000 }), /"outcome":"done"/);
  // The acceptance check (Todd, 23 Sep): each criterion by name, both seats.
  assert.match(text, /Check every acceptance criterion listed above yourself, by id and by its exact words/);
  assert.match(text, /"criteria":\[\{"id":"AC1","criterion":"<its exact words>","verdict":"met"/);
  const builderText = reportingInstructions({ seat: 'builder', tag: 'round-1-builder', timeLimitMs: 60000 });
  assert.match(builderText, /"acceptance":\[\{"id":"AC1"/);
  assert.match(builderText, /"uat":\[\{"id":"UAT1"/);
  assert.match(builderText, /Every acceptance criterion and every UAT-plan item listed above, by id, gets an entry/);
});

test('the command carries the brief as base64 that run-seat.mjs decodes back EXACTLY, ends with the marker, and refuses a quote in a path', () => {
  const brief = `# JUL-92\nIt's "quoted" and $HOME and \`ticks\`\n`;
  const command = seatCommand({
    worktreePath: '/home/runner/orca/workspaces/julia-next/jul-92-work-a1', seat: 'builder',
    launch: { agent: 'agy', model: 'gemini-3.8-flash', effort: 'medium' }, tag: 'round-1-builder', timeLimitMs: 30 * 60000, brief, token: '0123456789abcdef0123456789abcdef',
  });
  assert.ok(command.endsWith(`; echo "${WORKER_SCRIPT_END_MARKER}:$?"`));
  // Round-trip through run-seat.mjs's own parser, with the shell quoting undone.
  const argv = command.split('; echo')[0].split(' ').slice(2).map((part) => part.replace(/^'|'$/g, ''));
  const parsed = parseRunSeatArgs(argv);
  assert.equal(parsed.brief, brief);
  assert.equal(parsed.timeoutSeconds, 1800);
  assert.equal(parsed.tag, 'round-1-builder');
  assert.equal(parsed.seatToken, '0123456789abcdef0123456789abcdef');
  assert.throws(() => seatCommand({ worktreePath: "/tmp/it's", seat: 'builder', launch: { agent: 'agy', model: 'm', effort: 'low' }, tag: 'round-1-builder', timeLimitMs: 1000, brief: 'b', token: '0123456789abcdef0123456789abcdef' }), /quote/);
});

test('a brief too big to carry safely in a command is refused, not sent cut', () => {
  const huge = 'x'.repeat(Math.ceil(MAX_BRIEF_B64 * 0.8));
  assert.throws(() => seatCommand({ worktreePath: '/w', seat: 'builder', launch: { agent: 'agy', model: 'm', effort: 'low' }, tag: 'round-1-builder', timeLimitMs: 1000, brief: huge, token: '0123456789abcdef0123456789abcdef' }), /over the 36000/);
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
      seatTokenImpl: () => '0123456789abcdef0123456789abcdef',
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

test('STUCK: a running seat that shows no sign of work for five minutes is stopped, and the card is told what it last said -- with the FILE\'s change time, never the time the worker wrote', async () => {
  const worktreePath = tempDir();
  const paths = seatDir(worktreePath, 'round-1-builder');
  const h = harness({
    worktreePath,
    script: (read) => {
      if (read === 1) {
        // JUL-92, 23 Sep: the reviewer stamped this line 06:04Z; the file
        // really changed at 06:55:34Z.
        appendFileSync(paths.progress, `${JSON.stringify({ type: 'status', subject: 'thinking', payload: { phase: 'plan' }, created_at: '2026-09-23T06:04:00Z' })}\n`);
        const real = new Date('2026-09-23T06:55:34Z');
        utimesSync(paths.progress, real, real);
        // run-seat.mjs creates the output file empty before the agent writes.
        writeFileSync(paths.out, '');
      }
      return ['...'];
    },
  });
  const result = await runSeat({ ...h.options, seat: 'builder', round: 1, launch: standInLaunch, brief: 'b', timeLimitMs: 60 * 60000 });
  assert.equal(result.ok, false);
  assert.equal(result.stuck, true);
  assert.match(result.reason, /stopped as stuck: it showed no sign of work for 5 minutes -- its progress file last changed at 2026-09-23T06:55:34Z, its output last changed never, its CPU or Pi session log last changed never \(last report: status "thinking"\)/);
  assert.doesNotMatch(result.reason, /06:04/, 'the time the worker wrote is not reported');
  assert.equal(h.stops.length, 1, 'the stop was run');
  assert.deepEqual(h.closed.map((c) => c.terminal).sort(), ['term_seat', 'term_stop']);
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

// JUL-92, 23 Sep 07:01Z: a DeepSeek reviewer 30 tool calls into a review wrote
// no progress line for 5 minutes and was stopped as stuck. Busy but silent is
// not stuck.
test('BUSY BUT SILENT: a seat whose progress file is quiet but whose CPU or Pi session log keeps moving (the activity file) is NOT stuck, and finishes', async () => {
  const worktreePath = tempDir();
  const paths = seatDir(worktreePath, 'round-1-reviewer');
  const h = harness({
    worktreePath,
    script: (read, { clock }) => {
      if (read === 1) appendFileSync(paths.progress, `${JSON.stringify({ type: 'status', subject: 'reviewing' })}\n`);
      // run-seat.mjs rewrites the activity file only when the seat did something.
      if (read % 12 === 0) writeFileSync(paths.activity, `${JSON.stringify({ at: clock(), moved: ['cpu +3.1s', 'Pi session log 40000 bytes'] })}\n`);
      if (clock() >= 15 * 60000) {
        writeFileSync(paths.answer, JSON.stringify({ verdict: 'approve', summary: 'checked' }));
        writeFileSync(paths.run, runRecord());
        return [`${WORKER_SCRIPT_END_MARKER}:0`];
      }
      return ['...'];
    },
  });
  const result = await runSeat({ ...h.options, seat: 'reviewer', round: 1, launch: standInLaunch, brief: 'b', timeLimitMs: 20 * 60000 });
  assert.equal(result.stuck, undefined, result.reason);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.progress.entries.length, 1, 'one progress line in 15 minutes, and still not stuck');
  assert.equal(h.stops.length, 0, 'nothing was stopped');
});

test('BUSY BUT SILENT: a seat whose own output keeps growing is NOT stuck either', async () => {
  const worktreePath = tempDir();
  const paths = seatDir(worktreePath, 'round-1-reviewer');
  const h = harness({
    worktreePath,
    script: (read, { clock }) => {
      if (read % 12 === 0) appendFileSync(paths.out, `${JSON.stringify({ type: 'message_update' })}\n`);
      if (clock() >= 12 * 60000) {
        writeFileSync(paths.answer, JSON.stringify({ verdict: 'approve', summary: 'checked' }));
        writeFileSync(paths.run, runRecord());
        return [`${WORKER_SCRIPT_END_MARKER}:0`];
      }
      return ['...'];
    },
  });
  const result = await runSeat({ ...h.options, seat: 'reviewer', round: 1, launch: standInLaunch, brief: 'b', timeLimitMs: 20 * 60000 });
  assert.equal(result.ok, true, result.reason);
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

test('THE STOP finds the seat\'s processes by its token, AS THE WORKER, and is confirmed only when none are left', async () => {
  const worktreePath = tempDir();
  const paths = seatDir(worktreePath, 'round-1-builder');
  let killed = false;
  const h = harness({
    worktreePath,
    script: () => (killed ? (writeFileSync(paths.run, runRecord({ exitCode: null, signal: 'SIGTERM' })), [`${WORKER_SCRIPT_END_MARKER}:0`]) : ['...']),
  });
  h.boundaries.stopAnswer = () => { killed = true; return ['JULIA_STOP:gone', `${WORKER_SCRIPT_END_MARKER}:0`]; };
  const result = await runSeat({ ...h.options, seat: 'builder', round: 1, launch: standInLaunch, brief: 'b' });
  assert.equal(result.stuck, true);
  assert.equal(result.stopConfirmed, true);
  assert.doesNotMatch(result.reason, /NOT confirmed/);
  assert.equal(h.stops[0].title, 'julia-stop-round-1-builder');
  assert.equal(h.stops[0].command, stopSeatCommand('0123456789abcdef0123456789abcdef'));
  assert.match(h.created[0].command, /--seat-token 0123456789abcdef0123456789abcdef /, 'the seat was started with the same token the stop looks for');
  assert.deepEqual(h.closed.map((c) => c.terminal).sort(), ['term_seat', 'term_stop']);
  assert.ok(result.run, 'the run record written after the kill is read');
});

test('a stop is NOT confirmed by a run record alone -- only by no token-carrying process being left -- and the card says why', async () => {
  const worktreePath = tempDir();
  const paths = seatDir(worktreePath, 'round-1-builder');
  // The record appears (run-seat.mjs's direct child exited) but a process
  // carrying the token is still alive: that is NOT a confirmed stop.
  let h = harness({ worktreePath, script: () => ['...'] });
  h.boundaries.stopAnswer = () => { writeFileSync(paths.run, runRecord()); return ['JULIA_STOP:alive 777 778', `${WORKER_SCRIPT_END_MARKER}:0`]; };
  let result = await runSeat({ ...h.options, seat: 'builder', round: 1, launch: standInLaunch, brief: 'b', timeLimitMs: 90000, stuckAfterMs: 60 * 60000 });
  assert.equal(result.timedOut, true);
  assert.equal(result.stopConfirmed, false);
  assert.match(result.reason, /ran past its 90-second limit/);
  assert.match(result.reason, /NOT confirmed \(processes still carrying the seat token after TERM and KILL: 777 778\)/);

  rmSync(paths.run, { force: true });
  h = harness({ worktreePath, script: () => ['...'] });
  h.boundaries.stopAnswer = [];
  result = await runSeat({ ...h.options, seat: 'builder', round: 1, launch: standInLaunch, brief: 'b' });
  assert.match(result.reason, /NOT confirmed \(the stop did not finish within 60 s\)/);
});

test('the stop line is refused for anything but a 32-hex seat token, and every seat run gets a fresh one', () => {
  assert.match(stopSeatCommand('0123456789abcdef0123456789abcdef'), /grep -qx "JULIA_SEAT_TOKEN=0123456789abcdef0123456789abcdef"/);
  for (const bad of ['', 'x'.repeat(32), '0123456789ABCDEF0123456789ABCDEF', '0123456789abcdef0123456789abcdef; rm -rf /', null, 42]) assert.throws(() => stopSeatCommand(bad), /refusing to build a stop/);
  const a = newSeatToken();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, newSeatToken());
});

// THE REAL THING, on Linux (the server suite and CI): a process carrying the
// token dies; one that does not is left alone. Skipped on Windows only.
test('the stop line really kills the token-carrying process and leaves every other one alone', { skip: process.platform === 'win32' ? 'the stop line reads /proc, Linux only' : false }, async () => {
  const token = newSeatToken();
  const other = newSeatToken();
  const keep = ['-e', 'setInterval(() => {}, 1000)'];
  const target = spawn(process.execPath, keep, { env: { ...process.env, JULIA_SEAT_TOKEN: token }, stdio: 'ignore', detached: true });
  const bystander = spawn(process.execPath, keep, { env: { ...process.env, JULIA_SEAT_TOKEN: other }, stdio: 'ignore', detached: true });
  const untokened = spawn(process.execPath, keep, { stdio: 'ignore', detached: true });
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    await new Promise((r) => { setTimeout(r, 300); });
    const out = execFileSync('bash', ['-c', stopSeatCommand(token, { graceSeconds: 1 })], { encoding: 'utf8' });
    assert.match(out, /^JULIA_STOP:gone$/m);
    assert.match(out, new RegExp(`^${WORKER_SCRIPT_END_MARKER}:0$`, 'm'));
    await new Promise((r) => { setTimeout(r, 200); });
    assert.equal(alive(target.pid), false, 'the token-carrying process is gone');
    assert.equal(alive(bystander.pid), true, 'another seat\'s process is untouched');
    assert.equal(alive(untokened.pid), true, 'a process with no token is untouched');
  } finally {
    for (const child of [target, bystander, untokened]) { try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ } }
  }
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
