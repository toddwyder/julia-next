// Native session-file IO boundary fixtures; never a real provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeBuilderEvidence } from './julia-delivery-proof-evidence.mjs';

test('native proof observes Codex custom tool reads from matched output, including separate reads', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jul196-native-provenance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const worktree = join(root, 'worktree'); await mkdir(worktree);
  const records = [
    { type: 'session_meta', payload: { id: 'fixture-thread', cwd: worktree, model_provider: 'openai' } },
    { type: 'turn_context', payload: { model: 'gpt-6.1-sol', effort: 'high' } },
    { type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'skill', name: 'exec', input: 'Get-Content .agents/skills/implement/SKILL.md' } },
    { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'skill', output: 'Implement the work described by the user in the spec or tickets.' } },
    { type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'approved', name: 'exec', input: 'Get-Content C:\\proof\\runs\\JUL-196-approved.json' } },
    { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'approved', output: 'partial unique-fixture-marker' } },
  ];
  await writeFile(join(root, 'rollout-fixture.jsonl'), records.map(record => JSON.stringify(record)).join('\n'));
  const [evidence] = await nativeBuilderEvidence({ worktree, marker: 'partial unique-fixture-marker' }, { root });
  assert.equal(evidence.canonicalSavedRead, true);
  assert.deepEqual(evidence.readCallIds, ['skill', 'approved']);
  assert.deepEqual(evidence.models, ['gpt-6.1-sol']);
  assert.deepEqual(evidence.efforts, ['high']);
  assert.equal(evidence.provider, 'openai');
});

test('native proof never treats agent prose, an unmatched read response or another working copy as successful reads', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jul196-native-fail-closed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const worktree = join(root, 'worktree');
  const meta = { type: 'session_meta', payload: { id: 'fixture', cwd: worktree, model_provider: 'openai' } };
  const prose = 'Implement the work described by the user\npartial marker';
  const call = { type: 'response_item', payload: { type: 'function_call', call_id: 'read', name: 'exec_command', arguments: 'cat .agents/skills/implement/SKILL.md JUL-196-approved.json' } };
  const path = join(root, 'rollout-fixture.jsonl');
  await writeFile(path, [meta, { type: 'response_item', payload: { type: 'message', role: 'assistant', content: prose } }, call,
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'unrelated', output: prose } },
  ].map(record => JSON.stringify(record)).join('\n'));
  const [evidence] = await nativeBuilderEvidence({ worktree, marker: 'partial marker' }, { root });
  assert.equal(evidence.canonicalSavedRead, false);
  assert.deepEqual(evidence.models, [], 'unknown model remains unknown');
  assert.deepEqual(await nativeBuilderEvidence({ worktree: join(root, 'other'), marker: 'partial marker' }, { root }), []);
});

test('native proof accepts successful function tool read outputs and records a Linear call as unsafe', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jul196-native-function-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const worktree = join(root, 'worktree');
  const records = [
    { type: 'session_meta', payload: { id: 'fixture', cwd: worktree, model_provider: 'openai' } },
    { type: 'turn_context', payload: { model: 'gpt-6.1-sol', reasoning_effort: 'high' } },
    { type: 'response_item', payload: { type: 'function_call', call_id: 'read', name: 'exec_command', arguments: 'cat .agents/skills/implement/SKILL.md JUL-196-approved.json' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'read', output: 'Implement the work described by the user\npartial marker' } },
    { type: 'response_item', payload: { type: 'function_call', call_id: 'linear', name: 'mcp__linear__get_issue', arguments: '{}' } },
  ];
  await writeFile(join(root, 'rollout-fixture.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n{"incomplete":');
  const [evidence] = await nativeBuilderEvidence({ worktree, marker: 'partial marker' }, { root });
  assert.equal(evidence.canonicalSavedRead, true);
  assert.equal(evidence.noLinearCalls, false);
  assert.deepEqual(evidence.efforts, ['high']);
});

test('native proof rejects a corrupt interior session record instead of silently filtering evidence', async t => {
  const root = await mkdtemp(join(tmpdir(), 'jul196-native-corrupt-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const worktree = join(root, 'worktree');
  await writeFile(join(root, 'rollout-fixture.jsonl'), [
    JSON.stringify({ type: 'session_meta', payload: { id: 'fixture', cwd: worktree, model_provider: 'openai' } }),
    '{broken interior record',
    JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6.1-sol', effort: 'high' } }),
  ].join('\n'));
  await assert.rejects(nativeBuilderEvidence({ worktree, marker: 'partial marker' }, { root }), /corrupt native session/i);
});
