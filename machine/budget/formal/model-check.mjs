import { pathToFileURL } from 'node:url';

// Each transition is one filesystem check/write, not one whole controller method.
// Scope: two admissions, one external stop, one attributed clear, one crash/retry.
export function checkModel({ removeStopChecks = false, maxStates = 250000 } = {}) {
  const initial = { pc: [0, 0], local: ['idle', 'idle'], lock: -1, dead: [false, false],
    latch: false, latchLock: -1, clearLock: false, phase: 'idle', stopPc: 0, clearPc: 0, retryUsed: false };
  const queue = [{ state: initial, path: [] }];
  const seen = new Set([JSON.stringify(initial)]);
  let cursor = 0;
  let violation;
  function add(entry, label, change, bad = false) {
    const state = structuredClone(entry.state);
    change(state);
    const path = [...entry.path, label];
    if (bad && !violation) violation = path;
    const key = JSON.stringify(state);
    if (!seen.has(key)) {
      seen.add(key); queue.push({ state, path });
      if (seen.size > maxStates) throw new Error('Model state bound exceeded; no proof produced');
    }
  }
  while (cursor < queue.length) {
    const entry = queue[cursor++];
    const s = entry.state;
    for (let i = 0; i < 2; i++) {
      const next = (label, change, bad) => add(entry, `process ${i}: ${label}`, change, bad);
      const advance = t => { t.pc[i]++; };
      if (!s.dead[i]) {
        switch (s.pc[i]) {
          case 0: next('check clear.lock (assertStart:93)', t => { t.pc[i] = s.clearLock ? 10 : 1; }); break;
          case 1: next('check stop.lock (assertStart:94)', t => { t.pc[i] = s.latch && !removeStopChecks ? 10 : 2; }); break;
          case 2: next('check local stopped phase (:95)', t => { t.pc[i] = s.local[i] === 'stopped' && !removeStopChecks ? 10 : 3; }); break;
          case 3:
            next('exclusive active.lock create (:98)', t => {
              if (s.lock === -1) { t.lock = i; t.pc[i] = 4; }
              else if (s.dead[s.lock]) { t.pc[i] = 10; t.stopPc = Math.max(1, s.stopPc); }
              else t.pc[i] = 10;
            }); break;
          case 4: next('recheck clear.lock (:113)', t => { if (s.clearLock) { t.lock = -1; t.pc[i] = 10; } else advance(t); }); break;
          case 5: next('recheck stop.lock (:114)', t => { if (s.latch && !removeStopChecks) { t.lock = -1; t.pc[i] = 10; } else advance(t); }); break;
          case 6: next('reload record (:115)', t => { t.local[i] = s.phase; advance(t); }); break;
          case 7: next('acquire latch.lock (:120)', t => { if (s.latchLock === -1) { t.latchLock = i; advance(t); } }); break;
          case 8:
            if ((s.latch || s.phase === 'stopped') && !removeStopChecks) {
              next('refuse admission on active stop latch (:121)', t => { t.latchLock = -1; t.lock = -1; t.pc[i] = 11; });
            } else {
              next('persist slice_start (:121-125)', t => { t.phase = 'idle'; t.local[i] = 'idle'; t.latchLock = -1; t.pc[i] = 9; }, s.latch);
            }
            break;
          case 9: next('finish and release (:174)', t => { t.phase = 'finished'; if (t.lock === i) t.lock = -1; t.pc[i] = 10; }); break;
          default: break;
        }
        if (s.pc[i] >= 3 && s.pc[i] <= 9) next('crash (durable files remain)', t => { t.dead[i] = true; if (t.latchLock === i) t.latchLock = -1; t.pc[i] = 12; });
      }
      if (s.pc[i] === 11 && !s.retryUsed) next('retry assertStart (same guard)', t => { t.pc[i] = 0; t.retryUsed = true; });
    }
    if (s.stopPc === 0) add(entry, 'stop: prepare reason (:75-78)', t => { t.stopPc = 1; });
    if (s.stopPc === 1) add(entry, 'stop: acquire latch.lock (:80)', t => { if (s.latchLock === -1) { t.latchLock = 99; t.stopPc = 2; } });
    if (s.stopPc === 2) add(entry, 'stop: atomically publish stop.lock (:82)', t => { t.latch = true; t.stopPc = 3; });
    if (s.stopPc === 3) add(entry, 'stop: persist stopped record (:83)', t => { t.phase = 'stopped'; t.latchLock = -1; t.stopPc = 4; });
    // Clear is attributed and permitted only with no live active owner. Separate writes
    // match the actual clear lock, record reset, active unlink, and latch unlink.
    if (s.clearPc === 0 && s.latch) add(entry, 'clear: exclusive clear.lock (:179)', t => { t.clearLock = true; t.clearPc = 1; });
    if (s.clearPc === 1) add(entry, 'clear: validate owner and reset durable record (:182-194)', t => {
      if (s.lock !== -1 && !s.dead[s.lock] && s.phase !== 'stopped') { t.clearLock = false; t.clearPc = 5; }
      else { t.phase = 'idle'; t.clearPc = 2; }
    });
    if (s.clearPc === 2) add(entry, 'clear: unlink active.lock (:195)', t => { t.lock = -1; t.clearPc = 3; });
    if (s.clearPc === 3) add(entry, 'clear: unlink stop.lock (:197)', t => { t.latch = false; t.clearPc = 4; });
    if (s.clearPc === 4) add(entry, 'clear: unlink clear.lock (:201)', t => { t.clearLock = false; t.clearPc = 5; });
  }
  return { tool: 'explicit-state BFS (Node.js)', node: process.version, states: seen.size,
    exhausted: true, property: 'No persisted slice_start while stop.lock exists until attributed clear removes it',
    bounds: { processes: 2, stops: 1, clears: 1, retries: 1, crashesPerProcess: 1 },
    pass: !violation, counterexample: violation ?? [] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkModel({ removeStopChecks: process.argv.includes('--mutant') });
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exitCode = 1;
}
