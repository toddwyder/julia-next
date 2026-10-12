import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { judgePart1, preregisteredReading, runCorrectedFormatProbe } from './julia-commandcode-format-probe-step3b.mjs';

test('corrected live probe requires its explicit operator opt-in before any request', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'julia-format-probe-3b-'));
  let calls = 0;
  try {
    await assert.rejects(runCorrectedFormatProbe([], {
      artifactDirectory,
      environment: { COMMANDCODE_API_KEY: 'synthetic-secret' },
      priorEstimatedCostUsd: 0,
      fetchImpl: async () => { calls++; },
    }), /--live-step3b/);
    assert.equal(calls, 0);
    assert.deepEqual(await readdir(artifactDirectory), []);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('the committed CLI dispatch resolves step 3b without a circular top-level-await deadlock', () => {
  const environment = { ...process.env };
  delete environment.COMMANDCODE_API_KEY;
  const child = spawnSync(process.execPath, ['scripts/julia-commandcode-format-probe.mjs', '--live-step3b'], {
    cwd: new URL('..', import.meta.url), env: environment, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /credential is not resolved/);
  assert.doesNotMatch(child.stderr, /unsettled top-level await/i);
});

test('pre-registered reading distinguishes reliability from demonstrated enforcement without reinterpretation', () => {
  const clean = { counts: { enforcedAgainstPlan: 0, violated: 0, voluntary: 20, failed: 0 } };
  const realPasses = Array.from({ length: 5 }, () => ({ validJson: true, passesRealSchema: true }));
  assert.equal(preregisteredReading('T', clean, [{ accepted: true }], realPasses), 'reliable, enforcement not demonstrated');
  assert.equal(preregisteredReading('T', { counts: { ...clean.counts, enforcedAgainstPlan: 1, voluntary: 19 } }, [{ accepted: true }], realPasses), 'reliable, enforcement demonstrated');
  assert.equal(preregisteredReading('T', clean, [{ rejectedByServer: true }], realPasses), 'reliable, enforcement demonstrated');
  assert.equal(preregisteredReading('T', { counts: { ...clean.counts, violated: 1, voluntary: 19 } }, [], realPasses), 'not reliable');
  assert.equal(preregisteredReading('S', { counts: { ...clean.counts, violated: 1, voluntary: 19 } }, []), 'not reliable');
});

test('Part 1 follows only the pre-registered violation signatures and requires T submit_review arguments', () => {
  const reasoning = 'I will set verdict to MAYBE and evidence as one plain string.';
  const missingTool = judgePart1('T', { choices: [{ message: { reasoning_content: reasoning, content: '{"summary":"x","verdict":"PASS","evidence":[]}' } }] });
  assert.equal(missingTool.classification, 'violated');
  assert.match(missingTool.violationReason, /tool call is missing/);

  const containsMaybe = judgePart1('S', { choices: [{ message: { reasoning, content: '{"summary":"Expected MAYBE but used allowed value","verdict":"PASS","evidence":[]}' } }] });
  assert.equal(containsMaybe.classification, 'violated');
  assert.equal(containsMaybe.violationReason, 'output contains MAYBE');

  const otherSchemaError = judgePart1('S', { choices: [{ message: { reasoning: 'I will use verdict PASS and an evidence array.', content: '{"verdict":"PASS","evidence":[]}' } }] });
  assert.equal(otherSchemaError.classification, 'violated');
  assert.match(otherSchemaError.violationReason, /summary/);

  const indeterminate = judgePart1('S', { choices: [{ message: { reasoning: '', content: '{"summary":"x","verdict":"PASS","evidence":[]}' } }] });
  assert.equal(indeterminate.classification, null);
  assert.match(indeterminate.classificationError, /did not positively plan/);

  const negatedConflict = judgePart1('S', { choices: [{ message: { reasoning: 'I will not set verdict to MAYBE; I will use PASS and an evidence array.', content: '{"summary":"x","verdict":"PASS","evidence":[]}' } }] });
  assert.equal(negatedConflict.classification, 'voluntary');
});

test('missing prior-card cost evidence fails closed before any live request', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'julia-format-probe-3b-'));
  let calls = 0;
  try {
    await assert.rejects(runCorrectedFormatProbe(['--live-step3b'], {
      artifactDirectory,
      priorArtifactPath: join(artifactDirectory, 'absent-summary.json'),
      environment: { COMMANDCODE_API_KEY: 'synthetic-secret' },
      fetchImpl: async () => { calls++; },
    }), /prior JUL-223 cost evidence/);
    assert.equal(calls, 0);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('a failed live call is recorded once and stops without later paid calls', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'julia-format-probe-3b-'));
  let calls = 0;
  try {
    const result = await runCorrectedFormatProbe(['--live-step3b'], {
      artifactDirectory,
      priorEstimatedCostUsd: 0,
      environment: { COMMANDCODE_API_KEY: 'synthetic-secret' },
      fetchImpl: async () => { calls++; throw Object.assign(new Error('offline'), { code: 'ECONNREFUSED' }); },
    });
    assert.equal(calls, 1);
    assert.match(result.stopped, /Part 1 route T attempt 1 failed/);
    assert.equal(result.part1.T.counts.failed, 1);
    const files = await readdir(artifactDirectory);
    assert.equal(files.filter(file => file.endsWith('.request.json')).length, 1);
    assert.equal(files.filter(file => file.endsWith('.error.json')).length, 1);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('a non-schema Part 2 HTTP error records once and stops later calls', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'julia-format-probe-3b-'));
  let calls = 0;
  const response = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
  try {
    const result = await runCorrectedFormatProbe(['--live-step3b'], {
      artifactDirectory,
      priorEstimatedCostUsd: 0,
      environment: { COMMANDCODE_API_KEY: 'synthetic-secret' },
      fetchImpl: async () => {
        calls++;
        if (calls === 41) return response(500, { error: { message: 'upstream unavailable' } });
        const route = calls <= 20 ? 'T' : 'S';
        const message = route === 'T'
          ? { reasoning_content: 'I will use PASS and an evidence array to conform.', tool_calls: [{ function: { name: 'submit_review', arguments: '{"summary":"x","verdict":"PASS","evidence":[]}' } }] }
          : { reasoning: 'I will use PASS and an evidence array to conform.', content: '{"summary":"x","verdict":"PASS","evidence":[]}' };
        return response(200, { choices: [{ message }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
      },
    });
    assert.equal(calls, 41);
    assert.match(result.stopped, /Part 2 route T attempt 1 failed: HTTP 500/);
    assert.equal(result.part2.T.length, 1);
    assert.equal(result.part2.T[0].rejectedByServer, false);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('corrected probe runs the pre-registered 49 calls once and records classifications, strict-schema checks, and real-schema results', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'julia-format-probe-3b-'));
  const repaired = JSON.parse(await readFile(new URL('../ops/mastra-agents/reviewer/test/fixtures/repaired.json', import.meta.url), 'utf8'));
  const calls = [];
  const response = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
  const usage = completion => ({ prompt_tokens: 10, completion_tokens: completion, prompt_tokens_details: { cached_tokens: 0 } });
  try {
    const result = await runCorrectedFormatProbe(['--live-step3b'], {
      artifactDirectory,
      environment: { COMMANDCODE_API_KEY: 'synthetic-secret' },
      priorEstimatedCostUsd: 0,
      now: () => new Date('2026-10-11T12:00:00Z'),
      fetchImpl: async (url, init) => {
        const request = JSON.parse(init.body);
        calls.push({ url, request });
        const number = calls.length;
        if (number <= 40) {
          const route = number <= 20 ? 'T' : 'S';
          const attempt = route === 'T' ? number : number - 20;
          const kind = (attempt - 1) % 3;
          const reasoning = kind === 1
            ? 'I will use verdict PASS and an evidence array to match the schema.'
            : 'I will set verdict to MAYBE and evidence as one plain string.';
          const output = kind === 2
            ? { summary: 'conflict followed', verdict: 'MAYBE', evidence: 'one plain string' }
            : { summary: 'schema followed', verdict: 'PASS', evidence: ['array item'] };
          const message = route === 'T'
            ? { reasoning_content: reasoning, tool_calls: [{ function: { name: 'submit_review', arguments: JSON.stringify(output) } }] }
            : { reasoning, content: JSON.stringify(output) };
          return response(200, { choices: [{ message, finish_reason: route === 'T' ? 'tool_calls' : 'stop' }], usage: usage(20) });
        }
        if (number <= 42) return response(400, { error: { message: 'strict tool schema requires every property' } });
        if (number <= 44) return response(200, { choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: usage(5) });
        return response(200, {
          choices: [{ message: { tool_calls: [{ function: { name: 'submit_review', arguments: JSON.stringify(repaired) } }] }, finish_reason: 'tool_calls' }],
          usage: usage(100 + number),
        });
      },
    });

    assert.equal(calls.length, 49);
    assert.deepEqual(result.part1.T.counts, { enforcedAgainstPlan: 7, violated: 6, voluntary: 7, failed: 0 });
    assert.deepEqual(result.part1.S.counts, { enforcedAgainstPlan: 7, violated: 6, voluntary: 7, failed: 0 });
    assert.deepEqual(result.part2.T.map(item => [item.status, item.accepted]), [[400, false], [400, false]]);
    assert.deepEqual(result.part2.S.map(item => [item.status, item.accepted]), [[200, true], [200, true]]);
    assert.equal(result.part3.length, 5);
    assert.equal(result.part3.every(item => item.validJson && item.passesRealSchema && item.finishReason === 'tool_calls'), true);
    assert.equal(result.reading.T, 'not reliable');
    assert.equal(result.reading.S, 'not reliable');

    assert.equal(calls[0].request.messages[0].role, 'system');
    assert.match(calls[0].request.messages[0].content, /verdict: "MAYBE"/);
    assert.equal(calls[0].request.messages[1].content.includes('MAYBE'), false);
    assert.equal(calls[0].request.tool_choice.function.name, 'submit_review');
    assert.equal(calls[0].request.tools.some(tool => tool.function.name === 'list_candidate_files'), true);
    assert.equal(calls[20].request.response_format.json_schema.strict, true);
    assert.equal(calls[40].request.tools[0].function.parameters.required.includes('summary'), false);
    assert.equal(calls[42].request.response_format.json_schema.schema.required.includes('summary'), false);
    assert.deepEqual(calls[44].request.tools[0].function.parameters.required, ['verdict', 'report']);
    assert.match(calls[44].request.messages[1].content, /Candidate 8a0d87cb/);

    const files = await readdir(artifactDirectory);
    assert.equal(files.filter(name => name.endsWith('.request.json')).length, 49);
    assert.equal(files.filter(name => name.endsWith('.response.json')).length, 49);
    assert.equal(files.filter(name => name.endsWith('.http.json')).length, 49);
    assert.equal(await readFile(join(artifactDirectory, '01-part1-T-01.request.json'), 'utf8'), JSON.stringify(calls[0].request));
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});
