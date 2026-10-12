import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommandCodeFormatProbe } from './julia-commandcode-format-probe.mjs';

test('operator must explicitly enable the live format probe before any request is sent', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'julia-format-probe-'));
  let calls = 0;
  try {
    await assert.rejects(
      runCommandCodeFormatProbe([], {
        artifactDirectory,
        environment: { COMMANDCODE_API_KEY: 'synthetic-secret' },
        fetchImpl: async () => { calls++; },
      }),
      /--live/,
    );
    assert.equal(calls, 0);
    assert.deepEqual(await readdir(artifactDirectory), []);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('live probe records exact requests and raw responses once, then judges each route independently', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'julia-format-probe-'));
  const calls = [];
  const model = {
    id: 'deepseek/deepseek-v4.1-flash',
    supported_endpoints: ['/chat/completions', '/responses'],
    supports_tools: true,
  };
  const bodies = [
    JSON.stringify({ data: [model] }),
    ...Array.from({ length: 3 }, () => JSON.stringify({ choices: [{ message: { content: 'Plain English. Verdict MAYBE. No array.' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })),
    ...Array.from({ length: 3 }, () => JSON.stringify({ choices: [{ message: { content: '{"summary":"Plain English","verdict":"MAYBE"}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })),
    ...Array.from({ length: 3 }, () => JSON.stringify({ output: [{ content: [{ type: 'output_text', text: 'Plain English. Verdict MAYBE. No array.' }] }], usage: { input_tokens: 10, output_tokens: 5 } })),
    ...Array.from({ length: 3 }, () => JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'submit_review', arguments: '{"summary":"Plain English","verdict":"MAYBE"}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })),
  ];
  try {
    const result = await runCommandCodeFormatProbe(['--live'], {
      artifactDirectory,
      environment: { COMMANDCODE_API_KEY: 'synthetic-secret' },
      now: () => new Date('2026-10-11T12:00:00Z'),
      fetchImpl: async (url, init = {}) => {
        calls.push({ url, init });
        const body = bodies.shift();
        return { ok: true, status: 200, text: async () => body };
      },
    });

    assert.equal(calls.length, 13);
    assert.equal(calls[0].url, 'https://api.commandcode.ai/provider/v1/models');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[1].url, 'https://api.commandcode.ai/provider/v1/chat/completions');
    assert.equal(JSON.parse(calls[1].init.body).response_format.json_schema.strict, true);
    assert.equal(JSON.parse(calls[4].init.body).response_format.type, 'json_object');
    assert.equal(calls[7].url, 'https://api.commandcode.ai/provider/v1/responses');
    assert.equal(JSON.parse(calls[7].init.body).text.format.strict, true);
    assert.equal(JSON.parse(calls[10].init.body).tool_choice.function.name, 'submit_review');
    assert.deepEqual(result.modelRecord, model);
    assert.deepEqual(result.routes.map(route => route.verdict), [
      "doesn't enforce", "doesn't enforce", "doesn't enforce", "doesn't enforce",
    ]);
    assert.deepEqual(result.routes[1].attempts.map(attempt => [attempt.validJson, attempt.passesSchema]), [
      [true, false], [true, false], [true, false],
    ]);
    assert.deepEqual(result.tokens, { input: 120, output: 60, cacheRead: 0, total: 180 });
    assert.equal(result.estimatedCostUsd, 0.000054);

    const files = await readdir(artifactDirectory);
    assert.equal(files.filter(name => name.endsWith('.request.json')).length, 13);
    assert.equal(files.filter(name => name.endsWith('.response.json')).length, 13);
    assert.equal(await readFile(join(artifactDirectory, '02-chat-json-schema-1.request.json'), 'utf8'), calls[1].init.body);
    assert.equal(await readFile(join(artifactDirectory, '02-chat-json-schema-1.response.json'), 'utf8'), JSON.stringify({ choices: [{ message: { content: 'Plain English. Verdict MAYBE. No array.' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('an unavailable route is recorded once and stops all later probes without a retry', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'julia-format-probe-'));
  let calls = 0;
  try {
    const result = await runCommandCodeFormatProbe(['--live'], {
      artifactDirectory,
      environment: { COMMANDCODE_API_KEY: 'synthetic-secret' },
      fetchImpl: async () => {
        calls++;
        if (calls === 1) return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'deepseek/deepseek-v4.1-flash', supported_endpoints: ['/chat/completions'] }] }) };
        return { ok: false, status: 400, text: async () => '{"error":"unsupported response_format"}' };
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.routes[0].verdict, 'unavailable');
    assert.match(result.stopped, /without retries/);
    assert.equal(await readFile(join(artifactDirectory, '02-chat-json-schema-1.response.json'), 'utf8'), '{"error":"unsupported response_format"}');
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('a network failure is durably classified with route context and is not retried', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'julia-format-probe-'));
  let calls = 0;
  try {
    const result = await runCommandCodeFormatProbe(['--live'], {
      artifactDirectory,
      environment: { COMMANDCODE_API_KEY: 'synthetic-secret' },
      fetchImpl: async () => { calls++; throw Object.assign(new Error('secret-bearing provider failure'), { cause: { code: 'ECONNRESET' } }); },
    });
    assert.equal(calls, 1);
    assert.match(result.stopped, /GET \/models unavailable/);
    assert.equal((await readFile(join(artifactDirectory, '01-models.error.json'), 'utf8')).includes('secret-bearing'), false);
    assert.deepEqual(JSON.parse(await readFile(join(artifactDirectory, '01-models.error.json'), 'utf8')), {
      method: 'GET', endpoint: '/models', category: 'network', uncertain: true,
    });
    assert.equal(JSON.parse(await readFile(join(artifactDirectory, 'summary.json'), 'utf8')).stopped, result.stopped);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('missing paid-response token usage fails closed before another model call', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'julia-format-probe-'));
  let calls = 0;
  try {
    const result = await runCommandCodeFormatProbe(['--live'], {
      artifactDirectory,
      environment: { COMMANDCODE_API_KEY: 'synthetic-secret' },
      fetchImpl: async (_url, init = {}) => {
        calls++;
        if (init.method === 'GET') return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'deepseek/deepseek-v4.1-flash', supported_endpoints: ['/chat/completions'] }] }) };
        return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{}' } }] }) };
      },
    });
    assert.equal(calls, 2);
    assert.match(result.stopped, /token usage/);
    assert.equal(result.routes[0].verdict, 'unavailable');
    assert.equal(await readFile(join(artifactDirectory, '02-chat-json-schema-1.response.json'), 'utf8'), JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
    assert.deepEqual(JSON.parse(await readFile(join(artifactDirectory, '02-chat-json-schema-1.error.json'), 'utf8')), {
      method: 'POST', endpoint: '/chat/completions', category: 'token usage missing or invalid', uncertain: false,
    });
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('invalid paid-response token usage fails closed before another model call', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'julia-format-probe-'));
  let calls = 0;
  try {
    const result = await runCommandCodeFormatProbe(['--live'], {
      artifactDirectory,
      environment: { COMMANDCODE_API_KEY: 'synthetic-secret' },
      fetchImpl: async (_url, init = {}) => {
        calls++;
        if (init.method === 'GET') return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'deepseek/deepseek-v4.1-flash', supported_endpoints: ['/chat/completions'] }] }) };
        return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 1, completion_tokens: -1, prompt_tokens_details: { cached_tokens: 2 } } }) };
      },
    });
    assert.equal(calls, 2);
    assert.match(result.stopped, /token usage missing or invalid/);
    assert.deepEqual(JSON.parse(await readFile(join(artifactDirectory, '02-chat-json-schema-1.error.json'), 'utf8')), {
      method: 'POST', endpoint: '/chat/completions', category: 'token usage missing or invalid', uncertain: false,
    });
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('/responses is reported unavailable and not called when the model does not advertise it', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'julia-format-probe-'));
  const urls = [];
  try {
    const result = await runCommandCodeFormatProbe(['--live'], {
      artifactDirectory,
      environment: { COMMANDCODE_API_KEY: 'synthetic-secret' },
      fetchImpl: async (url, init = {}) => {
        urls.push(url);
        if (init.method === 'GET') return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'deepseek/deepseek-v4.1-flash', supported_endpoints: ['/chat/completions'] }] }) };
        const request = JSON.parse(init.body);
        const body = request.tool_choice
          ? { choices: [{ message: { tool_calls: [{ function: { name: 'submit_review', arguments: '{"verdict":"MAYBE"}' } }] } }], usage: { prompt_tokens: 0, completion_tokens: 0 } }
          : { choices: [{ message: { content: 'plain English' } }], usage: { prompt_tokens: 0, completion_tokens: 0 } };
        return { ok: true, status: 200, text: async () => JSON.stringify(body) };
      },
    });
    assert.equal(urls.some(url => url.endsWith('/responses')), false);
    assert.equal(urls.length, 10);
    assert.equal(result.routes.length, 4);
    assert.deepEqual(result.routes[2], {
      route: '/responses json_schema strict', available: false, attempts: [], verdict: 'unavailable', error: 'not listed in the model supported_endpoints field',
    });
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('every initially enforcing route gets one more attempt with reviewer read-only tools present', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'julia-format-probe-'));
  const requestBodies = [];
  try {
    const result = await runCommandCodeFormatProbe(['--live'], {
      artifactDirectory,
      environment: { COMMANDCODE_API_KEY: 'synthetic-secret' },
      fetchImpl: async (url, init = {}) => {
        if (init.method === 'GET') return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'deepseek/deepseek-v4.1-flash', supported_endpoints: ['/chat/completions', '/responses'] }] }) };
        const request = JSON.parse(init.body);
        requestBodies.push(request);
        const usage = { prompt_tokens: 1, completion_tokens: 1 };
        const valid = JSON.stringify({ summary: 'held', verdict: 'PASS', evidence: [] });
        const body = url.endsWith('/responses')
          ? { output: [{ content: [{ type: 'output_text', text: valid }] }], usage: { input_tokens: 1, output_tokens: 1 } }
          : request.tool_choice?.function?.name === 'submit_review'
            ? { choices: [{ message: { tool_calls: [{ function: { name: 'submit_review', arguments: valid } }] } }], usage }
            : { choices: [{ message: { content: valid } }], usage };
        return { ok: true, status: 200, text: async () => JSON.stringify(body) };
      },
    });
    assert.equal(requestBodies.length, 16);
    assert.deepEqual(result.routes.map(route => route.verdict), ['enforces', 'enforces', 'enforces', 'enforces']);
    assert.deepEqual(result.routes.map(route => route.attempts.length), [4, 4, 4, 4]);
    for (const request of requestBodies.slice(12)) {
      const tools = request.tools ?? [];
      const names = tools.map(tool => tool.function?.name ?? tool.name);
      assert.equal(names.includes('list_candidate_files'), true);
      assert.equal(names.includes('read_candidate_diff'), true);
      assert.equal(names.includes('read_candidate_file'), true);
      assert.equal(names.includes('verify_evidence_quote'), true);
      assert.equal(names.includes('verify_evidence_quotes'), true);
    }
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('forced-tool result reports plain-English behavior when submit_review was not called', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'julia-format-probe-'));
  try {
    const result = await runCommandCodeFormatProbe(['--live'], {
      artifactDirectory,
      environment: { COMMANDCODE_API_KEY: 'synthetic-secret' },
      fetchImpl: async (_url, init = {}) => {
        if (init.method === 'GET') return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'deepseek/deepseek-v4.1-flash', supported_endpoints: ['/chat/completions'] }] }) };
        const request = JSON.parse(init.body);
        const body = request.tool_choice
          ? { choices: [{ message: { content: 'I ignored the tool and chose MAYBE.', tool_calls: [] } }], usage: { prompt_tokens: 0, completion_tokens: 0 } }
          : { choices: [{ message: { content: 'plain English' } }], usage: { prompt_tokens: 0, completion_tokens: 0 } };
        return { ok: true, status: 200, text: async () => JSON.stringify(body) };
      },
    });
    assert.match(result.routes[3].attempts[0].modelBehavior, /I ignored the tool and chose MAYBE/);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('cost brake stops during enforcing-route follow-ups before another paid call', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'julia-format-probe-'));
  let paidCalls = 0;
  try {
    const result = await runCommandCodeFormatProbe(['--live'], {
      artifactDirectory,
      environment: { COMMANDCODE_API_KEY: 'synthetic-secret' },
      now: () => new Date('2026-10-11T12:00:00Z'),
      fetchImpl: async (url, init = {}) => {
        if (init.method === 'GET') return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'deepseek/deepseek-v4.1-flash', supported_endpoints: ['/chat/completions', '/responses'] }] }) };
        paidCalls++;
        const request = JSON.parse(init.body);
        const valid = JSON.stringify({ summary: 'held', verdict: 'PASS', evidence: [] });
        const outputTokens = paidCalls <= 12 ? 90_000 : 300_000;
        const usage = { prompt_tokens: 0, completion_tokens: outputTokens };
        const body = url.endsWith('/responses')
          ? { output: [{ content: [{ type: 'output_text', text: valid }] }], usage: { input_tokens: 0, output_tokens: outputTokens } }
          : request.tool_choice
            ? { choices: [{ message: { tool_calls: [{ function: { name: 'submit_review', arguments: valid } }] } }], usage }
            : { choices: [{ message: { content: valid } }], usage };
        return { ok: true, status: 200, text: async () => JSON.stringify(body) };
      },
    });
    assert.equal(paidCalls, 13);
    assert.match(result.stopped, /80%/);
    assert.equal(result.routes[0].attempts.length, 4);
    assert.deepEqual(result.routes.slice(1).map(route => route.attempts.length), [3, 3, 3]);
  } finally {
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});
