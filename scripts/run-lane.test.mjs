// The lane runner's lock is the whole point: two lane runners must never boot
// two candidate Studios, and the second one has to say so instead of waiting.
// The cap check starts no Studio and runs no card, so it is safe anywhere the
// user systemd is available.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUNNER = new URL('./run-lane.mjs', import.meta.url).pathname;

function run(args) {
  return spawnSync(process.execPath, [RUNNER, ...args], { encoding: 'utf8', timeout: 60000 });
}

function tempDir(t, name) {
  const dir = mkdtempSync(join(tmpdir(), `run-lane-${name}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function waitForLine(child, pattern, timeoutMs = 30000) {
  return new Promise((resolvePromise, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`no ${pattern} within ${timeoutMs} ms; saw: ${output.slice(-500)}`)), timeoutMs);
    const read = chunk => {
      output += chunk;
      if (pattern.test(output)) {
        clearTimeout(timer);
        resolvePromise(output);
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('exit', code => {
      clearTimeout(timer);
      reject(new Error(`runner exited ${code} before ${pattern}; saw: ${output.slice(-500)}`));
    });
  });
}

function exitOf(child) {
  return new Promise(resolvePromise => child.on('exit', (code, signal) => resolvePromise({ code, signal })));
}

test('a second lane runner refuses while the first holds the live lock', async t => {
  const firstLane = tempDir(t, 'first');
  const secondLane = tempDir(t, 'second');
  const lock = join(tempDir(t, 'lock'), 'live.lock');

  const first = spawn(process.execPath, [
    RUNNER, '--scenario', 'noop', '--lane', firstLane, '--lock', lock,
    '--hold-ms', '4000', '--no-screenshot',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { try { first.kill('SIGKILL'); } catch {} });

  await waitForLine(first, /"event":"locked"/);

  const second = run(['--scenario', 'noop', '--lane', secondLane, '--lock', lock, '--no-screenshot']);
  assert.equal(second.status, 2, `second runner should refuse with exit 2, got ${second.status}: ${second.stderr}`);
  assert.match(second.stderr, /refused — another lane runner holds/);
  assert.match(second.stderr, /One Studio copy at a time/);

  const finished = await exitOf(first);
  assert.equal(finished.code, 0);
  const record = JSON.parse(readFileSync(join(firstLane, 'noop.json'), 'utf8'));
  assert.equal(record.status, 'passed');
  assert.ok(record.facts['Lock file'].endsWith('live.lock'));
});

test('the cap check reads back MemoryMax=2200M and MemorySwapMax=0 without a Studio', t => {
  const probe = spawnSync('systemd-run', ['--user', '--scope', '-q', '--', 'true'], { encoding: 'utf8', timeout: 20000 });
  if (probe.status !== 0) {
    t.skip('user systemd is not available here, so the cap cannot be read back');
    return;
  }
  const lane = tempDir(t, 'cap');
  const lock = join(tempDir(t, 'lock'), 'live.lock');
  const result = run(['--check-cap', '--lane', lane, '--lock', lock, '--no-screenshot']);
  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(readFileSync(join(lane, 'check-cap.json'), 'utf8'));
  assert.equal(record.status, 'passed');
  assert.equal(record.facts['MemoryMax read back'], String(2200 * 1024 * 1024));
  assert.equal(record.facts['MemorySwapMax read back'], '0');
});

test('the registry names the no-op and the reusable practice run', () => {
  const result = run(['--list']);
  assert.equal(result.status, 0, result.stderr);
  const registry = JSON.parse(result.stdout);
  const byName = Object.fromEntries(registry.map(entry => [entry.name, entry]));
  assert.equal(byName.noop.needsStudio, false);
  assert.equal(byName['practice-run'].needsStudio, true);
  assert.equal(byName['practice-run'].readsPractice, true);
});
