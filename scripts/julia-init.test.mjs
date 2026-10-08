import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseInitCommand, runInit, runInitCli } from './julia-init.mjs';

const execFileAsync = promisify(execFile);
const initScript = fileURLToPath(new URL('./julia-init.mjs', import.meta.url));

function runCli(arguments_, { cwd, input = '' } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [initScript, ...arguments_], { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
      if (input && stderr.includes('$init needs')) {
        child.stdin.end(input);
        input = '';
      }
    });
    child.on('error', fail);
    child.on('close', (code) => done({ code, stdout, stderr }));
    if (!input) child.stdin.end();
  });
}

const nativeConnection = {
  route: 'native', provider: null, endpoint: null, protocol: null, authReference: null,
};

const catalog = [
  {
    id: 'anthropic-builder', displayName: 'Anthropic Builder', executableModelId: 'claude-builder',
    maker: 'Anthropic', harness: 'claude-code', thinking: { supported: ['low', 'high'], default: 'high' }, connection: nativeConnection,
  },
  {
    id: 'openai-reviewer', displayName: 'OpenAI Reviewer', executableModelId: 'codex-reviewer',
    maker: 'OpenAI', harness: 'codex', thinking: { supported: false, default: null }, connection: nativeConnection,
  },
];

async function fixture(t, settings = { catalog, builder: { model: 'anthropic-builder', thinking: 'high' }, reviewer: { model: 'openai-reviewer', thinking: null } }) {
  const directory = await mkdtemp(join(tmpdir(), 'julia-init-'));
  const settingsPath = join(directory, 'delivery-tools.json');
  await writeFile(settingsPath, `${JSON.stringify(settings)}\n`);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, settingsPath };
}

test('accepts only the literal $init command and rejects malformed role syntax', () => {
  assert.deepEqual(parseInitCommand('$init JUL-195 --builder "Anthropic Builder" low'), {
    issueId: 'JUL-195', choices: { builder: { model: 'Anthropic Builder', thinking: 'low' } },
  });
  assert.throws(() => parseInitCommand('/init JUL-195'), /literal \$init command/);
  assert.throws(() => parseInitCommand('$init JUL-195 --builder'), /requires an exact model name/);
  assert.throws(() => parseInitCommand('$init JUL-195 --builder anthropic-builder low --builder anthropic-builder high'), /more than once/);
});

test('literal $init selects both roles, persists defaults, and fake-dispatches an immutable non-secret snapshot', async (t) => {
  const { directory, settingsPath } = await fixture(t);
  const dispatched = [];

  const result = await runInit('$init JUL-195 --builder "Anthropic Builder" low --reviewer openai-reviewer none', {
    settingsPath,
    stateDirectory: join(directory, 'runs'),
    dispatch: async (configuration) => dispatched.push(configuration),
  });

  assert.equal(result.issueId, 'JUL-195');
  assert.equal(dispatched.length, 1);
  assert.deepEqual(dispatched[0], result.configuration);
  assert.deepEqual(result.configuration, {
    builder: {
      identity: 'anthropic-builder', model: 'claude-builder', maker: 'Anthropic', harness: 'claude-code', thinking: 'low',
      connection: { route: 'native', provider: null, endpoint: null, protocol: null, authReference: null },
    },
    reviewer: {
      identity: 'openai-reviewer', model: 'codex-reviewer', maker: 'OpenAI', harness: 'codex', thinking: null,
      connection: { route: 'native', provider: null, endpoint: null, protocol: null, authReference: null },
    },
  });

  const defaults = JSON.parse(await readFile(join(directory, 'runs', 'defaults.json'), 'utf8'));
  assert.deepEqual(defaults, {
    builder: { model: 'Anthropic Builder', thinking: 'low' },
    reviewer: { model: 'openai-reviewer', thinking: null },
  });
  const saved = JSON.parse(await readFile(join(directory, 'runs', 'JUL-195.json'), 'utf8'));
  assert.deepEqual(saved.configuration, result.configuration);
  assert.doesNotMatch(JSON.stringify(saved), /secret|api.?key|token/i);
  const events = await readFile(join(directory, 'runs', 'events.jsonl'), 'utf8');
  assert.match(events, /"event":"selection-saved"/);
  assert.match(events, /"builder":"anthropic-builder"/);
  assert.match(events, /"reviewer":"openai-reviewer"/);
});

