import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent } from '@mastra/core/agent';
import { resolveModelConfig } from '@mastra/core/llm';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { checkedReview } from '../../../../scripts/julia-delivery-review.mjs';
import { evidenceCitations } from '../src/quote-check.mjs';
import { createReviewerReportRecorder, reviewerEnvelopeText } from '../src/reviewer-report.mjs';
import { checkedFetch } from '../src/reviewer.mjs';

const fixturePath = new URL('./fixtures/repaired.json', import.meta.url);

function inputForFixture(fixture) {
  const sources = {};
  for (const { source, quote } of evidenceCitations(fixture.report)) sources[source] = `${sources[source] ?? ''}\n${quote}`;
  return {
    candidate: fixture.report.candidate,
    digest: fixture.report.inputDigest,
    files: fixture.report.filesReviewed,
    criteria: fixture.report.criteria.map(item => item.criterion),
    sources,
    scope: { kind: 'initial' },
  };
}

function piecesFor(fixture) {
  const report = fixture.report;
  return [
    { type: 'header', verdict: fixture.verdict, summary: report.summary, approach: report.approach },
    { type: 'axis', axis: 'standards', ...report.standards },
    { type: 'axis', axis: 'spec', ...report.spec },
    ...report.criteria.map(item => ({ type: 'criterion', ...item })),
    ...report.files.map(item => ({ type: 'file', ...item })),
    ...report.checks.map(item => ({ type: 'check', ...item })),
    ...report.counterexamples.map((item, index) => ({ type: 'counterexample', index, ...item })),
    { type: 'test-audit', ...report.testAudit },
    ...report.findings.map((item, index) => ({ type: 'finding', index, ...item })),
    ...report.limitations.map((text, index) => ({ type: 'limitation', index, text })),
    { type: 'collection-complete', collection: 'counterexamples' },
    { type: 'collection-complete', collection: 'findings' },
    { type: 'collection-complete', collection: 'limitations' },
  ];
}

async function scriptedServer(responses) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    const message = responses.shift();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: `offline-${requests.length}`, object: 'chat.completion', created: 1, model: 'offline-reviewer',
      choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    requests,
    baseURL: `http://127.0.0.1:${server.address().port}/v1`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

const call = (id, name, argumentsValue) => ({ id, type: 'function', function: { name, arguments: argumentsValue } });
const toolMessage = tool_calls => ({ role: 'assistant', content: null, tool_calls });

