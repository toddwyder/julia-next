import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decideUpdate, runUpdate } from './update.mjs';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', ...args], { cwd, encoding: 'utf8' }).trim();
const head = cwd => execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

const runEntry = (id, status) => ({ file: `/runs/${id}.json`, run: { id, status, startedAt: '2026-10-29T09:00:00.000Z' }, error: '' });

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'jul-276-update-'));
  const remote = join(root, 'remote.git');
  const source = join(root, 'source');
  const checkout = join(root, 'checkout');
  const state = join(root, 'state');
  execFileSync('git', ['init', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['init', '-b', 'main', source]);
  writeFileSync(join(source, 'file.txt'), 'one\n');
  git(source, 'add', '.');
  git(source, 'commit', '-m', 'one');
  git(source, 'remote', 'add', 'origin', remote);
  git(source, 'push', '-u', 'origin', 'main');
  execFileSync('git', ['clone', remote, checkout]);
  return {
    root, source, checkout, state,
    env: { DASHBOARD_CHECKOUT: checkout, DASHBOARD_STATE_DIR: state },
    advance(text = 'two') {
      writeFileSync(join(source, 'file.txt'), `${text}\n`);
      git(source, 'add', '.');
      git(source, 'commit', '-m', text);
      git(source, 'push', 'origin', 'main');
      return head(source);
    },
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('no run starting or running means update', () => {
  assert.deepEqual(decideUpdate([]), { action: 'update', code: 'idle', reason: 'no run is starting or running', blocking: [] });
  assert.equal(decideUpdate([runEntry('run-1', 'finished'), runEntry('run-2', 'failed')]).action, 'update');
});

test('any run starting or running means skip, and the run is named', () => {
  for (const status of ['starting', 'running']) {
    const decision = decideUpdate([runEntry('run-1', 'finished'), runEntry('run-2', status)]);
    assert.equal(decision.action, 'skip');
    assert.equal(decision.code, 'active-run');
    assert.match(decision.reason, /run-2 is starting|run-2 is running/);
    assert.deepEqual(decision.blocking, [{ file: '/runs/run-2.json', id: 'run-2', status }]);
  }
});

test('a run file that cannot be read fails closed, because an active run cannot be ruled out', () => {
  const decision = decideUpdate([{ file: '/runs/broken.json', run: null, error: 'is not valid JSON' }]);
  assert.equal(decision.action, 'skip');
  assert.equal(decision.code, 'unreadable-run-file');
  assert.deepEqual(decision.blocking, [{ file: '/runs/broken.json', error: 'is not valid JSON' }]);
});

test('a skip moves nothing: no command runs and the checkout stands still', () => {
  const repo = repository();
  try {
    const before = head(repo.checkout);
    const calls = [];
    const run = (command, args) => {
      calls.push([command, ...args].join(' '));
      return '';
    };
    const logged = [];
    const result = runUpdate({
      env: repo.env, run, log: line => logged.push(line),
      entries: [{ file: '/runs/active.json', run: { id: 'active', status: 'running', startedAt: '2026-10-29T09:00:00.000Z' }, error: '' }],
    });
    assert.equal(result.action, 'skip');
    assert.equal(result.updated, false);
    assert.deepEqual(calls, []);
    assert.equal(head(repo.checkout), before);
    assert.match(logged[0], /"phase":"decide".*"action":"skip".*"code":"active-run"/);
  } finally {
    repo.clean();
  }
});

test('a checkout already at the ref is left alone and never rebuilt', () => {
  const repo = repository();
  try {
    const calls = [];
    const run = (command, args) => {
      calls.push([command, ...args].join(' '));
      if (command === 'git') return execFileSync('git', args, { encoding: 'utf8' }).trim();
      return '';
    };
    const result = runUpdate({ env: repo.env, run, log: () => {}, entries: [] });
    assert.equal(result.action, 'up-to-date');
    assert.equal(result.updated, false);
    assert.deepEqual(calls.filter(call => !call.startsWith('git ')), []);
  } finally {
    repo.clean();
  }
});

test('an update fast-forwards, rebuilds, restarts the unit and records the served commit', () => {
  const repo = repository();
  try {
    const before = head(repo.checkout);
    const target = repo.advance();
    const calls = [];
    const run = (command, args, options = {}) => {
      calls.push({ command, args, cwd: options.cwd });
      if (command === 'git') return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      return '';
    };
    const logged = [];
    const result = runUpdate({ env: repo.env, run, log: line => logged.push(line), now: () => '2026-10-29T10:00:00.000Z', entries: [] });

    assert.equal(result.action, 'updated');
    assert.equal(result.commit, target);
    assert.equal(head(repo.checkout), target);
    assert.deepEqual(calls.map(call => `${call.command} ${call.args.slice(0, 3).join(' ')}`), [
      'git -C ' + repo.checkout + ' fetch',
      'git -C ' + repo.checkout + ' rev-parse',
      'git -C ' + repo.checkout + ' rev-parse',
      'git -C ' + repo.checkout + ' merge',
      'npm ci',
      'npm run build',
      'sudo -n systemctl restart',
    ]);
    const merge = calls.find(call => call.command === 'git' && call.args.includes('merge'));
    assert.deepEqual(merge.args.slice(-2), ['--ff-only', target]);
    assert.equal(calls.find(call => call.command === 'npm').cwd, join(repo.checkout, 'dashboard'));
    assert.deepEqual(calls.find(call => call.command === 'sudo').args, ['-n', 'systemctl', 'restart', 'julia-dashboard']);
    assert.deepEqual(JSON.parse(readFileSync(join(repo.state, 'state', 'build.json'), 'utf8')), {
      commit: target, ref: 'origin/main', updatedAt: '2026-10-29T10:00:00.000Z', previous: before, checkout: repo.checkout,
    });
    assert.deepEqual(logged.map(line => JSON.parse(line.replace('julia-dashboard: ', '')).phase), ['decide', 'fetch', 'resolve', 'compare', 'fast-forward', 'install', 'build', 'restart', 'record']);
  } finally {
    repo.clean();
  }
});

test('a checkout that cannot fast-forward stops the update before any build or restart', () => {
  const repo = repository();
  try {
    repo.advance();
    writeFileSync(join(repo.checkout, 'local.txt'), 'local work\n');
    git(repo.checkout, 'add', '.');
    git(repo.checkout, 'commit', '-m', 'local');
    const calls = [];
    const run = (command, args, options = {}) => {
      calls.push({ command, args, cwd: options.cwd });
      if (command === 'git') return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      return '';
    };
    const result = runUpdate({ env: repo.env, run, log: () => {}, entries: [] });
    assert.equal(result.action, 'failed');
    assert.equal(result.phase, 'fast-forward');
    assert.deepEqual(calls.filter(call => call.command !== 'git'), []);
  } finally {
    repo.clean();
  }
});

test('the ref under watch is DASHBOARD_UPDATE_REF, so a lane can watch a real fast-forward', () => {
  const repo = repository();
  try {
    git(repo.source, 'checkout', '-b', 'lane', 'main');
    writeFileSync(join(repo.source, 'lane.txt'), 'lane\n');
    git(repo.source, 'add', '.');
    git(repo.source, 'commit', '-m', 'lane');
    git(repo.source, 'push', 'origin', 'lane');
    const lane = head(repo.source);
    const run = (command, args) => (command === 'git' ? execFileSync('git', args, { encoding: 'utf8' }).trim() : '');
    const result = runUpdate({ env: { ...repo.env, DASHBOARD_UPDATE_REF: 'origin/lane' }, run, log: () => {}, entries: [] });
    assert.equal(result.action, 'updated');
    assert.equal(result.commit, lane);
    assert.equal(head(repo.checkout), lane);
  } finally {
    repo.clean();
  }
});
