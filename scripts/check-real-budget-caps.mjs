import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createSliceControl } from '../machine/budget/control.mjs';
import { agentModel } from '../machine/flow/role-models.mjs';

const scratch = join(homedir(), '.local/state/julia-scratch');
const modelId = 'openai/gpt-6-luna';

async function testSingleCallTinyLimit() {
  const dir = mkdtempSync(join(scratch, 'real-cap-single-'));
  try {
    // A prompt of "Say hello in one word." wrapped by system instructions is ~219 tokens.
    // Under a tiny limit of 100 tokens, the estimate of input tokens alone exceeds 100.
    // Fixed code: estimateInputTokens estimates >= 200 tokens -> immediately stops with no_room_under_caps before any provider call.
    // Broken code (09d5c4dc / bb433874): options.inputTokens was undefined -> counted as 0 -> admitted to provider and leaked past cap!
    const control = createSliceControl({ directory: dir, dollarCap: 4, tokenCap: 100 });
    control.assertStart();
    const raw = agentModel(modelId);
    const wrapped = control.wrapModel(raw, { id: modelId, role: 'observer' });

    let error;
    try {
      const res = await wrapped.doStream({
        inputFormat: 'messages',
        mode: { type: 'regular' },
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say hello in one word.' }] }]
      });
      for await (const chunk of res.stream) {}
    } catch (err) {
      error = err;
    }

    const snapshot = control.snapshot();
    assert.equal(snapshot.phase, 'stopped', `Expected phase stopped, got ${snapshot.phase}`);
    assert.equal(snapshot.stop?.reason, 'no_room_under_caps', `Expected stop reason no_room_under_caps, got ${snapshot.stop?.reason}`);
    assert.equal(snapshot.calls.length, 0, `Expected 0 completed calls under tiny cap, got ${snapshot.calls.length}`);
    console.log('PASS: single call under tiny limit stopped at cap (reason: no_room_under_caps, calls: 0)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function testConcurrentCallsWithinLimit() {
  const dir = mkdtempSync(join(scratch, 'real-cap-concurrent-'));
  try {
    // Under a limit of 2,000,000 tokens, several calls running at once reserve their worst case and finish within the same limit.
    const tokenCap = 2000000;
    const dollarCap = 4;
    const control = createSliceControl({ directory: dir, dollarCap, tokenCap });
    control.assertStart();
    const raw = agentModel(modelId);
    const wrapped = control.wrapModel(raw, { id: modelId, role: 'observer' });

    const call = async text => {
      const res = await wrapped.doStream({
        inputFormat: 'messages',
        mode: { type: 'regular' },
        maxOutputTokens: 25,
        prompt: [{ role: 'user', content: [{ type: 'text', text }] }]
      });
      let out = '';
      for await (const chunk of res.stream) {
        if (chunk.type === 'text-delta') out += chunk.delta;
      }
      return out;
    };

    const results = await Promise.all([
      call('Say apple in one word.'),
      call('Say banana in one word.')
    ]);

    assert.equal(results.length, 2, 'Expected 2 concurrent call results');
    assert.ok(results[0].length > 0, 'Call 1 returned non-empty output');
    assert.ok(results[1].length > 0, 'Call 2 returned non-empty output');

    const snapshot = control.snapshot();
    // Verify reservations were tracked concurrently
    const reservations = snapshot.reservations ?? [];
    assert.equal(reservations.length, 2, `Expected 2 active reservations in snapshot, got ${reservations.length}`);
    const reservedTokens = reservations.reduce((n, r) => n + r.worstTokens, 0);
    const reservedDollars = reservations.reduce((n, r) => n + r.worstDollars, 0);
    assert.ok(reservedTokens <= tokenCap, `Reserved tokens ${reservedTokens} exceeded token cap ${tokenCap}`);
    assert.ok(reservedDollars <= dollarCap, `Reserved dollars ${reservedDollars} exceeded dollar cap ${dollarCap}`);

    // Settle each reservation with real simulated spans matching the calls
    for (const resv of reservations) {
      control.recordSpan({
        type: 'model_inference',
        id: 'span-' + resv.id,
        traceId: 'trace-1',
        endTime: new Date(),
        attributes: {
          model: resv.modelId,
          provider: resv.provider,
          usage: { inputTokens: resv.inputTokens, outputTokens: 5 }
        }
      });
    }

    const finalSnapshot = control.snapshot();
    assert.equal(finalSnapshot.calls.length, 2, `Expected 2 completed calls in record, got ${finalSnapshot.calls.length}`);
    assert.ok(finalSnapshot.totals.tokens <= tokenCap, `Total tokens ${finalSnapshot.totals.tokens} exceeded cap ${tokenCap}`);
    assert.ok(finalSnapshot.totals.dollars <= dollarCap, `Total dollars ${finalSnapshot.totals.dollars} exceeded cap ${dollarCap}`);
    assert.equal(finalSnapshot.reservations.length, 0, 'Expected 0 remaining reservations after settlement');
    assert.equal(finalSnapshot.phase, 'idle', 'Expected phase idle after all reservations settled');
    console.log(`PASS: several calls running at once finished within limit (${finalSnapshot.calls.length} calls, ${finalSnapshot.totals.tokens} tokens <= ${tokenCap}, ${finalSnapshot.totals.dollars} dollars <= ${dollarCap})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('--- Running real model cap reproduction ---');
await testSingleCallTinyLimit();
await testConcurrentCallsWithinLimit();
console.log('--- All real cap checks passed ---');