test('real Agent.generate records a complete review and recovers each scripted report failure', async t => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const input = inputForFixture(fixture);
  const directory = await mkdtemp(join(tmpdir(), 'jul223-recorded-review-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let submitted;
  let rawSeenBeforeVerdict;
  const verdictPath = join(directory, 'verdict.json');
  const rawAnswer = { rawAnswerPath: join(directory, 'raw.txt'), saved: false, responseId: null };
  const recorder = await createReviewerReportRecorder({
    input,
    repoRoot: directory,
    commit: input.candidate,
    runDirectory: directory,
    submit: async envelope => {
      rawSeenBeforeVerdict = await readFile(rawAnswer.rawAnswerPath, 'utf8');
      submitted = envelope;
      await writeFile(verdictPath, `${JSON.stringify({ text: reviewerEnvelopeText(envelope) })}\n`);
      return { accepted: true, verdict: envelope.verdict };
    },
  });

  const allPieces = piecesFor(fixture);
  const badFile = { ...allPieces.find(piece => piece.type === 'file'), file: 'github/workflows/ci.yml' };
  const badQuote = structuredClone(allPieces.find(piece => piece.type === 'axis' && piece.axis === 'standards'));
  badQuote.evidence[0].quote = 'quote that is not in the candidate';
  const header = allPieces.find(piece => piece.type === 'header');
  const correctedFile = allPieces.find(piece => piece.type === 'file' && piece.file === '.github/workflows/ci.yml');
  const standards = allPieces.find(piece => piece.type === 'axis' && piece.axis === 'standards');
  const correctedKeys = new Set([header, correctedFile, standards]);
  const remainingPieces = allPieces.filter(piece => !correctedKeys.has(piece));
  const responses = [
    toolMessage([call('malformed', 'record_piece', '{"type">No: "header"}')]),
    toolMessage([call('correct-header', 'record_piece', JSON.stringify(header))]),
    toolMessage([call('bad-file', 'record_piece', JSON.stringify(badFile))]),
    toolMessage([call('correct-file', 'record_piece', JSON.stringify(correctedFile))]),
    toolMessage([call('bad-quote', 'record_piece', JSON.stringify(badQuote))]),
    toolMessage([call('correct-quote', 'record_piece', JSON.stringify(standards))]),
    toolMessage([call('early-submit', 'submit_report', '{}')]),
    toolMessage(remainingPieces.map((piece, index) => call(`piece-${index}`, 'record_piece', JSON.stringify(piece)))),
    toolMessage([call('submit', 'submit_report', '{}')]),
    { role: 'assistant', content: 'The report was submitted from its recorded pieces.' },
  ];
  const api = await scriptedServer(responses);
  t.after(() => api.close());
  const connection = createOpenAICompatible({
    name: 'offline', apiKey: 'offline', baseURL: api.baseURL,
    fetch: (url, init) => checkedFetch(url, init, async () => {}, async () => {}, rawAnswer),
  });
  const model = await resolveModelConfig(connection.chatModel('offline-reviewer'));
  const agent = new Agent({
    id: 'jul223-recorded-review', name: 'JUL-223 recorded review', model,
    instructions: 'Record small pieces, correct tool errors, and submit.', tools: recorder.tools,
  });
  const result = await agent.generate('Record the review.', { maxSteps: 20 });

  assert.equal(result.text, 'The report was submitted from its recorded pieces.');
  assert.match(rawSeenBeforeVerdict, /"name":"submit_report"/);
  assert.deepEqual(submitted, fixture);
  const durableVerdict = JSON.parse(await readFile(verdictPath, 'utf8'));
  assert.deepEqual(JSON.parse(durableVerdict.text.slice(durableVerdict.text.indexOf('REVIEW: ') + 8)), fixture.report);
  assert.match(JSON.parse(api.requests[1].messages.find(message => message.tool_call_id === 'malformed').content).message, /Tool input validation failed/);
  assert.match(JSON.parse(api.requests[3].messages.find(message => message.tool_call_id === 'bad-file').content).message, /Invalid option.*\.github\/workflows\/ci\.yml/);
  assert.deepEqual(JSON.parse(api.requests[5].messages.find(message => message.tool_call_id === 'bad-quote').content), {
    error: true, message: 'Evidence quote was not found word for word in standards: quote that is not in the candidate',
  });
  assert.match(JSON.parse(api.requests[7].messages.find(message => message.tool_call_id === 'early-submit').content).message, /Report is incomplete\. Missing:/);
  assert.deepEqual(checkedReview(reviewerEnvelopeText(submitted), input), { error: 'inconclusive review: reviewer could not establish a verdict' });
});

test('real Agent.generate records and submits the repair-report shape', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-recorded-repair-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const candidate = 'b'.repeat(40);
  const input = {
    candidate, digest: 'repair-digest', files: ['a.mjs', 'initial-only.mjs'], criteria: ['unused in repair mode'],
    sources: {
      'prior-review': 'finding F1 says old code is broken',
      'repair-file:a.mjs': 'export const fixed = true;',
    },
    scope: { kind: 'repair', findings: [{ id: 'F1', finding: {} }], files: ['a.mjs'] },
  };
  const prior = { source: 'prior-review', quote: 'finding F1 says old code is broken', reasoning: 'Identifies the prior finding.' };
  const code = { source: 'repair-file:a.mjs', quote: 'export const fixed = true;', reasoning: 'Shows the repaired code.' };
  const expected = {
    verdict: 'PASS',
    report: {
      filesReviewed: ['a.mjs', 'initial-only.mjs'], candidate, inputDigest: input.digest, summary: 'The repair is proven.',
      repairedFindings: [{ id: 'F1', status: 'proven', evidence: [prior, code] }],
      regressions: [{ file: 'a.mjs', status: 'proven', evidence: [code] }],
      findings: [], limitations: [],
    },
  };
  let submitted;
  const recorder = await createReviewerReportRecorder({
    input, repoRoot: directory, commit: candidate, runDirectory: directory,
    submit: async envelope => { submitted = envelope; return { accepted: true, verdict: envelope.verdict }; },
  });
  const pieces = [
    { type: 'header', verdict: 'PASS', summary: 'The repair is proven.' },
    { type: 'repaired-finding', id: 'F1', status: 'proven', evidence: [prior, code] },
    { type: 'regression', file: 'a.mjs', status: 'proven', evidence: [code] },
    { type: 'collection-complete', collection: 'findings' },
    { type: 'collection-complete', collection: 'limitations' },
  ];
  const api = await scriptedServer([
    toolMessage(pieces.map((piece, index) => call(`repair-${index}`, 'record_piece', JSON.stringify(piece)))),
    toolMessage([call('repair-submit', 'submit_report', '{}')]),
    { role: 'assistant', content: 'Repair report submitted.' },
  ]);
  t.after(() => api.close());
  const connection = createOpenAICompatible({ name: 'repair', apiKey: 'offline', baseURL: api.baseURL });
  const model = await resolveModelConfig(connection.chatModel('offline-reviewer'));
  const agent = new Agent({ id: 'repair-review', name: 'Repair review', model, instructions: 'Record and submit.', tools: recorder.tools });

  assert.equal((await agent.generate('Review the repair.', { maxSteps: 5 })).text, 'Repair report submitted.');
  assert.deepEqual(submitted, expected);
  assert.deepEqual(checkedReview(reviewerEnvelopeText(submitted), input), { verdict: 'PASS', report: expected.report });
});

