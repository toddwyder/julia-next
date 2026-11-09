import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runAgentsCommand } from './julia-agents.mjs';
import { scratchDir } from './scratch-dir.mjs';

const referencesPath = fileURLToPath(new URL('./julia-agents.env', import.meta.url));
const tokenScript = fileURLToPath(new URL('./linear-token.mjs', import.meta.url));
const linearFields = ['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET', 'LINEAR_OAUTH_SCOPE'];

function fixture(t, result = { status: 0 }) {
  mkdirSync(scratchDir, { recursive: true });
  const directory = mkdtempSync(join(scratchDir, 'wrapper-test-'));
  chmodSync(directory, 0o700);
  const tokenPath = join(directory, 'service-account-token');
  writeFileSync(tokenPath, 'offline-service-account-token\n', { mode: 0o600 });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
  const options = {
    tokenPath,
    environment: { PATH: '/usr/bin' },
    spawn(command, args, options) {
      calls.push({ command, args, options });
      if (args[0] === 'user') return { status: 0, stdout: '{"type":"SERVICE_ACCOUNT"}' };
      return result;
    },
  };
  return { directory, tokenPath, calls, errors, options };
}

test('full route performs one masked op run, with no authentication preflight', t => {
  const f = fixture(t);
  assert.equal(runAgentsCommand(['node', 'task.mjs'], f.options), 0);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].command, 'op');
  assert.deepEqual(f.calls[0].args, ['run', '--env-file', referencesPath, '--', process.execPath, tokenScript, '--', 'node', 'task.mjs']);
  assert.equal(f.calls[0].options.stdio, 'inherit');
  assert.equal(f.calls[0].options.shell, undefined);
  assert.equal(f.calls[0].options.env.OP_SERVICE_ACCOUNT_TOKEN, 'offline-service-account-token');
  assert.equal(f.calls[0].options.env.OP_CACHE, 'false');
  assert.equal(f.calls[0].options.env.OP_BIOMETRIC_UNLOCK_ENABLED, 'false');
});

test('Linear scope loads exactly the three existing OAuth settings, without a full env file', t => {
  const f = fixture(t);
  assert.equal(runAgentsCommand(['--linear', '--', 'node', 'scripts/linear-cli.mjs', 'get-issue', 'JUL-360'], f.options), 0);
  assert.equal(f.calls.length, 1);
  const { args, options } = f.calls[0];
  assert.deepEqual(args, ['run', '--', process.execPath, tokenScript, '--', 'node', 'scripts/linear-cli.mjs', 'get-issue', 'JUL-360']);
  const lines = readFileSync(referencesPath, 'utf8').split('\n');
  for (const key of linearFields) {
    assert.equal(options.env[key], lines.find(line => line.startsWith(`${key}=`)).slice(key.length + 1));
  }
  assert.deepEqual(Object.keys(options.env).filter(key => key.startsWith('LINEAR_')).sort(), [...linearFields].sort());
  assert.deepEqual(Object.entries(options.env).filter(([, value]) => value.startsWith('op://')).map(([key]) => key), ['LINEAR_CLIENT_SECRET']);
  assert.equal(options.env.COMMANDCODE_API_KEY, undefined);
  assert.equal(options.env.SENTRY_AUTH_TOKEN, undefined);
});

test('both routes strip inherited authentication overrides and secret references', t => {
  const f = fixture(t);
  f.options.environment = {
    PATH: '/usr/bin', KEEP: 'ordinary', OP_SERVICE_ACCOUNT_TOKEN: 'override', OP_CONNECT_HOST: 'bad-host',
    OP_CONNECT_TOKEN: 'bad-token', OP_SESSION: 'bad-session', OP_CACHE: 'true',
    LINEAR_API_KEY: 'revoked', LINEAR_CLIENT_ID: 'override', LINEAR_CLIENT_SECRET: 'override', LINEAR_OAUTH_SCOPE: 'override',
    CMD_API_KEY: 'override', COMMANDCODE_API_KEY: 'override', SENTRY_AUTH_TOKEN: 'override',
    AXIOM_TOKEN: 'override', STITCH_API_KEY: 'override', OTHER_SECRET: 'op://unrelated/item/field',
  };
  for (const prefix of [[], ['--linear', '--']]) {
    assert.equal(runAgentsCommand([...prefix, 'node', 'task.mjs'], f.options), 0);
    const env = f.calls.at(-1).options.env;
    assert.equal(env.KEEP, 'ordinary');
    for (const key of ['OP_CONNECT_HOST', 'OP_CONNECT_TOKEN', 'OP_SESSION', 'LINEAR_API_KEY', 'CMD_API_KEY', 'COMMANDCODE_API_KEY', 'SENTRY_AUTH_TOKEN', 'AXIOM_TOKEN', 'STITCH_API_KEY', 'OTHER_SECRET']) assert.equal(env[key], undefined);
    assert.equal(env.OP_SERVICE_ACCOUNT_TOKEN, 'offline-service-account-token');
    assert.notEqual(env.LINEAR_CLIENT_SECRET, 'override');
  }
});

test('literal argv and exit status survive the OAuth child route', t => {
  const f = fixture(t, { status: 23 });
  const argv = ['node', 'a script.mjs', '$(touch forbidden)', '; rm -rf /', '--linear'];
  assert.equal(runAgentsCommand(['--linear', '--', ...argv], f.options), 23);
  assert.deepEqual(f.calls.at(-1).args.slice(5), argv);
  assert.equal(f.calls.at(-1).options.shell, undefined);
});

test('vault refusal returns nonzero without separately launching the requested child', t => {
  const f = fixture(t, { status: 1 });
  assert.equal(runAgentsCommand(['--linear', '--', 'node', 'task.mjs'], f.options), 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].command, 'op');
});

test('spawn errors are sanitized and never retried', t => {
  const f = fixture(t, { error: new Error('sensitive token'), status: null });
  assert.equal(runAgentsCommand(['--linear', '--', 'node', 'task.mjs'], f.options), 1);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.errors, ['provider unavailable']);
});

test('a signalled process fails instead of reporting success', t => {
  const f = fixture(t, { status: null, signal: 'SIGTERM' });
  assert.equal(runAgentsCommand(['node', 'task.mjs'], f.options), 1);
  assert.equal(f.calls.length, 1);
});

for (const [name, change] of [
  ['readable token', f => chmodSync(f.tokenPath, 0o644)],
  ['accessible directory', f => chmodSync(f.directory, 0o755)],
  ['empty token', f => writeFileSync(f.tokenPath, '  \n')],
  ['missing token', f => rmSync(f.tokenPath)],
]) {
  test(`${name} refuses before any vault or child call`, t => {
    const f = fixture(t);
    change(f);
    assert.equal(runAgentsCommand(['--linear', '--', 'node', 'task.mjs'], f.options), 1);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.errors, ['provider unavailable']);
  });
}

test('missing commands and invalid arguments refuse without calling op', t => {
  const f = fixture(t);
  for (const argv of [[], ['--linear'], ['--linear', '--'], ['--'], ['--linear', '--', ''], ['node', null]]) {
    assert.equal(runAgentsCommand(argv, f.options), 1);
  }
  assert.equal(f.calls.length, 0);
  assert.ok(f.errors.every(error => error === 'provider unavailable'));
});
