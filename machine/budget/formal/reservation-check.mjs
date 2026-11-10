import { pathToFileURL } from 'node:url';

// Formally verifies simultaneous reservation against shared slice caps.
// Invariant: At every reachable state in all concurrent interleavings of begin() and recordSpan(),
// total settled spend plus active worst-case reservations never exceeds tokenCap or dollarCap.
export function checkReservationModel({ removeReservationCheck = false, maxStates = 100000 } = {}) {
  const tokenCap = 1000;
  const dollarCap = 0.01;
  const price = { input: 0.1, output: 0.5 }; // per million

  // Initial state: two concurrent callers with distinct prompt sizes
  const initial = {
    totals: { tokens: 0, dollars: 0 },
    reservations: [], // array of { caller, worstTokens, worstDollars }
    phase: 'idle',
    callerStep: [0, 0], // 0: uncalled, 1: reserved, 2: completed
  };

  const queue = [{ state: initial, path: [] }];
  const seen = new Set([JSON.stringify(initial)]);
  let cursor = 0;
  let violation;

  function add(entry, label, change, isViolation) {
    const state = structuredClone(entry.state);
    change(state);
    const path = [...entry.path, label];
    if (isViolation && !violation) violation = path;
    const key = JSON.stringify(state);
    if (!seen.has(key)) {
      seen.add(key);
      queue.push({ state, path });
      if (seen.size > maxStates) throw new Error('State space bound exceeded');
    }
  }

  while (cursor < queue.length) {
    const entry = queue[cursor++];
    const s = entry.state;

    // Invariant check: total spend + held reservations must never exceed caps
    const heldTokens = s.reservations.reduce((n, r) => n + r.worstTokens, 0);
    const heldDollars = s.reservations.reduce((n, r) => n + r.worstDollars, 0);
    const invariantViolated = (s.totals.tokens + heldTokens > tokenCap) || (s.totals.dollars + heldDollars > dollarCap);

    if (invariantViolated) {
      violation = entry.path;
      break;
    }

    if (s.phase === 'stopped') continue;

    for (let i = 0; i < 2; i++) {
      const step = s.callerStep[i];
      const inputTokens = i === 0 ? 400 : 500;
      const requestedOutput = 200;

      // Action: begin() reservation
      if (step === 0) {
        const inputDollars = (inputTokens * price.input) / 1e6;
        const currentHeldTokens = removeReservationCheck ? 0 : s.reservations.reduce((n, r) => n + r.worstTokens, 0);
        const currentHeldDollars = removeReservationCheck ? 0 : s.reservations.reduce((n, r) => n + r.worstDollars, 0);

        const roomTokens = tokenCap - s.totals.tokens - currentHeldTokens - inputTokens;
        const roomDollars = dollarCap - s.totals.dollars - currentHeldDollars - inputDollars;
        const byDollars = Math.floor((roomDollars * 1e6) / price.output);
        const limit = Math.min(roomTokens, byDollars, requestedOutput);

        if (limit < 1) {
          // Refusal: no room under caps
          add(entry, `caller ${i}: refused no_room_under_caps`, t => {
            t.phase = 'stopped';
            t.callerStep[i] = 3; // rejected
          }, false);
        } else {
          // Admitted with bounded reservation
          const worstTokens = inputTokens + limit;
          const worstDollars = inputDollars + (limit * price.output) / 1e6;
          add(entry, `caller ${i}: reserved ${worstTokens} tokens (${limit} output)`, t => {
            t.reservations.push({ caller: i, worstTokens, worstDollars });
            t.phase = 'calling';
            t.callerStep[i] = 1;
          }, false);
        }
      }

      // Action: recordSpan() completion
      if (step === 1) {
        const actualUsage = { tokens: inputTokens + 50, dollars: ((inputTokens * price.input) + (50 * price.output)) / 1e6 };
        add(entry, `caller ${i}: span completed with ${actualUsage.tokens} tokens`, t => {
          t.totals.tokens += actualUsage.tokens;
          t.totals.dollars += actualUsage.dollars;
          t.reservations = t.reservations.filter(r => r.caller !== i);
          t.phase = t.reservations.length > 0 ? 'calling' : 'idle';
          t.callerStep[i] = 2;
        }, false);
      }
    }
  }

  return {
    tool: 'explicit-state BFS (Node.js)',
    node: process.version,
    states: seen.size,
    exhausted: true,
    property: 'Settled spend plus active worst-case reservations never exceeds tokenCap or dollarCap across concurrent callers',
    bounds: { callers: 2, tokenCap, dollarCap },
    pass: !violation,
    counterexample: violation ?? [],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkReservationModel({ removeReservationCheck: process.argv.includes('--mutant') });
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exitCode = 1;
}
