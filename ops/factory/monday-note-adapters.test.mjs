// monday-note-adapters.test.mjs -- issue #180: the production client
// that posts the cost note on GitHub Issues.
//
// Driven by an injected `fetchImpl`, capturing the exact HTTP request
// (URL, method, headers, JSON body) and asserting on it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createIssuesClient } from './monday-note-adapters.mjs';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

function recordingFetch(handler) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return handler(String(url), init);
    },
  };
}

// --- GitHub Issues Adapter (Issue #180)

test('issues.find queries GitHub REST API with factory:machine and cost-note labels and finds matching title', async () => {
  const fake = recordingFetch(() => jsonResponse([
    { id: 101, number: 181, title: 'Monday note — week ending 2026-09-28', html_url: 'https://github.com/o/r/issues/181' },
  ]));
  const client = createIssuesClient({ fetchImpl: fake.fetch, token: 't', owner: 'o', repo: 'r' });

  const found = await client.find({ title: 'Monday note — week ending 2026-09-28' });

  assert.equal(found.url, 'https://github.com/o/r/issues/181');
  assert.equal(found.number, 181);
  assert.equal(fake.calls.length, 1);
  assert.match(fake.calls[0].url, /https:\/\/api\.github\.com\/repos\/o\/r\/issues/);
  assert.match(fake.calls[0].url, /labels=factory%3Amachine%2Ccost-note|labels=factory:machine,cost-note/);
  assert.equal(fake.calls[0].init.headers.Authorization, 'Bearer t');
});

test('issues.find returns null when no issue matches the title', async () => {
  const fake = recordingFetch(() => jsonResponse([]));
  const client = createIssuesClient({ fetchImpl: fake.fetch, token: 't', owner: 'o', repo: 'r' });

  const found = await client.find({ title: 'Monday note — week ending 2026-09-28' });

  assert.equal(found, null);
});

test('issues.find paginates until the title is found', async () => {
  const fake = recordingFetch((url) => {
    if (/[?&]page=1(?=&|$)/.test(url)) {
      // Return 100 dummy issues for page 1
      const page1 = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        number: i + 1,
        title: `Other issue ${i}`,
        html_url: `https://github.com/o/r/issues/${i + 1}`,
      }));
      return jsonResponse(page1);
    }
    return jsonResponse([
      { id: 200, number: 181, title: 'Monday note — week ending 2026-09-28', html_url: 'https://github.com/o/r/issues/181' },
    ]);
  });
  const client = createIssuesClient({ fetchImpl: fake.fetch, token: 't', owner: 'o', repo: 'r' });

  const found = await client.find({ title: 'Monday note — week ending 2026-09-28' });

  assert.equal(found.url, 'https://github.com/o/r/issues/181');
  assert.equal(fake.calls.length, 2);
});

test('issues.post creates a GitHub issue with factory:machine and cost-note labels and returns its URL', async () => {
  const fake = recordingFetch((url, init) => {
    return jsonResponse({
      id: 501,
      number: 182,
      title: 'Monday note — week ending 2026-09-28',
      html_url: 'https://github.com/o/r/issues/182',
    });
  });
  const client = createIssuesClient({ fetchImpl: fake.fetch, token: 't', owner: 'o', repo: 'r' });

  const issue = await client.post({
    title: 'Monday note — week ending 2026-09-28',
    body: '## Weekly cost note...',
  });

  assert.equal(issue.url, 'https://github.com/o/r/issues/182');
  assert.equal(issue.number, 182);
  const call = fake.calls[0];
  assert.equal(call.init.method, 'POST');
  assert.equal(call.url, 'https://api.github.com/repos/o/r/issues');
  const payload = JSON.parse(call.init.body);
  assert.equal(payload.title, 'Monday note — week ending 2026-09-28');
  assert.equal(payload.body, '## Weekly cost note...');
  assert.deepEqual(payload.labels, ['factory:machine', 'cost-note']);
});

test('issues.post surfaces HTTP errors when GitHub rejects the request', async () => {
  const fake = recordingFetch(() => jsonResponse({ message: 'Validation Failed' }, 422));
  const client = createIssuesClient({ fetchImpl: fake.fetch, token: 't', owner: 'o', repo: 'r' });

  await assert.rejects(
    () => client.post({ title: 'T', body: 'B' }),
    /GitHub Issues API error: 422/,
  );
});