test('the command-line entry point receives literal $init, writes the run file, and rejects /init', async (t) => {
  const { directory } = await fixture(t);
  const { stdout } = await execFileAsync(process.execPath, [initScript, '$init JUL-199 --builder anthropic-builder low --reviewer openai-reviewer none'], { cwd: directory });

  assert.equal(JSON.parse(stdout).issueId, 'JUL-199');
  assert.deepEqual(JSON.parse(await readFile(join(directory, '.julia', 'runs', 'JUL-199.json'), 'utf8')).configuration.builder.thinking, 'low');
  await assert.rejects(
    execFileAsync(process.execPath, [initScript, '/init JUL-199'], { cwd: directory }),
    /literal \$init command/,
  );
});

test('the command-line entry point prompts for a stale role and saves its replacement', async (t) => {
  const { directory } = await fixture(t);
  await mkdir(join(directory, '.julia', 'runs'), { recursive: true });
  await writeFile(join(directory, '.julia', 'runs', 'defaults.json'), `${JSON.stringify({
    builder: { model: 'anthropic-builder', thinking: 'low' }, reviewer: { model: 'gone', thinking: null },
  })}\n`);

  const result = await runCli(['$init JUL-198'], { cwd: directory, input: 'openai-reviewer none\n' });

  assert.equal(result.code, 0);
  assert.match(result.stderr, /\$init needs reviewer/);
  assert.equal(JSON.parse(result.stdout).configuration.builder.thinking, 'low');
  assert.equal(JSON.parse(result.stdout).configuration.reviewer.identity, 'openai-reviewer');
});

test('uses remembered defaults when neither role is supplied and updates each role independently', async (t) => {
  const { directory, settingsPath } = await fixture(t);
  const stateDirectory = join(directory, 'runs');
  const calls = [];
  const dispatch = async (configuration) => calls.push(configuration);

  await runInit('$init JUL-195', { settingsPath, stateDirectory, dispatch });
  await runInit('$init JUL-196 --builder "Anthropic Builder" low', { settingsPath, stateDirectory, dispatch });
  await runInit('$init JUL-197 --reviewer openai-reviewer none', { settingsPath, stateDirectory, dispatch });

  assert.deepEqual(calls.map((call) => [call.builder.thinking, call.reviewer.thinking]), [
    ['high', null], ['low', null], ['low', null],
  ]);
});

test('rejects malformed, unknown, unsupported, ambiguous, and same-maker selections before fake dispatch or default changes', async (t) => {
  const sameMaker = {
    id: 'anthropic-reviewer', displayName: 'Anthropic Reviewer', executableModelId: 'claude-reviewer',
    maker: 'Anthropic', harness: 'claude-code', thinking: { supported: ['low'], default: 'low' }, connection: nativeConnection,
  };
  const ambiguous = { ...catalog[1], id: 'other-reviewer', displayName: 'openai-reviewer' };
  const { directory, settingsPath } = await fixture(t, { catalog: [...catalog, sameMaker], builder: { model: 'anthropic-builder', thinking: 'high' }, reviewer: { model: 'openai-reviewer', thinking: null } });
  const stateDirectory = join(directory, 'runs');
  const calls = [];
  await runInit('$init JUL-195', { settingsPath, stateDirectory, dispatch: async (value) => calls.push(value) });
  const before = await readFile(join(stateDirectory, 'defaults.json'), 'utf8');

  for (const command of [
    '$init JUL-196 --builder',
    '$init JUL-196 --builder missing low',
    '$init JUL-196 --builder anthropic-builder medium',
    '$init JUL-196 --builder anthropic-builder low --reviewer anthropic-reviewer low',
    '$init JUL-196 --builder openai-reviewer none',
  ]) {
    await assert.rejects(runInit(command, { settingsPath, stateDirectory, dispatch: async (value) => calls.push(value) }));
  }

  assert.equal(calls.length, 1);
  assert.equal(await readFile(join(stateDirectory, 'defaults.json'), 'utf8'), before);
  await writeFile(settingsPath, `${JSON.stringify({ catalog: [...catalog, ambiguous], builder: { model: 'anthropic-builder', thinking: 'high' }, reviewer: { model: 'openai-reviewer', thinking: null } })}\n`);
  await assert.rejects(
    runInit('$init JUL-196 --reviewer "openai-reviewer" none', { settingsPath, stateDirectory }),
    /ambiguous/,
  );
  const events = await readFile(join(stateDirectory, 'events.jsonl'), 'utf8');
  assert.match(events, /"event":"selection-refused"/);
  assert.match(events, /"reason":"invalid-selection"/);
});

