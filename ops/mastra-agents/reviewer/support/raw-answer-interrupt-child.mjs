import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Agent } from '@mastra/core/agent';
import { resolveModelConfig } from '@mastra/core/llm';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { checkedFetch, commandCodeMetadata, generateRecordedReview } from '../src/reviewer.mjs';

const [rawAnswerPath] = process.argv.slice(2);
const rawAnswer = {
  rawAnswerPath,
  runId: 'jul223-real-interruption',
  candidateCommit: '8a0d87cbc9c56458c367a2cd2b6bae4083c48722',
  saved: false,
  responseId: null,
};
const connection = createOpenAICompatible({
  name: 'commandcode',
  apiKey: process.env.COMMANDCODE_API_KEY,
  baseURL: 'https://api.commandcode.ai/provider/v1',
  supportsStructuredOutputs: true,
  fetch: (requestUrl, init) => checkedFetch(requestUrl, init, async () => {}, rawAnswer),
  metadataExtractor: commandCodeMetadata,
});
const model = await resolveModelConfig(connection.chatModel('reflection/beam:free'));
const agent = new Agent({ id: 'jul223-interruption', name: 'JUL-223 interruption proof', model, instructions: 'Reply with OK.' });
try {
  await generateRecordedReview({
    agent,
    prompt: 'Reply with OK.',
    generationOptions: {},
    verdictPath: join(dirname(rawAnswerPath), 'verdict.json'),
    rawAnswer,
    recorder: { recordTechnicalFailure: async (path, reason, details) => writeFile(path, `${JSON.stringify({ kind: 'technical-failure', reason, acceptedPieces: [], ...details })}\n`) },
    submitted: () => null,
  });
} catch { /* parent kills this reviewer process after observing the raw file */ }
await new Promise(() => {});
