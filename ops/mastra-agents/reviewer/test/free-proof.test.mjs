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
import { checkedReview, reviewInput } from '../../../../scripts/julia-delivery-review.mjs';

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
  const observations = [];
  const contracts = [];
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
        const contract = contracts[review];
        review += 1;
        const requestText = JSON.stringify(body.messages ?? []);
        const hasWorkingMemory = requestText.includes('No arbitrary caps or limits; flag any new one.');
        const hasPriorReview = review === 1 || requestText.includes('first-review-memory-marker');
        observations.push({ review, hasWorkingMemory, hasPriorReview });
        value.verdict = hasWorkingMemory && hasPriorReview ? 'PASS' : 'INCONCLUSIVE';
        const codeEvidence = [{ source: 'diff', quote: 'violet arbitrary run cap', reasoning: 'The immutable diff exposes the arbitrary cap behavior under review.' }];
        const testEvidence = { source: 'test-evidence', quote: 'deterministic stand-in checks passed', reasoning: 'The saved runner evidence records the deterministic check result.' };
        const combinedEvidence = [...codeEvidence, testEvidence];
        value.report = {
          filesReviewed: ['candidate.mjs'],
          candidate: contract.candidate, inputDigest: contract.digest,
          approach: 'Read the immutable diff, apply the standing cap rule, and challenge the saved check evidence.',
          standards: { status: 'proven', evidence: codeEvidence },
          spec: { status: 'proven', evidence: combinedEvidence },
          criteria: contract.criteria.map(criterion => ({ criterion, status: 'proven', evidence: codeEvidence })),
          files: contract.files.map(file => ({ file, status: 'proven', evidence: [{ source: `file:${file}`, quote: 'violet arbitrary run cap', reasoning: 'The committed file contains the reviewed behavior.' }] })),
          checks: [1, 2, 5].map(check => ({ check, status: 'proven', evidence: combinedEvidence })).concat([
            { check: 3, status: 'not-applicable', reason: 'The reviewer has no household-facing UI.', evidence: combinedEvidence },
            { check: 4, status: 'not-applicable', reason: 'The reviewer has no browser surface.', evidence: combinedEvidence },
          ]),
          counterexamples: ['missing cap rule', 'missing checked result'].map(scenario => ({ scenario, method: 'deterministic request inspection', result: 'The stand-in refuses PASS when required memory is absent.', evidence: combinedEvidence })),
          testAudit: { analysis: 'The proof checks request causality, exact file coverage, trace content, persistence, and the cost brake.', evidence: combinedEvidence },
          summary: review === 1 ? 'first-review-memory-marker applied the standing rule against arbitrary run caps' : 'review 2 retrieved first-review-memory-marker and applied the standing rule against arbitrary run caps', findings: [],
          limitations: [],
        };
      }
      message = { role: 'assistant', content: JSON.stringify(value) };
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: `standin-${requests.length}`, object: 'chat.completion', created: 1, model: 'deepseek/deepseek-v4.1-flash', choices: [{ index: 0, message, finish_reason: finishReason }], usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, cost: { total: 0.15 } } }));
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  return { server, requests, observations, contracts, baseURL: `http://127.0.0.1:${server.address().port}/v1` };
}

