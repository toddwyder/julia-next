import { createServer } from 'node:http';
import { join } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { resolveModelConfig } from '@mastra/core/llm';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createReviewerReportRecorder } from '../src/reviewer-report.mjs';
import { durableWrite } from '../src/recording-engine.mjs';

const runDirectory = process.argv[2];
const candidate = 'a'.repeat(40);
const evidence = [{ source: 'diff', quote: 'known quote', reasoning: 'known reason' }];
const input = {
  candidate, digest: 'digest', files: ['a.mjs'], criteria: ['criterion'],
  sources: { diff: 'known quote', 'file:a.mjs': 'known quote', 'test-evidence': 'known quote' },
  scope: { kind: 'initial' },
};
const recorder = await createReviewerReportRecorder({
  input, repoRoot: runDirectory, commit: candidate, runDirectory,
  onProgress: acceptedPieces => durableWrite(failurePath, `${JSON.stringify({
    kind: 'technical-failure', reason: 'reviewer interrupted before submit_report completed', acceptedPieces,
  })}\n`),
  submit: async () => ({ accepted: true }),
});
const failurePath = join(runDirectory, 'verdict.json.failure.json');

let requestCount = 0;
const server = createServer(async (request, response) => {
  for await (const _chunk of request) { /* consume */ }
  requestCount += 1;
  if (requestCount > 1) { process.send?.('pieces-recorded'); return; }
  const pieces = [
    { type: 'header', verdict: 'INCONCLUSIVE', summary: 'summary', approach: 'approach' },
    { type: 'axis', axis: 'standards', status: 'proven', evidence },
    { type: 'axis', axis: 'spec', status: 'proven', evidence },
  ];
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    id: 'interrupt-1', object: 'chat.completion', created: 1, model: 'offline-reviewer',
    choices: [{ index: 0, finish_reason: 'tool_calls', message: {
      role: 'assistant', content: null,
      tool_calls: pieces.map((piece, index) => ({ id: `piece-${index}`, type: 'function', function: { name: 'record_piece', arguments: JSON.stringify(piece) } })),
    } }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  }));
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const connection = createOpenAICompatible({ name: 'offline', apiKey: 'offline', baseURL: `http://127.0.0.1:${server.address().port}/v1` });
const model = await resolveModelConfig(connection.chatModel('offline-reviewer'));
const agent = new Agent({ id: 'interrupt-review', name: 'Interrupt review', instructions: 'Record pieces.', model, tools: recorder.tools });
await agent.generate('Begin.', { maxSteps: 20 });
