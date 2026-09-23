// stand-in-seat.mjs -- JUL-98 step 8: the FREE stand-in for a seat.
//
// No model, no tokens, no spend. scripts/run-seat.mjs starts it exactly where it
// would start `agy` or `pi`, so every route around the seat is the real one:
// the Orca terminal, the brief carried in the command, the working copy, the
// progress file, the answer file, the controller's own file reads, the test
// run, the git checks and the working-copy removal. Only the thinking is fake.
//
// It is never chosen from a card. Only scripts/controller-stand-in.mjs asks
// for it, and graph/controller/seat-run.mjs refuses it for anything else.
//
// THE SCENARIO is one line of its brief -- `Stand-in scenario: <name>` -- so
// it arrives by the same route a real brief does:
//   pass               builder commits, reviewer approves
//   changes-then-pass  round 1's reviewer asks for changes; round 2's builder
//                      must find that finding in its brief; round 2 approves
//   timeout            the builder keeps sending heartbeats and never finishes,
//                      so its time limit stops it
//   stuck              the builder reports once, then goes silent, so the
//                      controller's five-minute progress rule stops it

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { seatFiles } from './run-seat.mjs';

export const SCENARIOS = Object.freeze(['pass', 'changes-then-pass', 'timeout', 'stuck']);
export const STAND_IN_FINDING = 'Stand-in finding: round 2 must add stand-in/round-2-fix.txt';

export function scenarioOf(brief) {
  const match = /^Stand-in scenario: ([a-z-]+)\s*$/m.exec(brief);
  if (!match || !SCENARIOS.includes(match[1])) {
    throw new Error(`stand-in-seat: the brief names no known stand-in scenario (${SCENARIOS.join(', ')})`);
  }
  return match[1];
}

// One progress line, in the old mailbox message shape.
export function progressLine({ type, subject, body = '', phase, at = new Date().toISOString() }) {
  return `${JSON.stringify({ type, subject, body, payload: { phase }, created_at: at })}\n`;
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

function git(worktree, args) {
  return execFileSync('git', ['-C', worktree, '-c', 'user.name=Julia stand-in', '-c', 'user.email=stand-in@julia.invalid', ...args], { encoding: 'utf8' }).trim();
}

export async function standIn({ seat, tag, worktree }, { heartbeatMs = 5000 } = {}) {
  const files = seatFiles(worktree, tag);
  const brief = readFileSync(files.brief, 'utf8');
  const scenario = scenarioOf(brief);
  const round = Number(/^round-(\d)/.exec(tag)[1]);
  const say = (type, subject, phase, body) => appendFileSync(files.progress, progressLine({ type, subject, body, phase }));
  const answer = (value) => writeFileSync(files.answer, `${JSON.stringify(value, null, 2)}\n`);

  say('status', `${seat} started (stand-in, ${scenario})`, 'reading the brief');

  if (seat === 'builder') {
    if (scenario === 'timeout') {
      // Alive and reporting, never finishing: only the time limit stops this.
      for (;;) {
        say('heartbeat', 'still working', 'working');
        await sleep(heartbeatMs);
      }
    }
    if (scenario === 'stuck') {
      // One report, then silence: only the progress rule stops this.
      for (;;) await sleep(60000);
    }
    if (scenario === 'changes-then-pass' && round === 2 && !brief.includes(STAND_IN_FINDING)) {
      answer({ outcome: 'blocked', summary: 'round 2 was not given the round-1 finding to fix' });
      return;
    }
    say('status', 'building', 'committing the change');
    const file = round === 2 ? 'stand-in/round-2-fix.txt' : 'stand-in/round-1.txt';
    mkdirSync(resolve(worktree, 'stand-in'), { recursive: true });
    writeFileSync(resolve(worktree, file), `stand-in ${scenario}, ${tag}\n`);
    git(worktree, ['add', file]);
    git(worktree, ['commit', '-q', '-m', `stand-in: ${scenario} ${tag}`]);
    say('status', 'done', 'handing back');
    answer({ outcome: 'done', summary: `committed ${file} (${git(worktree, ['rev-parse', 'HEAD'])})` });
    return;
  }

  say('status', 'reviewing', 'reading the change');
  if (scenario === 'changes-then-pass' && round === 1) {
    answer({ verdict: 'changes_needed', findings: STAND_IN_FINDING });
    return;
  }
  answer({ verdict: 'approve', summary: `stand-in approve (${scenario}, ${tag})` });
}

function parse(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) opts[argv[i].replace(/^--/, '')] = argv[i + 1];
  return opts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  standIn(parse(process.argv.slice(2))).catch((error) => {
    console.error(`stand-in-seat: ${error.message}`);
    process.exitCode = 1;
  });
}
