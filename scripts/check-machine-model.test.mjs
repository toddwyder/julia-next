import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { CHECKS, checker, run, verdict } from './check-machine-model.mjs';

// java is the one thing the checks cannot work without, so a machine that has no
// JDK skips them instead of failing them.
const java = spawnSync('java', ['-version'], { stdio: 'ignore' });
const noJava = java.error?.code === 'ENOENT' ? 'java is missing. Install a JDK (openjdk-21-jre-headless).' : false;

// One TLC pass per configuration, shared by the tests below.
let outcomes = null;

function checked() {
  outcomes ??= (async () => {
    const jar = await checker();
    const all = [];
    for (const check of CHECKS) {
      const result = await run(jar, check.config);
      all.push({ ...check, ...result, problem: verdict(result, check.expect) });
    }
    return all;
  })();
  return outcomes;
}

test('the shipped configuration passes and each broken one fails the invariant it guards', { skip: noJava }, async () => {
  const all = await checked();
  assert.deepEqual(all.map(result => result.config), ['shipped.cfg', 'ping-on-every-pass.cfg', 'mark-finished-runs.cfg']);
  assert.deepEqual(all.map(result => result.expect), ['pass', 'PingOnce', 'NoStallOnFinish']);
  assert.deepEqual(all.map(result => result.problem), [null, null, null]);
  assert.deepEqual(all.map(result => result.code), [0, 12, 12]);
});

test('the pass that ignores pingedAt is caught by TLC naming PingOnce', { skip: noJava }, async () => {
  const all = await checked();
  const broken = all.find(result => result.config === 'ping-on-every-pass.cfg');
  assert.equal(broken.code, 12);
  assert.match(broken.output, /Invariant PingOnce is violated/);
  assert.doesNotMatch(broken.output, /NoStallOnFinish is violated/);
});

test('the pass that ignores the stored status is caught by TLC naming NoStallOnFinish', { skip: noJava }, async () => {
  const all = await checked();
  const broken = all.find(result => result.config === 'mark-finished-runs.cfg');
  assert.equal(broken.code, 12);
  assert.match(broken.output, /Invariant NoStallOnFinish is violated/);
});
