import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Agent } from '@mastra/core/agent';
import { resolveModelConfig } from '@mastra/core/llm';
import { createTool } from '@mastra/core/tools';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod/v4';

async function structuredOutputStandIn(t) {
  const requests = [];
  const replies = [
    {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'read-1',
        type: 'function',
        function: { name: 'read_fact', arguments: '{}' },
      }],
    },
    { role: 'assistant', content: '{"verdict":"PASS"}' },
  ];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    const message = replies.shift();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: `stage2-${requests.length}`,
      object: 'chat.completion',
      created: 1,
      model: 'offline-commandcode-stand-in',
      choices: [{
        index: 0,
        message,
        finish_reason: message.tool_calls ? 'tool_calls' : 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {
    requests,
    baseURL: `http://127.0.0.1:${server.address().port}/v1`,
  };
}

test('installed Mastra combines a tool loop with inline structured output on an OpenAI-compatible connection', async t => {
  const api = await structuredOutputStandIn(t);
  let reads = 0;
  const readFact = createTool({
    id: 'read_fact',
    description: 'Read one fixture fact.',
    inputSchema: z.object({}),
    outputSchema: z.object({ fact: z.string() }),
    execute: async () => {
      reads += 1;
      return { fact: 'the candidate passed' };
    },
  });
  const connection = createOpenAICompatible({
    name: 'commandcode-stand-in',
    apiKey: 'offline',
    baseURL: api.baseURL,
    supportsStructuredOutputs: false,
  });
  const model = await resolveModelConfig(connection.chatModel('offline-commandcode-stand-in'));
  const agent = new Agent({
    id: 'jul-223-stage2-structured-output-audit',
    name: 'JUL-223 stage-two structured-output audit',
    instructions: 'Read the fact, then return the requested structured verdict.',
    model,
    tools: { read_fact: readFact },
  });

  const result = await agent.generate('Review the fixture.', {
    maxSteps: 3,
    structuredOutput: {
      schema: z.object({ verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']) }),
      jsonPromptInjection: 'inline',
    },
  });

  assert.equal(reads, 1);
  assert.deepEqual(result.object, { verdict: 'PASS' });
  assert.equal(api.requests.length, 2);
  assert.ok(api.requests.every(request => Array.isArray(request.tools)));
  assert.ok(api.requests.every(request => request.response_format === undefined));
  assert.match(JSON.stringify(api.requests[0].messages), /verdict/);
});