test('a stale remembered default asks for that role while retaining the other valid role', async (t) => {
  const { directory, settingsPath } = await fixture(t);
  const stateDirectory = join(directory, 'runs');
  await writeFile(join(directory, 'delivery-tools.json'), `${JSON.stringify({
    catalog: [catalog[0]], builder: { model: 'anthropic-builder', thinking: 'high' }, reviewer: { model: 'openai-reviewer', thinking: null },
  })}\n`);
  await mkdir(join(directory, 'runs'), { recursive: true });
  await writeFile(join(directory, 'runs', 'defaults.json'), `${JSON.stringify({
    builder: { model: 'anthropic-builder', thinking: 'low' }, reviewer: { model: 'openai-reviewer', thinking: null },
  })}\n`);

  await assert.rejects(
    runInit('$init JUL-195', { settingsPath, stateDirectory }),
    (error) => {
      assert.equal(error.name, 'SelectionRequiredError');
      assert.deepEqual(error.roles, ['reviewer']);
      assert.deepEqual(error.selections.builder, { model: 'anthropic-builder', thinking: 'low' });
      return true;
    },
  );
  assert.match(await readFile(join(stateDirectory, 'events.jsonl'), 'utf8'), /"reason":"missing-or-stale-selection"/);
});

test('a missing remembered role asks for input instead of silently substituting a settings default', async (t) => {
  const { directory, settingsPath } = await fixture(t);
  const stateDirectory = join(directory, 'runs');
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(join(stateDirectory, 'defaults.json'), `${JSON.stringify({ builder: { model: 'anthropic-builder', thinking: 'low' } })}\n`);

  await assert.rejects(
    runInit('$init JUL-195', { settingsPath, stateDirectory }),
    (error) => error.name === 'SelectionRequiredError' && error.roles.length === 1 && error.roles[0] === 'reviewer',
  );
});

test('the command wrapper asks only for stale roles and retains the other remembered role', async (t) => {
  const { directory, settingsPath } = await fixture(t);
  const stateDirectory = join(directory, 'runs');
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(join(stateDirectory, 'defaults.json'), `${JSON.stringify({
    builder: { model: 'anthropic-builder', thinking: 'low' }, reviewer: { model: 'missing', thinking: null },
  })}\n`);
  const asked = [];

  const result = await runInitCli('$init JUL-195', {
    settingsPath, stateDirectory,
    ask: async (role) => { asked.push(role); return 'openai-reviewer none'; },
  });

  assert.deepEqual(asked, ['reviewer']);
  assert.equal(result.configuration.builder.thinking, 'low');
  assert.equal(result.configuration.reviewer.identity, 'openai-reviewer');
});

test('an API-routed model snapshot keeps routing metadata and only an auth reference', async (t) => {
  const apiConnection = {
    route: 'api', provider: 'Command Code', endpoint: 'https://models.example.invalid/v1',
    protocol: 'openai-compatible', authReference: 'COMMAND_CODE_API_KEY',
  };
  const apiBuilder = {
    ...catalog[0], id: 'deepseek-builder', displayName: 'DeepSeek Builder', executableModelId: 'deepseek-coder',
    maker: 'DeepSeek', harness: 'omp', connection: apiConnection,
  };
  const { directory, settingsPath } = await fixture(t, {
    catalog: [apiBuilder, catalog[1]], builder: { model: 'deepseek-builder', thinking: 'high' }, reviewer: { model: 'openai-reviewer', thinking: null },
  });

  const { configuration } = await runInit('$init JUL-195', { settingsPath, stateDirectory: join(directory, 'runs') });

  assert.deepEqual(configuration.builder.connection, apiConnection);
  assert.equal('authValue' in configuration.builder.connection, false);
});

test('resume dispatches the saved snapshot unchanged after defaults and catalog routes are edited', async (t) => {
  const { directory, settingsPath } = await fixture(t);
  const stateDirectory = join(directory, 'runs');
  const first = await runInit('$init JUL-195 --builder anthropic-builder low --reviewer openai-reviewer none', { settingsPath, stateDirectory });
  await writeFile(settingsPath, `${JSON.stringify({ catalog: [{ ...catalog[0], executableModelId: 'changed', connection: { ...nativeConnection, route: 'api', provider: 'Other', endpoint: 'https://changed.invalid', protocol: 'openai-compatible', authReference: 'CHANGED' } }], builder: { model: 'anthropic-builder', thinking: 'high' }, reviewer: { model: 'gone', thinking: null } })}\n`);
  const calls = [];

  const resumed = await runInit('$init JUL-195', { settingsPath, stateDirectory, dispatch: async (configuration) => calls.push(configuration) });

  assert.equal(resumed.resumed, true);
  assert.deepEqual(calls, [first.configuration]);
  await assert.rejects(runInit('$init JUL-195 --builder anthropic-builder high', { settingsPath, stateDirectory }), /already has a saved configuration/);
});
