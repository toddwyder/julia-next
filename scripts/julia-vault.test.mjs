import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateJuliaSecrets, vaultLaunch, vaultProbe } from './julia-vault.mjs';

test('Windows provisioning parks after account creation followed by failed persistence', { skip: process.platform !== 'win32' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'julia-bootstrap-'));
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  try {
    const fakeOp = join(directory, 'fake-op.ps1');
    const counter = join(directory, 'calls.txt');
    writeFileSync(fakeOp, `Set-Content -LiteralPath ${quote(counter)} -Value 'created-once'\nNew-Item -ItemType Directory -Path ${quote(join(directory, 'runner-token.dpapi'))} > $null\n$global:LASTEXITCODE=0\nWrite-Output 'ops_synthetic_test_only'\n`);
    const configuration = join(directory, 'vault-launch.json');
    writeFileSync(configuration, JSON.stringify({ vaultId: 'vault-id', opExecutable: fakeOp, referencesPath: join(directory, 'secrets.env') }));
    const wrapper = fileURLToPath(new URL('./julia-vault-windows.ps1', import.meta.url));
    const powershell = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const invoke = () => spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapper, '-ConfigurationPath', configuration, '-Provision'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    const first = invoke();
    assert.equal(first.status, 1);
    assert.equal(JSON.parse(readFileSync(join(directory, 'runner-provision.json'), 'utf8')).phase, 'creation-started');
    assert.equal(readFileSync(counter, 'utf8').trim(), 'created-once');
    rmSync(join(directory, 'runner-token.dpapi'), { recursive: true });
    const second = invoke();
    assert.equal(second.status, 1);
    assert.match(second.stderr, /already attempted/);
    assert.equal(readFileSync(counter, 'utf8').trim(), 'created-once');
    assert.equal((first.stdout + first.stderr + second.stdout + second.stderr).includes('ops_synthetic_test_only'), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('migration pipes secrets, verifies readback and returns references only', async () => {
  const calls = []; let item;
  const execute = async (args, input) => {
    calls.push({ args, input });
    if (args[0] === 'vault' && args[1] === 'list') return [{ id: 'vault-id', name: 'Julia' }];
    if (args[0] === 'item' && args[1] === 'list') return [];
    if (args[0] === 'item' && args[1] === 'create') { item = { ...input, id: 'item-id' }; return { id: item.id }; }
    if (args[0] === 'item' && args[1] === 'get') return item;
    assert.fail('unexpected operation');
  };
  const result = await migrateJuliaSecrets({ AXIOM_TOKEN: 'private-value', AXIOM_DATASET: 'julia-preview', UNRELATED_SECRET: 'leave-alone' }, { execute });
  assert.equal(result.references.AXIOM_TOKEN, 'op://vault-id/item-id/AXIOM_TOKEN');
  assert.equal(JSON.stringify(result).includes('private-value'), false);
  assert.equal(JSON.stringify(calls.map(call => call.args)).includes('private-value'), false);
  assert.equal(item.fields.find(field => field.label === 'AXIOM_TOKEN').type, 'CONCEALED');
  assert.equal(item.fields.some(field => field.label === 'UNRELATED_SECRET'), false);
});
test('migration refuses an existing conflicting item instead of overwriting it', async () => {
  const execute = async args => args[0] === 'vault' ? [{ id: 'vault-id', name: 'Julia' }] : args[1] === 'list' ? [{ id: 'item-id', title: 'Julia Axiom' }] : { fields: [{ label: 'AXIOM_TOKEN', value: 'different' }] };
  await assert.rejects(migrateJuliaSecrets({ AXIOM_TOKEN: 'private-value' }, { execute }), /existing vault item differs/);
});

test('CommandCode migrates through stdin and launches from a Julia reference without stale plaintext', async () => {
  let item;
  const execute = async (args, input) => {
    assert.equal(args.includes('private-commandcode-value'), false);
    if (args[0] === 'vault') return [{ id: 'vault-id', name: 'Julia' }];
    if (args[1] === 'list') return [];
    if (args[1] === 'create') { item = { ...input, id: 'commandcode-item' }; return { id: item.id }; }
    if (args[1] === 'get') return item;
    assert.fail('unexpected operation');
  };
  const result = await migrateJuliaSecrets({ COMMANDCODE_API_KEY: 'private-commandcode-value', DEEPSEEK_API_KEY: 'retired-secret' }, { execute });
  assert.equal(result.references.COMMANDCODE_API_KEY, 'op://vault-id/commandcode-item/COMMANDCODE_API_KEY');
  assert.equal(item.fields[0].type, 'CONCEALED');
  assert.equal(JSON.stringify(result).includes('private-commandcode-value'), false);
  assert.equal(result.references.DEEPSEEK_API_KEY, undefined);
  const configuration = { vaultId: 'vault-id', referencesPath: 'references.env' };
  assert.equal(vaultLaunch([], { configuration, references: `COMMANDCODE_API_KEY=${result.references.COMMANDCODE_API_KEY}`, environment: { COMMANDCODE_API_KEY: 'stale', PATH: 'fixture' }, run: (_command, _args, options) => {
    assert.deepEqual(options.env, { PATH: 'fixture', COMMANDCODE_API_KEY: 'op://vault-id/commandcode-item/COMMANDCODE_API_KEY' });
    return { status: 0 };
  } }), 0);
  for (const reference of ['plaintext', 'op://other-vault/item/key']) {
    assert.throws(() => vaultLaunch([], { configuration, references: `COMMANDCODE_API_KEY=${reference}`, run: () => assert.fail('must not launch') }), /invalid vault reference/);
  }
});
test('failed readback returns no replacement references', async () => {
  const execute = async args => args[0] === 'vault' ? [{ id: 'vault-id', name: 'Julia' }] : args[1] === 'list' ? [] : args[1] === 'create' ? { id: 'item-id' } : { fields: [] };
  await assert.rejects(migrateJuliaSecrets({ AXIOM_TOKEN: 'private-value' }, { execute }), /readback did not match/);
});

test('vault probe verifies resolution without starting delivery or displaying values', () => {
  const options = { configuration: { vaultId: 'vault-id', referencesPath: 'references.env' }, references: 'AXIOM_TOKEN=op://vault-id/item-id/token\n' };
  const run = (command, args, settings) => {
    assert.equal(args[3], '-e');
    assert.equal(args.some(arg => arg.includes('julia-init.mjs')), false);
    const result = spawnSync(process.execPath, args.slice(3), { ...settings, stdio: 'pipe', encoding: 'utf8', env: { ...settings.env, AXIOM_TOKEN: 'resolved-private-value' } });
    assert.equal(result.stdout.includes('resolved-private-value'), false);
    assert.match(result.stdout, /1 fields/);
    return result;
  };
  assert.equal(vaultProbe({ ...options, run }), 0);
  assert.equal(vaultProbe({ ...options, run: (command, args, settings) => spawnSync(process.execPath, args.slice(3), { ...settings, stdio: 'pipe' }) }), 1);
  assert.throws(() => vaultProbe({ ...options, references: 'AXIOM_TOKEN=plaintext', run: () => assert.fail('invalid references launched') }), /invalid vault reference/);
});
test('vault launcher loads only references in the designated vault, preserves masking and child exit code', () => {
  let call;
  const code = vaultLaunch(['$init', 'JUL-123'], { configuration: { vaultId: 'vault-id', opExecutable: 'op.exe', referencesPath: 'references.env' }, references: 'VERCEL_TOKEN=op://vault-id/item-id/token\n', run: (command, args, options) => { call = { command, args, options }; return { status: 7 }; } });
  assert.equal(code, 7); assert.equal(call.command, 'op.exe');
  assert.deepEqual(call.args.slice(0, 2), ['run', '--']);
  assert.equal(call.args.includes('references.env'), false);
  assert.equal(call.options.env.VERCEL_TOKEN, 'op://vault-id/item-id/token');
  assert.equal(call.args.includes('--no-masking'), false); assert.equal(call.options.shell, undefined);
});
test('omitted service secrets do not inherit stale plaintext or unrelated vault references', () => {
  vaultLaunch(['$init', 'JUL-123'], { configuration: { vaultId: 'vault-id', referencesPath: 'mutable.env' }, references: 'LINEAR_API_KEY=op://vault-id/item-id/key', environment: { VERCEL_TOKEN: 'stale', axiom_token: 'stale', AXIOM_DATASET: 'op://other/item/dataset', OP_SERVICE_ACCOUNT_TOKEN: 'bootstrap', PATH: 'fixture' }, run: (_command, args, options) => {
    assert.equal(args.includes('mutable.env'), false);
    assert.deepEqual(options.env, { OP_SERVICE_ACCOUNT_TOKEN: 'bootstrap', PATH: 'fixture', LINEAR_API_KEY: 'op://vault-id/item-id/key' }); return { status: 0 };
  } });
});
test('plaintext, foreign vault references and bootstrap tokens in reference files are refused before launch', () => {
  for (const references of ['VERCEL_TOKEN=plaintext', 'VERCEL_TOKEN=op://other/item/token', 'OP_SERVICE_ACCOUNT_TOKEN=op://vault-id/item/token']) {
    assert.throws(() => vaultLaunch(['$init', 'JUL-123'], { configuration: { vaultId: 'vault-id', referencesPath: 'references.env' }, references, run: () => assert.fail('must not launch') }), /reference/);
  }
});
