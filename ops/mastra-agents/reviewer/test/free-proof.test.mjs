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
  const reportedCosts = [];
  const observations = [];
  const contracts = [];
  let failNext = false;
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/alpha/usage/summary') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        totalCount: reportedCosts.length,
        totalCost: reportedCosts.reduce((sum, cost) => sum + cost, 0),
        totalTokensIn: requests.length * 120,
        totalTokensOut: requests.length * 30,
      }));
      return;
    }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    if (failNext) {
      failNext = false;
      reportedCosts.push(0.15);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: `standin-${requests.length}`, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }] }));
      return;
    }
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
    reportedCosts.push(0.15);
    response.end(JSON.stringify({ id: `standin-${requests.length}`, object: 'chat.completion', created: 1, model: 'deepseek/deepseek-v4.1-flash', choices: [{ index: 0, message, finish_reason: finishReason }], usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 } }));
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { server, requests, reportedCosts, observations, contracts, failOnce: () => { failNext = true; }, baseURL: `${origin}/v1`, usageBaseURL: origin };
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
    connection: { provider: 'commandcode' }, costCeilingUsd: 1, baseURL: api.baseURL, usageBaseURL: api.usageBaseURL, storageDirectory: data,
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
      configuration, round: number, outputPath: join(evidence, `run-${number}.json`), started: async () => {},
    });
    return { result, input };
  };

  await exec('git', ['checkout', '--detach', '-q', candidate.first], { cwd: candidatePath, windowsHide: true });
  const invalidDiff = (await exec('git', ['diff', '--binary', `${candidate.base}...${candidate.first}`], { cwd: candidatePath, windowsHide: true })).stdout.trim();
  const invalidInput = reviewInput(card, { base: candidate.base, commit: candidate.first, diff: invalidDiff, files: ['candidate.mjs'], runs: [{ status: 0, output: 'fixture' }] }, { path: candidatePath });
  invalidInput.candidate = candidate.second;
  const invalidResult = await launcher('reviewer', {
    mastraReviewOnly: true, issueId: 'JUL-206', repoRoot: candidatePath, candidate: { base: candidate.base, commit: candidate.first }, reviewInput: invalidInput,
    configuration, round: 0, outputPath: join(evidence, 'run-0.json'), started: async () => {},
  });
  assert.equal(invalidResult.exitCode, 2, invalidResult.text);
  assert.match(invalidResult.text, /identity is incomplete/i);
  await assert.rejects(readFile(join(evidence, 'run-0.json.verdict.json'), 'utf8'), /ENOENT/);

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

  configuration.costCeilingUsd = 10;
  api.failOnce();
  const ambiguous = await run(candidate.third, 4);
  assert.equal(ambiguous.result.exitCode, 2, ambiguous.result.text);
  assert.match(ambiguous.result.text, /usage.*missing or unknown/i);
  await assert.rejects(readFile(join(evidence, 'run-4.json.verdict.json'), 'utf8'), /ENOENT/);

  const memoryPath = join(data, 'reviewer.db');
  const costPath = join(data, 'reviewer-costs.duckdb');
  assert.ok((await readFile(memoryPath)).length > 0);
  assert.ok((await readFile(costPath)).length > 0);
  const retentionScript = fileURLToPath(new URL('../src/retention.mjs', import.meta.url));
  const readbackProgram = `
    import { LibSQLStore } from '@mastra/libsql';
    import { DuckDBStore } from '@mastra/duckdb';
    import { Memory } from '@mastra/memory';
    const [memoryPath, costPath, traceIds, threadId, resourceId] = process.argv.slice(1);
    const memory = new LibSQLStore({ id: 'proof-memory-readback', url: 'file:' + memoryPath.replaceAll('\\\\', '/') });
    const memoryObservability = await memory.getStore('observability');
    const memoryTraces = await Promise.all(JSON.parse(traceIds).map(traceId => memoryObservability.getTrace({ traceId })));
    const memoryApi = new Memory({ storage: memory, options: { workingMemory: { enabled: true, scope: 'resource' } } });
    const workingMemory = await memoryApi.getWorkingMemory({ threadId, resourceId });
    const duck = new DuckDBStore({ id: 'proof-cost-readback', path: costPath, retention: { observability: { spans: { maxAge: '14d' } } } });
    const metricStore = await duck.getStore('observability');
    const traces = await Promise.all(JSON.parse(traceIds).map(traceId => metricStore.getTrace({ traceId })));
    const metrics = await metricStore.listMetrics({ pagination: { page: 0, perPage: 100 } });
    const logs = await metricStore.listLogs({ pagination: { page: 0, perPage: 100 } });
    const costAggregate = await metricStore.getMetricAggregate({ name: ['mastra_model_total_input_tokens', 'mastra_model_total_output_tokens'], aggregation: 'sum', filters: { entityType: 'agent', userId: 'JUL-206' } });
    const expiredAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const example = traces[0].spans[0];
    const { createdAt, updatedAt, ...createFields } = example;
    await metricStore.createSpan({ span: {
      ...createFields, traceId: 'expired-retention-proof', spanId: 'expired-span', parentSpanId: null,
      name: 'expired retention proof', startedAt: expiredAt, endedAt: expiredAt,
    } });
    const expiredBefore = await metricStore.getTrace({ traceId: 'expired-retention-proof' });
    await memoryObservability.close?.(); await memory.close();
    await metricStore.close?.(); await duck.close();
    const traceText = JSON.stringify(traces);
    const firstPositiveCost = (value, path = '', seen = new WeakSet()) => {
      if (value == null) return null;
      if (typeof value !== 'object') {
        return /(?:gateway\.cost|commandcode\.cost\.cost|usage\.cost\.total)$/.test(path) && typeof value === 'number' && value > 0 ? { path, value } : null;
      }
      if (seen.has(value)) return null;
      seen.add(value);
      for (const [key, child] of Object.entries(value)) {
        const found = firstPositiveCost(child, path ? path + '.' + key : key, seen);
        if (found) return found;
      }
      return null;
    };
    console.log(JSON.stringify({
      traceCount: traces.filter(Boolean).length,
      memoryTraceCount: memoryTraces.filter(Boolean).length,
      traceIds: traces.map(trace => trace?.traceId),
      hasToolContent: traceText.includes('read_candidate_diff'),
      hasTokenContent: /promptTokens|inputTokens|prompt_tokens|input_tokens/i.test(traceText),
      hasNumericStepCost: traces.every(trace => Boolean(firstPositiveCost(trace))),
      metricCount: metrics.metrics?.length ?? 0,
      costAggregate,
      metricNames: (metrics.metrics ?? []).map(metric => metric.name),
      costRecordKinds: (metrics.metrics ?? []).filter(metric => metric.estimatedCost != null).map(metric => metric.labels?.costKind),
      summaries: (logs.logs ?? []).filter(log => log.message === 'mastra reviewer run summary').map(log => log.data),
      expiredExisted: Boolean(expiredBefore),
      workingMemory,
      steps: traces.map(trace => trace.spans.map(span => ({ name: span.name, type: span.spanType, tokenCost: firstPositiveCost(span) })).filter(step => step.tokenCost)),
    }));
  `;
  const readbackOutput = await exec(process.execPath, ['--input-type=module', '-e', readbackProgram, memoryPath, costPath, JSON.stringify(verdicts.map(result => result.traceId)), verdicts[0].evidence.threadId, verdicts[0].evidence.resourceId], { cwd: resolve(testRoot, '..'), windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  const readback = JSON.parse(readbackOutput.stdout.trim().split(/\r?\n/).at(-1));
  const retentionOutput = await exec(process.execPath, [retentionScript, data], { cwd: resolve(testRoot, '..'), windowsHide: true });
  const retentionRun = JSON.parse(retentionOutput.stdout.trim().split(/\r?\n/).at(-1));
  const postRetentionProgram = `
    import { LibSQLStore } from '@mastra/libsql';
    import { DuckDBStore } from '@mastra/duckdb';
    import { Memory } from '@mastra/memory';
    const [memoryPath, costPath, traceIds, threadId, resourceId] = process.argv.slice(1);
    const memory = new LibSQLStore({ id: 'proof-memory-after-prune', url: 'file:' + memoryPath.replaceAll('\\\\', '/') });
    const memoryApi = new Memory({ storage: memory, options: { workingMemory: { enabled: true, scope: 'resource' } } });
    const workingMemory = await memoryApi.getWorkingMemory({ threadId, resourceId });
    const duck = new DuckDBStore({ id: 'proof-cost-after-prune', path: costPath, retention: { observability: { spans: { maxAge: '14d' } } } });
    const store = await duck.getStore('observability');
    const [expired, traces, metrics, logs] = await Promise.all([
      store.getTrace({ traceId: 'expired-retention-proof' }),
      Promise.all(JSON.parse(traceIds).map(traceId => store.getTrace({ traceId }))),
      store.listMetrics({ pagination: { page: 0, perPage: 100 } }),
      store.listLogs({ pagination: { page: 0, perPage: 100 } }),
    ]);
    await memory.close(); await store.close?.(); await duck.close();
    console.log(JSON.stringify({ expiredDeleted: !expired, currentTraceCount: traces.filter(Boolean).length, metricCount: metrics.metrics?.length ?? 0, summaryCount: (logs.logs ?? []).filter(log => log.message === 'mastra reviewer run summary').length, workingMemory }));
  `;
  const postRetentionOutput = await exec(process.execPath, ['--input-type=module', '-e', postRetentionProgram, memoryPath, costPath, JSON.stringify(verdicts.map(result => result.traceId)), verdicts[0].evidence.threadId, verdicts[0].evidence.resourceId], { cwd: resolve(testRoot, '..'), windowsHide: true });
  const postRetention = JSON.parse(postRetentionOutput.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(readback.traceCount, 2, 'both saved trace IDs must read back from the stock DuckDB observability domain');
  assert.equal(readback.memoryTraceCount, 0, 'LibSQL must retain memory without reviewer traces');
  assert.equal(readback.hasToolContent, true);
  assert.equal(readback.hasTokenContent, true);
  assert.equal(readback.hasNumericStepCost, true, JSON.stringify(readback.steps));
  assert.ok(readback.metricCount > 0, 'DuckDB must retain automatic cost/token metrics');
  assert.ok(readback.costAggregate.estimatedCost > 0, JSON.stringify(readback.costAggregate));
  assert.equal(Number(readback.costAggregate.estimatedCost.toFixed(12)), Number(api.reportedCosts.reduce((sum, cost) => sum + cost, 0).toFixed(12)), 'the brake total must equal every reported paid stand-in call, including safety checks');
  assert.ok(readback.costRecordKinds.includes('estimated'), JSON.stringify(readback.costRecordKinds));
  assert.ok(readback.costRecordKinds.every(kind => kind === 'estimated' || kind === 'actual-adjustment'), JSON.stringify(readback.costRecordKinds));
  assert.equal(readback.summaries.length, 4, JSON.stringify(readback.summaries));
  const invalidSummary = readback.summaries.find(summary => summary.round === 0);
  assert.equal(invalidSummary.verdict, null);
  assert.match(invalidSummary.stopReason, /identity is incomplete/i);
  assert.deepEqual(invalidSummary.tokens, { input: 0, output: 0 });
  assert.deepEqual(invalidSummary.costUsd, { estimated: 0, actual: 0, brake: 0, actualMayIncludeOtherUsage: true, actualRequestCount: 0, reconciliationError: null });
  const ambiguousSummary = readback.summaries.find(summary => summary.round === 4);
  assert.equal(ambiguousSummary.verdict, null);
  assert.match(ambiguousSummary.stopReason, /usage.*missing or unknown/i);
  assert.deepEqual(ambiguousSummary.tokens, { input: null, output: null });
  assert.equal(ambiguousSummary.costUsd.estimated, null);
  assert.equal(Number(ambiguousSummary.costUsd.actual.toFixed(12)), 0.15);
  assert.equal(Number(ambiguousSummary.costUsd.brake.toFixed(12)), 0.15);
  assert.equal(ambiguousSummary.costUsd.actualMayIncludeOtherUsage, true);
  for (const [index, summary] of readback.summaries.filter(summary => summary.round === 1 || summary.round === 2).toSorted((a, b) => a.round - b.round).entries()) {
    assert.equal(summary.card, 'JUL-206');
    assert.equal(summary.change, `${candidate.base}...${index === 0 ? candidate.first : candidate.second}`);
    assert.equal(summary.round, index + 1);
    assert.equal(summary.verdict, 'PASS');
    assert.equal(summary.stopReason, null);
    assert.deepEqual(summary.reviewer, { model: 'deepseek/deepseek-v4.1-flash', effort: 'not-supported' });
    assert.deepEqual(summary.safetyCheck, { model: 'deepseek/deepseek-v4.1-flash', effort: 'not-supported' });
    assert.ok(summary.tokens.input > 0 && summary.tokens.output > 0, JSON.stringify(summary));
    assert.ok(summary.costUsd.estimated > 0, JSON.stringify(summary));
    assert.equal(Number(summary.costUsd.actual.toFixed(12)), 0.45);
    assert.equal(Number(summary.costUsd.brake.toFixed(12)), 0.45);
    assert.equal(summary.costUsd.actualMayIncludeOtherUsage, true);
    assert.equal(summary.costUsd.actualRequestCount, 3);
    assert.equal(summary.costUsd.reconciliationError, null);
    assert.match(summary.startedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(summary.endedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(summary.databaseBytes.memory > 0 && summary.databaseBytes.observability > 0, JSON.stringify(summary));
  }
  assert.match(readback.workingMemory, /No arbitrary caps or limits; flag any new one\./);
  assert.deepEqual({
    expiredExisted: readback.expiredExisted,
    expiredDeleted: postRetention.expiredDeleted,
    currentTraceCount: postRetention.currentTraceCount,
    metricCounts: [readback.metricCount, postRetention.metricCount],
    summaryCounts: [readback.summaries.length, postRetention.summaryCount],
    memoryUnchanged: postRetention.workingMemory === readback.workingMemory,
  }, {
    expiredExisted: true, expiredDeleted: true, currentTraceCount: 2,
    metricCounts: [readback.metricCount, readback.metricCount], summaryCounts: [4, 4], memoryUnchanged: true,
  });
  assert.ok(retentionRun.results.some(result => result.domain === 'observability' && result.deleted > 0), JSON.stringify(retentionRun));
  assert.deepEqual(api.observations, [
    { review: 1, hasWorkingMemory: true, hasPriorReview: true },
    { review: 2, hasWorkingMemory: true, hasPriorReview: true },
  ]);
  assert.ok(api.requests.some(body => body.tools?.some(tool => tool.function?.name === 'read_candidate_diff')), 'the model must receive the real read-only reviewer tool');

  const costBeforeBlockedRun = readback.costAggregate.estimatedCost;
  configuration.costCeilingUsd = costBeforeBlockedRun / 2;
  const blocked = await run(candidate.third, 3);
  assert.equal(blocked.result.exitCode, 2, blocked.result.text);
  assert.match(blocked.result.text, /cost|limit|budget/i);
  await assert.rejects(readFile(join(evidence, 'run-3.json.verdict.json'), 'utf8'), /ENOENT/);
  const stoppedReadbackProgram = `
    import { DuckDBStore } from '@mastra/duckdb';
    const [costPath] = process.argv.slice(1);
    const duck = new DuckDBStore({ id: 'proof-stopped-readback', path: costPath, retention: { observability: { spans: { maxAge: '14d' } } } });
    const store = await duck.getStore('observability');
    const logs = await store.listLogs({ pagination: { page: 0, perPage: 100 } });
    const aggregate = await store.getMetricAggregate({ name: ['mastra_model_total_input_tokens', 'mastra_model_total_output_tokens'], aggregation: 'sum', filters: { entityType: 'agent', userId: 'JUL-206' } });
    await store.close?.(); await duck.close();
    console.log(JSON.stringify({ summaries: (logs.logs ?? []).filter(log => log.message === 'mastra reviewer run summary').map(log => log.data), aggregate }));
  `;
  const stoppedOutput = await exec(process.execPath, ['--input-type=module', '-e', stoppedReadbackProgram, costPath], { cwd: resolve(testRoot, '..'), windowsHide: true });
  const stoppedReadback = JSON.parse(stoppedOutput.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(stoppedReadback.summaries.length, 5, JSON.stringify(stoppedReadback.summaries));
  const stoppedSummary = stoppedReadback.summaries.find(summary => summary.round === 3);
  assert.equal(stoppedSummary.card, 'JUL-206');
  assert.equal(stoppedSummary.change, `${candidate.base}...${candidate.third}`);
  assert.equal(stoppedSummary.verdict, null);
  assert.match(stoppedSummary.stopReason, /cost|limit|budget/i);
  assert.deepEqual(stoppedSummary.reviewer, { model: 'deepseek/deepseek-v4.1-flash', effort: 'not-supported' });
  assert.deepEqual(stoppedSummary.safetyCheck, { model: 'deepseek/deepseek-v4.1-flash', effort: 'not-supported' });
  assert.deepEqual(stoppedSummary.tokens, { input: 0, output: 0 });
  assert.deepEqual(stoppedSummary.costUsd, { estimated: 0, actual: 0, brake: 0, actualMayIncludeOtherUsage: true, actualRequestCount: 0, reconciliationError: null });
  assert.equal(Number(stoppedReadback.aggregate.estimatedCost.toFixed(12)), Number(api.reportedCosts.reduce((sum, cost) => sum + cost, 0).toFixed(12)));

  await writeFile(join(directory, 'acceptance-evidence.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(), candidate, verdicts, readback, stoppedReadback,
    costControl: { accumulatedCostBeforeBlockedRun: costBeforeBlockedRun, accumulatedCostAfterBlockedRun: stoppedReadback.aggregate.estimatedCost, configuredLimit: configuration.costCeilingUsd, blocked: true },
    databases: { memoryAndTraces: memoryPath, costs: costPath },
  }, null, 2)}\n`);
});
