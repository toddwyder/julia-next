import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Agent } from '@mastra/core/agent';
import { resolveModelConfig } from '@mastra/core/llm';
import { createTool } from '@mastra/core/tools';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';

const changedFiles = ['.github/workflows/ci.yml', 'playwright.config.mjs', 'scripts/ci-routing.mjs', 'scripts/ci-routing.test.mjs'];
const correctedInput = { file: changedFiles[0], status: 'proven', quote: 'known quote' };

// Adapted from .artifacts/jul-223-step3b/13-part1-T-13.response.json.
const malformedArguments = '{"file">No: [".github/workflows/ci.yml"],"status":"proven","quote":"known quote"}';
// The missing-dot value from .artifacts/jul-223-step3b/48-part3-T-4.response.json.
const schemaInvalidArguments = JSON.stringify({ file: 'github/workflows/ci.yml', status: 'proven', quote: 'known quote' });
const rejectedQuote = 'quote absent from candidate';

const cases = [
  { id: '01-malformed', firstArguments: malformedArguments, strict: false, firstExecuteRuns: false },
  { id: '02-schema-invalid', firstArguments: schemaInvalidArguments, strict: false, firstExecuteRuns: false },
  { id: '03-execute-rejected', firstArguments: JSON.stringify({ ...correctedInput, quote: rejectedQuote }), strict: false, firstExecuteRuns: true },
  { id: '04-malformed-strict', firstArguments: malformedArguments, strict: true, firstExecuteRuns: false },
  { id: '05-schema-invalid-strict', firstArguments: schemaInvalidArguments, strict: true, firstExecuteRuns: false },
];

async function standIn(firstArguments) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    requests.push(JSON.parse(raw));
    const number = requests.length;
    const message = number <= 2
      ? {
          role: 'assistant', content: null,
          tool_calls: [{
            id: `record-${number}`, type: 'function',
            function: { name: 'record_item', arguments: number === 1 ? firstArguments : JSON.stringify(correctedInput) },
          }],
        }
      : { role: 'assistant', content: 'recorded after correction' };
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: `standin-${number}`, object: 'chat.completion', created: 1, model: 'fixture-model',
      choices: [{ index: 0, message, finish_reason: number <= 2 ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }));
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  return {
    requests,
    baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    close: () => new Promise(done => server.close(done)),
  };
}

function firstToolResult(requests) {
  return requests[1]?.messages?.find(message => message.role === 'tool' && message.tool_call_id === 'record-1')?.content ?? null;
}

async function runCase(spec) {
  const api = await standIn(spec.firstArguments);
  const executions = [];
  let result;
  let thrown;
  try {
    const recordItem = createTool({
      id: 'record_item', description: 'Record one review item.', strict: spec.strict,
      inputSchema: z.object({ file: z.enum(changedFiles), status: z.enum(['proven', 'failed', 'unverified']), quote: z.string() }),
      execute: async input => {
        executions.push(input);
        return input.quote === rejectedQuote ? `quote not found in file ${input.file}` : `recorded ${input.file}`;
      },
    });
    const connection = createOpenAICompatible({ name: 'standin', apiKey: 'offline', baseURL: api.baseURL });
    const model = await resolveModelConfig(connection.chatModel('fixture-model'));
    const agent = new Agent({
      id: `jul223-step3c-${spec.id}`, name: 'JUL-223 step 3c',
      instructions: 'Use record_item, correct any failed call, then finish.', model,
      tools: { record_item: recordItem },
    });
    try { result = await agent.generate('Record the item.'); }
    catch (error) { thrown = error; }
  } finally {
    await api.close();
  }
  return { requests: api.requests, executions, result, thrown, toolResultText: firstToolResult(api.requests) };
}

test('real Mastra generate reports bad tool calls to the model and accepts a corrected call', async () => {
  const observations = new Map();
  for (const spec of cases) {
    const observed = await runCase(spec);
    observations.set(spec.id, observed);

    assert.equal(observed.thrown, undefined, `${spec.id} should return rather than throw`);
    assert.equal(observed.requests.length, 3, `${spec.id} should make one correction request and one final request`);
    assert.equal(observed.result.text, 'recorded after correction');
    assert.equal(observed.executions.length, spec.firstExecuteRuns ? 2 : 1);
    assert.deepEqual(observed.executions.at(-1), correctedInput);
    assert.equal(observed.requests[0].tools[0].function.strict, spec.strict);
    assert.ok(observed.toolResultText, `${spec.id} should send the first tool result to the model`);

  }

  const enumMessage = 'Invalid option: expected one of ".github/workflows/ci.yml"|"playwright.config.mjs"|"scripts/ci-routing.mjs"|"scripts/ci-routing.test.mjs"';
  const malformedError = JSON.parse(observations.get('01-malformed').toolResultText);
  assert.equal(malformedError.message, [
    'Tool input validation failed for record_item. Please fix the following errors and try again:',
    `- file: ${enumMessage}`,
    '- status: Invalid option: expected one of "proven"|"failed"|"unverified"',
    '- quote: Invalid input: expected string, received undefined',
    '',
    'Provided arguments: {}',
  ].join('\n'));
  const schemaInvalidError = JSON.parse(observations.get('02-schema-invalid').toolResultText);
  assert.equal(schemaInvalidError.message, [
    'Tool input validation failed for record_item. Please fix the following errors and try again:',
    `- file: ${enumMessage}`,
    '',
    `Provided arguments: ${JSON.stringify({ file: 'github/workflows/ci.yml', status: 'proven', quote: 'known quote' }, null, 2)}`,
  ].join('\n'));
  assert.equal(observations.get('03-execute-rejected').toolResultText, 'quote not found in file .github/workflows/ci.yml');
  assert.equal(observations.get('04-malformed-strict').toolResultText, observations.get('01-malformed').toolResultText);
  assert.equal(observations.get('05-schema-invalid-strict').toolResultText, observations.get('02-schema-invalid').toolResultText);
});