async function candidateRepository(root) {
  await mkdir(root, { recursive: true });
  const git = (...args) => exec('git', args, { cwd: root, windowsHide: true });
  await git('init', '-q');
  await git('config', 'user.email', 'reviewer-proof@example.invalid');
  await git('config', 'user.name', 'Reviewer Proof');
  await writeFile(join(root, 'CODING_STANDARDS.md'), '# Fixture standards\nNo arbitrary caps.\n');
  await writeFile(join(root, 'candidate.mjs'), 'export const reviewerPolicy = "no cap";\n');
  await git('add', 'CODING_STANDARDS.md', 'candidate.mjs');
  await git('commit', '-q', '-m', 'base');
  const base = (await git('rev-parse', 'HEAD')).stdout.trim();
  await writeFile(join(root, 'candidate.mjs'), 'export const reviewerPolicy = "violet arbitrary run cap";\n');
  await git('commit', '-q', '-am', 'candidate one');
  const first = (await git('rev-parse', 'HEAD')).stdout.trim();
  await writeFile(join(root, 'candidate.mjs'), 'export const reviewerPolicy = "violet arbitrary run cap with lasting logging";\n');
  await git('commit', '-q', '-am', 'candidate two');
  const second = (await git('rev-parse', 'HEAD')).stdout.trim();
  await writeFile(join(root, 'candidate.mjs'), 'export const reviewerPolicy = "violet arbitrary run cap with lasting logging and cost control";\n');
  await git('commit', '-q', '-am', 'candidate three');
  const third = (await git('rev-parse', 'HEAD')).stdout.trim();
  return { base, first, second, third };
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
  const candidatePath = join(directory, 'candidate');
  const card = { description: '# Acceptance criteria\n- [ ] No arbitrary run cap\n', comments: { nodes: [], pageInfo: { hasNextPage: false } } };
  const run = async (commit, number) => {
    await exec('git', ['checkout', '--detach', '-q', commit], { cwd: candidatePath, windowsHide: true });
    const diff = (await exec('git', ['diff', '--binary', `${candidate.base}...${commit}`], { cwd: candidatePath, windowsHide: true })).stdout.trim();
    const checkedCandidate = { base: candidate.base, commit, diff, files: ['candidate.mjs'], runs: [{ status: 0, output: 'deterministic stand-in checks passed' }] };
    const input = reviewInput(card, checkedCandidate, { path: candidatePath });
    api.contracts.push(input);
    const result = await launcher('reviewer', {
      mastraReviewOnly: true, issueId: 'JUL-206', repoRoot: candidatePath, candidate: { base: candidate.base, commit }, reviewInput: input,
      configuration, outputPath: join(evidence, `run-${number}.json`), started: async () => {},
    });
    return { result, input };
  };

  const firstRun = await run(candidate.first, 1);
  const secondRun = await run(candidate.second, 2);
  assert.equal(firstRun.result.exitCode, 0, firstRun.result.text);
  assert.equal(secondRun.result.exitCode, 0, secondRun.result.text);
  const verdicts = await Promise.all([1, 2].map(number => readFile(join(evidence, `run-${number}.json.verdict.json`), 'utf8').then(JSON.parse)));
  assert.deepEqual(verdicts.map(result => result.text.match(/^VERDICT: (\w+)/)?.[1]), ['PASS', 'PASS']);
  assert.deepEqual([checkedReview(verdicts[0].text, firstRun.input).verdict, checkedReview(verdicts[1].text, secondRun.input).verdict], ['PASS', 'PASS']);
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
    const costAggregate = await metricStore.getMetricAggregate({ name: ['mastra_model_total_input_tokens', 'mastra_model_total_output_tokens'], aggregation: 'sum', filters: { entityType: 'agent', userId: 'JUL-206' } });
    await metricStore.close?.(); await duck.close();
    const traceText = JSON.stringify(traces);
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
      costAggregate,
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
  assert.ok(readback.costAggregate.estimatedCost > 0, JSON.stringify(readback.costAggregate));
  assert.match(readback.workingMemory, /No arbitrary caps or limits; flag any new one\./);
  assert.deepEqual(api.observations, [
    { review: 1, hasWorkingMemory: true, hasPriorReview: true },
    { review: 2, hasWorkingMemory: true, hasPriorReview: true },
  ]);
  assert.ok(api.requests.some(body => body.tools?.some(tool => tool.function?.name === 'read_candidate_diff')), 'the model must receive the real read-only reviewer tool');

  configuration.costCeilingUsd = readback.costAggregate.estimatedCost / 2;
  const blocked = await run(candidate.third, 3);
  assert.equal(blocked.result.exitCode, 2, blocked.result.text);
  assert.match(blocked.result.text, /cost|limit|budget/i);
  await assert.rejects(readFile(join(evidence, 'run-3.json.verdict.json'), 'utf8'), /ENOENT/);
  await writeFile(join(directory, 'acceptance-evidence.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(), candidate, verdicts, readback,
    costControl: { accumulatedCost: readback.costAggregate.estimatedCost, configuredLimit: configuration.costCeilingUsd, blocked: true },
    databases: { memoryAndTraces: memoryPath, costs: costPath },
  }, null, 2)}\n`);
});
