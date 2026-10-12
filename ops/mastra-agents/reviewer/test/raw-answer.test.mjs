import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent } from '@mastra/core/agent';
import { resolveModelConfig } from '@mastra/core/llm';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { checkedFetch, commandCodeMetadata, generateRecordedReview } from '../src/reviewer.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');

test('the live failure fixtures are copied byte-for-byte', async () => {
  const hash = value => createHash('sha256').update(value).digest('hex');
  assert.equal(hash(await readFile(join(fixtures, 'final-answer.txt'))), 'c415d0040590304874429e1249a7450b3fb5b51d0b28b81dda236adead0486c3');
  assert.equal(hash(await readFile(join(fixtures, 'repaired.json'))), '07d5b297e10a4efa4fde072afd4a4410a53a167ed04cd28fd630df58b3ecac21');
});

async function standIn(text) {
  let requestCount = 0;
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* consume the request */ }
    requestCount += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: `fixture-${requestCount}`,
      object: 'chat.completion',
      created: 1,
      model: 'fixture-reviewer',
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

async function generateFixture(text, rawAnswerPath) {
  const api = await standIn(text);
  try {
    const rawAnswer = {
      rawAnswerPath,
      runId: 'jul223-offline-proof',
      candidateCommit: '8a0d87cbc9c56458c367a2cd2b6bae4083c48722',
      saved: false,
      responseId: null,
    };
    const connection = createOpenAICompatible({
      name: 'fixture', apiKey: 'offline-fixture', baseURL: api.url, supportsStructuredOutputs: true,
      fetch: (url, init) => checkedFetch(url, init, async () => {}, async () => {}, rawAnswer),
      metadataExtractor: commandCodeMetadata,
    });
    const model = await resolveModelConfig(connection.chatModel('fixture-reviewer'));
    const agent = new Agent({ id: 'jul223-offline-proof', name: 'JUL-223 offline proof', model, instructions: 'Return the supplied fixture unchanged.' });
    const recorder = {
      recordTechnicalFailure: async (path, reason, details) => {
        await writeFile(path, `${JSON.stringify({ kind: 'technical-failure', reason, acceptedPieces: [], ...details })}\n`);
      },
    };
    return await generateRecordedReview({
      agent,
      prompt: 'Return the fixture.',
      generationOptions: {},
      verdictPath: join(dirname(rawAnswerPath), 'verdict.json'),
      rawAnswer,
      recorder,
      submitted: () => null,
    });
  } finally {
    await api.close();
  }
}

test('the recorded malformed answer is durable before it becomes a technical failure', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-malformed-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = await readFile(join(fixtures, 'final-answer.txt'), 'utf8');
  const rawAnswerPath = join(directory, 'JUL-223.8a0d87.raw.txt');
  await assert.rejects(generateFixture(fixture, rawAnswerPath), error => {
    assert.match(error.message, /technical failure/i);
    assert.match(error.message, new RegExp(rawAnswerPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    return true;
  });
  assert.equal(await readFile(rawAnswerPath, 'utf8'), fixture);
  const failure = JSON.parse(await readFile(join(directory, 'verdict.json.failure.json'), 'utf8'));
  assert.equal(failure.kind, 'technical-failure');
  assert.equal(failure.rawAnswerPath, rawAnswerPath);
  assert.equal(failure.candidateCommit, '8a0d87cbc9c56458c367a2cd2b6bae4083c48722');
});

test('a valid-looking single-shot JSON answer cannot bypass the recording tools', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-valid-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = await readFile(join(fixtures, 'repaired.json'), 'utf8');
  const rawAnswerPath = join(directory, 'JUL-223.8a0d87.raw.txt');
  await assert.rejects(generateFixture(fixture, rawAnswerPath), /technical failure.*without a successful submit_report/i);
  assert.equal(await readFile(rawAnswerPath, 'utf8'), fixture);
  const failure = JSON.parse(await readFile(join(directory, 'verdict.json.failure.json'), 'utf8'));
  assert.equal(failure.kind, 'technical-failure');
  assert.deepEqual(failure.acceptedPieces, []);
});

test('killing the transport process after the raw answer arrives leaves the complete file', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-interrupt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixturePath = join(fixtures, 'final-answer.txt');
  const rawAnswerPath = join(directory, 'JUL-223.8a0d87.raw.txt');
  const childPath = join(here, '..', 'support', 'raw-answer-interrupt-child.mjs');
  const child = spawn(process.execPath, [childPath, fixturePath, rawAnswerPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode == null) child.kill('SIGKILL'); });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`raw answer was not saved before interruption: ${stderr}`)), 15_000);
    const poll = async () => {
      try { await access(rawAnswerPath); clearTimeout(timeout); resolve(); }
      catch { setTimeout(poll, 20); }
    };
    poll();
  });
  child.kill('SIGKILL');
  await new Promise(resolve => child.once('exit', resolve));
  assert.equal(await readFile(rawAnswerPath, 'utf8'), await readFile(fixturePath, 'utf8'));
});