test('a rejected piece cannot add serialized-quote repair audit metadata', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-repair-audit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const serializedQuoteRepairs = [];
  const input = {
    candidate: 'c'.repeat(40), digest: 'digest', files: ['a.mjs'], criteria: ['criterion'],
    sources: { diff: 'escaped\\nquote valid', 'file:a.mjs': 'valid', 'test-evidence': 'valid' },
    scope: { kind: 'initial' },
  };
  const recorder = await createReviewerReportRecorder({
    input, repoRoot: directory, commit: input.candidate, runDirectory: directory, serializedQuoteRepairs,
    submit: async () => ({ accepted: true }),
  });
  const base = { type: 'axis', axis: 'standards', status: 'proven' };
  const repairable = { source: 'diff', quote: 'escaped\nquote', reasoning: 'Serialized transport quote.' };
  const rejected = await recorder.tools.record_piece.execute({
    ...base, evidence: [repairable, { source: 'diff', quote: 'missing', reasoning: 'Forces rejection.' }],
  });
  assert.equal(rejected.error, true);
  assert.deepEqual(serializedQuoteRepairs, []);

  assert.deepEqual(await recorder.tools.record_piece.execute({ ...base, evidence: [repairable] }), { accepted: true, key: 'axis:standards' });
  assert.deepEqual(serializedQuoteRepairs, [{ source: 'diff', before: 'escaped\nquote', after: 'escaped\\nquote' }]);
});

test('interruption keeps accepted pieces and records their names in the technical failure', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'jul223-recorded-interrupt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const childPath = fileURLToPath(new URL('../support/recorded-review-interrupt-child.mjs', import.meta.url));
  const child = spawn(process.execPath, [childPath, directory], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode == null) child.kill('SIGKILL'); });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const piecesDirectory = join(directory, 'pieces');
  const failurePath = join(directory, 'verdict.json.failure.json');
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`pieces were not durable before interruption: ${stderr}`)), 15_000);
    const poll = async () => {
      try {
        if ((await readdir(piecesDirectory)).length >= 3) {
          const failure = JSON.parse(await readFile(failurePath, 'utf8'));
          if (failure.acceptedPieces.length >= 3) { clearTimeout(timeout); resolve(); return; }
        }
      } catch { /* child has not recorded yet */ }
      setTimeout(poll, 20);
    };
    poll();
  });
  child.kill('SIGKILL');
  await new Promise(resolve => child.once('exit', resolve));
  const failure = JSON.parse(await readFile(failurePath, 'utf8'));
  assert.equal(failure.kind, 'technical-failure');
  assert.match(failure.reason, /interrupted/);
  assert.deepEqual(failure.acceptedPieces, ['axis:spec', 'axis:standards', 'header']);
  assert.equal((await readdir(piecesDirectory)).length, 3);
});
