import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { resolveModelConfig } from '@mastra/core/llm';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { checkedFetch, commandCodeMetadata, generateRecordedReview } from '../src/reviewer.mjs';

const [fixturePath, rawAnswerPath] = process.argv.slice(2);
const text = await readFile(fixturePath, 'utf8');
const server = createServer(async (request, response) => {
  for await (const _chunk of request) { /* consume the request */ }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    id: 'fixture-interruption',
    object: 'chat.completion',
    created: 1,
    model: 'fixture-reviewer',
    choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'length' }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  }));
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const url = `http://127.0.0.1:${server.address().port}/chat/completions`;
const rawAnswer = {
  rawAnswerPath,
  runId: 'jul223-offline-interruption',
  candidateCommit: '8a0d87cbc9c56458c367a2cd2b6bae4083c48722',
  saved: false,
  responseId: null,
};
const connection = createOpenAICompatible({
  name: 'fixture',
  apiKey: 'offline-fixture',
  baseURL: url.replace('/chat/completions', ''),
  supportsStructuredOutputs: true,
  fetch: (requestUrl, init) => checkedFetch(requestUrl, init, async () => {}, async () => {}, rawAnswer),
  metadataExtractor: commandCodeMetadata,
});
const model = await resolveModelConfig(connection.chatModel('fixture-reviewer'));
const agent = new Agent({ id: 'jul223-interruption', name: 'JUL-223 interruption proof', model, instructions: 'Return the fixture unchanged.' });
try {
  await generateRecordedReview({
    agent,
    prompt: 'Return the fixture.',
    generationOptions: {},
    verdictPath: join(dirname(rawAnswerPath), 'verdict.json'),
    rawAnswer,
    recorder: { recordTechnicalFailure: async (path, reason, details) => writeFile(path, `${JSON.stringify({ kind: 'technical-failure', reason, acceptedPieces: [], ...details })}\n`) },
    submitted: () => null,
  });
} catch { /* parent kills this reviewer process after observing the raw file */ }
await new Promise(() => {});
