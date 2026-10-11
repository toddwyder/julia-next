import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { productionLauncher } from '../../../../scripts/julia-delivery-runner.mjs';

const exec = promisify(execFile);
const testRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testRoot, '..', '..', '..', '..');

function schemaValue(schema = {}) {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.anyOf?.length) return schemaValue(schema.anyOf.find(entry => entry.type !== 'null') ?? schema.anyOf[0]);
  if (schema.type === 'object' || schema.properties) return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, value]) => [key, schemaValue(value)]));
  if (schema.type === 'array') return [];
  if (schema.type === 'boolean') return false;
  if (schema.type === 'number' || schema.type === 'integer') return 0;
  return '';
}

async function standInServer() {
  let review = 0;
  const requests = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    const candidateTool = body.tools?.find(tool => tool.function?.name === 'read_candidate_diff');
    const hasToolResult = body.messages?.some(message => message.role === 'tool');
    let message;
    let finishReason = 'stop';
    if (candidateTool && !hasToolResult) {
      message = { role: 'assistant', content: null, tool_calls: [{ id: `read-${requests.length}`, type: 'function', function: { name: 'read_candidate_diff', arguments: '{}' } }] };
      finishReason = 'tool_calls';
    } else {
      const schema = body.response_format?.json_schema?.schema;
      const value = schemaValue(schema);
      if (schema?.properties?.verdict) {
        review += 1;
        value.verdict = 'PASS';
        value.report = {
          summary: `review ${review} applied the standing rule against arbitrary run caps`, findings: [],
          criteria: [{ id: 'AC1', verdict: 'met', how: 'read_candidate_diff returned the immutable candidate diff', evidence: [{ source: 'file:candidate.mjs', quote: 'violet arbitrary run cap' }] }],
        };
      }
      message = { role: 'assistant', content: JSON.stringify(value) };
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: `standin-${requests.length}`, object: 'chat.completion', created: 1, model: 'deepseek/deepseek-v4.1-flash', choices: [{ index: 0, message, finish_reason: finishReason }], usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, cost: { total: 0 } } }));
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  return { server, requests, baseURL: `http://127.0.0.1:${server.address().port}/v1` };
}

async function candidateRepository(root) {
  await mkdir(root, { recursive: true });
  const git = (...args) => exec('git', args, { cwd: root, windowsHide: true });
  await git('init', '-q');
  await git('config', 'user.email', 'reviewer-proof@example.invalid');
  await git('config', 'user.name', 'Reviewer Proof');
  await writeFile(join(root, 'candidate.mjs'), 'export const reviewerPolicy = "no cap";\n');
  await git('add', 'candidate.mjs');
  await git('commit', '-q', '-m', 'base');
  const base = (await git('rev-parse', 'HEAD')).stdout.trim();
  await writeFile(join(root, 'candidate.mjs'), 'export const reviewerPolicy = "violet arbitrary run cap";\n');
  await git('commit', '-q', '-am', 'candidate one');
  const first = (await git('rev-parse', 'HEAD')).stdout.trim();
  await writeFile(join(root, 'candidate.mjs'), 'export const reviewerPolicy = "violet arbitrary run cap with lasting logging";\n');
  await git('commit', '-q', '-am', 'candidate two');
  const second = (await git('rev-parse', 'HEAD')).stdout.trim();
  return { base, first, second };
}

