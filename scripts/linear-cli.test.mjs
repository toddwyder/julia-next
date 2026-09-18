import { test } from 'node:test';
import assert from 'node:assert/strict';

import { linearGraphQL, getIssue, postComment } from './linear-cli.mjs';

function fakeFetch(responses) {
  let call = 0;
  return async (url, opts) => {
    const response = responses[call];
    call += 1;
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body,
    };
  };
}

test('linearGraphQL refuses to run without an API key', async () => {
  await assert.rejects(() => linearGraphQL('query {}', {}, {}), /apiKey is required/);
});

test('linearGraphQL sends the key as the Authorization header, not a Bearer-prefixed one -- Linear expects the raw key', async () => {
  let capturedHeaders;
  const fetchImpl = async (url, opts) => {
    capturedHeaders = opts.headers;
    return { ok: true, status: 200, json: async () => ({ data: {} }) };
  };
  await linearGraphQL('query {}', {}, { apiKey: 'lin_api_test123', fetchImpl });
  assert.equal(capturedHeaders.Authorization, 'lin_api_test123');
});

test('linearGraphQL throws with the response errors on a non-ok or errored response', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ errors: [{ message: 'nope' }] }) });
  await assert.rejects(() => linearGraphQL('query {}', {}, { apiKey: 'k', fetchImpl }), /nope/);
});

test('getIssue reads back the issue fields', async () => {
  const fetchImpl = fakeFetch([
    { body: { data: { issue: { id: 'uuid-1', identifier: 'JUL-77', title: 'Seat table', url: 'https://linear.app/x' } } } },
  ]);
  const issue = await getIssue('JUL-77', { apiKey: 'k', fetchImpl });
  assert.equal(issue.identifier, 'JUL-77');
  assert.equal(issue.title, 'Seat table');
});

test('postComment resolves the identifier to a UUID first, then creates the comment against it', async () => {
  const fetchImpl = fakeFetch([
    { body: { data: { issue: { id: 'uuid-77' } } } },
    { body: { data: { commentCreate: { success: true, comment: { id: 'c1', url: 'https://linear.app/c1' } } } } },
  ]);
  const comment = await postComment('JUL-77', 'hello from the Linear command', { apiKey: 'k', fetchImpl });
  assert.equal(comment.id, 'c1');
});

test('postComment throws when Linear reports success: false', async () => {
  const fetchImpl = fakeFetch([
    { body: { data: { issue: { id: 'uuid-77' } } } },
    { body: { data: { commentCreate: { success: false, comment: null } } } },
  ]);
  await assert.rejects(() => postComment('JUL-77', 'x', { apiKey: 'k', fetchImpl }), /did not report success/);
});
