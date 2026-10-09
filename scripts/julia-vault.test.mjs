import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateJuliaSecrets, vaultLaunch } from './julia-vault.mjs';

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
test('failed readback returns no replacement references', async () => {
  const execute = async args => args[0] === 'vault' ? [{ id: 'vault-id', name: 'Julia' }] : args[1] === 'list' ? [] : args[1] === 'create' ? { id: 'item-id' } : { fields: [] };
  await assert.rejects(migrateJuliaSecrets({ AXIOM_TOKEN: 'private-value' }, { execute }), /readback did not match/);
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