test('runner starts the real reviewer twice and preserves verdict, trace, working memory, semantic recall, and both databases', { timeout: 300_000 }, async t => {
  const proofRoot = process.env.MASTRA_REVIEWER_PROOF_DIR;
  if (proofRoot) await mkdir(proofRoot, { recursive: true });
  const directory = await mkdtemp(join(proofRoot ? resolve(proofRoot) : tmpdir(), 'julia-reviewer-free-proof-'));
  const api = await standInServer();
  t.after(async () => { await new Promise(done => api.server.close(done)); if (!proofRoot) await rm(directory, { recursive: true, force: true }); });
  const candidate = await candidateRepository(join(directory, 'candidate'));
  const data = join(directory, 'data');
  const evidence = join(directory, 'evidence');
  await mkdir(evidence, { recursive: true });
  const configuration = {
    model: 'deepseek/deepseek-v4.1-flash', maker: 'DeepSeek', harness: 'mastra-commandcode',
    connection: { provider: 'commandcode' }, costCeilingUsd: 1, baseURL: api.baseURL, storageDirectory: data,
  };
  const launcher = productionLauncher(repositoryRoot, { environment: { ...process.env, COMMANDCODE_API_KEY: 'free-proof', MASTRA_REVIEWER_STANDIN: '1' } });
  const run = async (commit, number) => launcher('reviewer', {
    mastraReviewOnly: true, issueId: 'JUL-206', repoRoot: join(directory, 'candidate'), candidate: { base: candidate.base, commit },
    reviewInput: { candidate: { base: candidate.base, commit }, criteria: [{ id: 'AC1', text: 'No arbitrary run cap' }], files: ['candidate.mjs'], scope: 'free proof', sources: { specification: 'Flag arbitrary caps. The violet policy is relevant across reviews.', 'test-evidence': 'deterministic stand-in' } },
    configuration, outputPath: join(evidence, `run-${number}.json`), started: async () => {},
  });

  const first = await run(candidate.first, 1);
  const second = await run(candidate.second, 2);
  assert.equal(first.exitCode, 0, first.text);
  assert.equal(second.exitCode, 0, second.text);
  const verdicts = await Promise.all([1, 2].map(number => readFile(join(evidence, `run-${number}.json.verdict.json`), 'utf8').then(JSON.parse)));
  assert.deepEqual(verdicts.map(result => result.text.match(/^VERDICT: (\w+)/)?.[1]), ['PASS', 'PASS']);
  assert.equal(verdicts[0].evidence.resourceId, verdicts[1].evidence.resourceId);
  assert.notEqual(verdicts[0].evidence.threadId, verdicts[1].evidence.threadId);
  assert.match(verdicts[0].text, /standing rule against arbitrary run caps/);
  assert.ok(verdicts[1].evidence.semanticMatches.some(match => /violet|arbitrary run cap/i.test(match.text)), JSON.stringify(verdicts[1].evidence.semanticMatches));

  const memoryPath = join(data, 'reviewer.db');
  const costPath = join(data, 'reviewer-costs.duckdb');
  assert.ok((await readFile(memoryPath)).length > 0);
  assert.ok((await readFile(costPath)).length > 0);
  const readbackProgram = `
    import { LibSQLStore } from '@mastra/libsql';
    import { DuckDBStore } from '@mastra/duckdb';
    import { Memory } from '@mastra/memory';
    const [memoryPath, costPath, traceIds, threadId, resourceId] = process.argv.slice(1);
    const memory = new LibSQLStore({ id: 'proof-memory-readback', url: 'file:' + memoryPath.replaceAll('\\\\', '/') });
    const traceStore = await memory.getStore('observability');
    const traces = await Promise.all(JSON.parse(traceIds).map(traceId => traceStore.getTrace({ traceId })));
    const memoryApi = new Memory({ storage: memory, options: { workingMemory: { enabled: true, scope: 'resource' } } });
    const workingMemory = await memoryApi.getWorkingMemory({ threadId, resourceId });
    await traceStore.close?.(); await memory.close();
    const duck = new DuckDBStore({ id: 'proof-cost-readback', path: costPath });
    const metricStore = await duck.getStore('observability');
    const metrics = await metricStore.listMetrics({ pagination: { page: 0, perPage: 100 } });
    await metricStore.close?.(); await duck.close();
    const traceText = JSON.stringify(traces);
    const metricText = JSON.stringify(metrics);
    const tokenCostFields = (value, path = '', found = []) => {
      if (found.length >= 40 || value == null) return found;
      if (typeof value !== 'object') {
        if (/token|cost/i.test(path)) found.push({ path, value });
        return found;
      }
      for (const [key, child] of Object.entries(value)) tokenCostFields(child, path ? path + '.' + key : key, found);
      return found;
    };
    console.log(JSON.stringify({
      traceCount: traces.filter(Boolean).length,
      traceIds: traces.map(trace => trace?.traceId),
      hasToolContent: traceText.includes('read_candidate_diff'),
      hasTokenContent: /promptTokens|inputTokens|prompt_tokens|input_tokens/i.test(traceText),
      hasNumericStepCost: traces.every(trace => tokenCostFields(trace).some(field => /estimatedCost$/.test(field.path) && typeof field.value === 'number')),
      metricCount: metrics.metrics?.length ?? 0,
      hasCostMetric: /cost/i.test(metricText),
      metricNames: (metrics.metrics ?? []).map(metric => metric.name),
      workingMemory,
      steps: traces.map(trace => trace.spans.map(span => ({ name: span.name, type: span.spanType, tokenCost: tokenCostFields(span) }))),
    }));
  `;
  const readbackOutput = await exec(process.execPath, ['--input-type=module', '-e', readbackProgram, memoryPath, costPath, JSON.stringify(verdicts.map(result => result.traceId)), verdicts[0].evidence.threadId, verdicts[0].evidence.resourceId], { cwd: resolve(testRoot, '..'), windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const readback = JSON.parse(readbackOutput.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(readback.traceCount, 2, 'both saved trace IDs must read back from LibSQL');
  assert.equal(readback.hasToolContent, true);
  assert.equal(readback.hasTokenContent, true);
  assert.equal(readback.hasNumericStepCost, true, JSON.stringify(readback.steps));
  assert.ok(readback.metricCount > 0, 'DuckDB must retain automatic cost/token metrics');
  assert.equal(readback.hasCostMetric, true, JSON.stringify(readback.metricNames));
  assert.match(readback.workingMemory, /No arbitrary caps or limits; flag any new one\./);
  assert.ok(api.requests.some(body => body.tools?.some(tool => tool.function?.name === 'read_candidate_diff')), 'the model must receive the real read-only reviewer tool');
  await writeFile(join(directory, 'acceptance-evidence.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(), candidate, verdicts, readback,
    databases: { memoryAndTraces: memoryPath, costs: costPath },
  }, null, 2)}\n`);
});
