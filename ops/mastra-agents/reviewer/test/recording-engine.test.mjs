import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod/v4';
import { Agent } from '@mastra/core/agent';
import { resolveModelConfig } from '@mastra/core/llm';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createRecordingEngine } from '../src/recording-engine.mjs';

async function temporaryRun(t, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('accepted pieces are durable and can be replaced, removed, inspected, and submitted', async t => {
  const runDirectory = await temporaryRun(t, 'recording-engine-');
  const submitted = [];
  const engine = await createRecordingEngine({
    runDirectory,
    pieceSchema: z.object({ type: z.literal('line'), name: z.string(), value: z.string() }),
    reportSchema: z.object({ greeting: z.string(), subject: z.string() }),
    keyOf: piece => piece.name,
    requiredKeys: ['greeting', 'subject'],
    checks: [piece => piece.value === 'forbidden' ? [`${piece.name} cannot be forbidden`] : []],
    assemble: pieces => Object.fromEntries([...pieces.values()].map(piece => [piece.name, piece.value])),
    submit: async report => { submitted.push(report); return { accepted: true }; },
  });

  assert.deepEqual(await engine.tools.record_piece.execute({ type: 'line', name: 'greeting', value: 'hello' }), { accepted: true, key: 'greeting' });
  assert.deepEqual(await engine.tools.record_piece.execute({ type: 'line', name: 'subject', value: 'forbidden' }), { error: true, message: 'subject cannot be forbidden' });
  assert.deepEqual(await engine.tools.show_missing.execute({}), { missing: ['subject'], accepted: ['greeting'] });
  assert.deepEqual(await engine.tools.submit_report.execute({}), { error: true, message: 'Report is incomplete. Missing: subject' });
  assert.deepEqual(await engine.tools.record_piece.execute({ type: 'line', name: 'subject', value: 'world' }), { accepted: true, key: 'subject' });
  assert.deepEqual(await engine.tools.replace_piece.execute({ type: 'line', name: 'subject', value: 'reader' }), { accepted: true, key: 'subject', replaced: true });
  assert.deepEqual(await engine.tools.remove_piece.execute({ key: 'subject' }), { accepted: true, key: 'subject', removed: true });
  assert.deepEqual(await engine.tools.record_piece.execute({ type: 'line', name: 'subject', value: 'world' }), { accepted: true, key: 'subject' });
  assert.deepEqual(await engine.tools.submit_report.execute({}), { accepted: true });
  assert.deepEqual(submitted, [{ greeting: 'hello', subject: 'world' }]);

  const files = await readdir(join(runDirectory, 'pieces'));
  assert.equal(files.length, 2);
  const durable = await Promise.all(files.map(file => readFile(join(runDirectory, 'pieces', file), 'utf8').then(JSON.parse)));
  assert.deepEqual(durable.map(entry => entry.key).sort(), ['greeting', 'subject']);
});

test('the same engine records an unrelated packing-list schema without engine changes', async t => {
  const runDirectory = await temporaryRun(t, 'recording-engine-packing-');
  let report;
  const engine = await createRecordingEngine({
    runDirectory,
    pieceSchema: z.object({ type: z.literal('packed-item'), slot: z.enum(['boots', 'coat']), packed: z.boolean() }),
    reportSchema: z.object({ packed: z.array(z.string()).length(2) }),
    keyOf: piece => piece.slot,
    requiredKeys: ['boots', 'coat'],
    checks: [piece => piece.packed ? [] : [`${piece.slot} is not packed`]],
    assemble: pieces => ({ packed: [...pieces.values()].map(piece => piece.slot).sort() }),
    submit: async value => { report = value; return { accepted: true, count: value.packed.length }; },
  });

  const messages = [
    { role: 'assistant', content: null, tool_calls: [
      { id: 'coat', type: 'function', function: { name: 'record_piece', arguments: JSON.stringify({ type: 'packed-item', slot: 'coat', packed: true }) } },
      { id: 'boots', type: 'function', function: { name: 'record_piece', arguments: JSON.stringify({ type: 'packed-item', slot: 'boots', packed: true }) } },
    ] },
    { role: 'assistant', content: null, tool_calls: [
      { id: 'submit', type: 'function', function: { name: 'submit_report', arguments: '{}' } },
    ] },
    { role: 'assistant', content: 'Packed.' },
  ];
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* consume */ }
    const message = messages.shift();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: 'packing', object: 'chat.completion', created: 1, model: 'packing',
      choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const connection = createOpenAICompatible({ name: 'packing', apiKey: 'offline', baseURL: `http://127.0.0.1:${server.address().port}/v1` });
  const model = await resolveModelConfig(connection.chatModel('packing'));
  const agent = new Agent({ id: 'packing', name: 'Packing', model, instructions: 'Pack.', tools: engine.tools });
  assert.equal((await agent.generate('Pack both items and submit.', { maxSteps: 5 })).text, 'Packed.');
  assert.deepEqual(report, { packed: ['boots', 'coat'] });
});
