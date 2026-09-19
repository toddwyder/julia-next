import { test } from 'node:test';
import assert from 'node:assert/strict';

import { linearGraphQL, getIssue, postComment, checkForToddGuard } from './linear-cli.mjs';

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

test('getIssue asks Linear for the issue labels (and its state), so the coordinator can resolve the seats', async () => {
  let query;
  const fetchImpl = async (url, opts) => {
    query = JSON.parse(opts.body).query;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          issue: {
            id: 'uuid-1',
            identifier: 'JUL-79',
            labels: { nodes: [{ name: 'builder-claude-opus' }, { name: 'reviewer-codex' }] },
            state: { name: 'Ready', type: 'unstarted' },
          },
        },
      }),
    };
  };
  const issue = await getIssue('JUL-79', { apiKey: 'k', fetchImpl });
  assert.match(query, /labels\s*\{\s*nodes\s*\{\s*name\s*\}\s*\}/);
  assert.match(query, /state\s*\{\s*name\s+type\s*\}/);
  assert.deepEqual(issue.labels.nodes.map((node) => node.name), ['builder-claude-opus', 'reviewer-codex']);
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

// ---------------------------------------------------------------------------
// The For-Todd guard (JUL-79 step 4)
// ---------------------------------------------------------------------------

test('checkForToddGuard: a bare WAITING ON YOU with no category is refused (rule: category)', () => {
  const result = checkForToddGuard('Status: blocked on the App Store listing.\n\nWAITING ON YOU');
  assert.equal(result.ok, false);
  assert.equal(result.rule, 'category');
  assert.match(result.reason, /\(a\)|\(b\)|\(c\)/);
});

test('checkForToddGuard: WAITING ON YOU is matched case-insensitively', () => {
  assert.equal(checkForToddGuard('waiting on you').ok, false);
  assert.equal(checkForToddGuard('Waiting On You').ok, false);
});

test('checkForToddGuard: WAITING ON YOU accepts each of the three markers', () => {
  for (const marker of ['(a)', '(b)', '(c)']) {
    assert.deepEqual(checkForToddGuard(`WAITING ON YOU -- see ${marker}`), { ok: true });
  }
});

test('checkForToddGuard: WAITING ON YOU accepts each category vocabulary word', () => {
  const words = [
    'sign-in', 'login', 'payment',
    'money', 'cost', 'spend', 'budget', 'billing', 'subscription', 'purchase', 'price',
    'product', 'decision', 'accept', 'approve', 'spec', 'scope',
  ];
  for (const word of words) {
    assert.deepEqual(
      checkForToddGuard(`WAITING ON YOU -- this needs a ${word} call`),
      { ok: true },
      `expected "${word}" to satisfy the category rule`,
    );
  }
});

test('checkForToddGuard: "waiting on yourself" is not the WAITING ON YOU marker', () => {
  assert.deepEqual(checkForToddGuard('you are waiting on yourself here'), { ok: true });
});

test('checkForToddGuard: each forbidden word alone in a For Todd line is refused (rule: git-vocabulary)', () => {
  for (const word of ['merge', 'push', 'branch', 'PR', 'commit', 'rebase']) {
    const result = checkForToddGuard(`The step is done.\n\nFor Todd: please ${word} this`);
    assert.equal(result.ok, false, `expected "${word}" to be refused`);
    assert.equal(result.rule, 'git-vocabulary');
  }
});

test('checkForToddGuard: common inflections in a For Todd line are refused', () => {
  const forms = [
    'merged', 'merges', 'merging',
    'pushes', 'pushed', 'pushing',
    'branches',
    'PRs',
    'commits', 'committed', 'committing',
    'rebased', 'rebasing', 'rebases',
  ];
  for (const form of forms) {
    const result = checkForToddGuard(`For Todd: the step ${form} cleanly`);
    assert.equal(result.ok, false, `expected "${form}" to be refused`);
    assert.equal(result.rule, 'git-vocabulary');
  }
});

test('checkForToddGuard: the same words OUTSIDE a For Todd line are accepted -- the rule is about For Todd lines', () => {
  const body = 'We merged the PR, pushed the branch, committed, and rebased it.\n\nFor Todd: nothing';
  assert.deepEqual(checkForToddGuard(body), { ok: true });
});

test('checkForToddGuard: word-boundary near-misses inside a For Todd line are accepted (commitment, approach, imprint, PRint)', () => {
  const body = 'Our commitment to this approach left an imprint on the PRint.\n\nFor Todd: nothing';
  assert.deepEqual(checkForToddGuard(body), { ok: true });
});

test('checkForToddGuard: a git word on the content line after the For Todd: header is refused', () => {
  const result = checkForToddGuard('For Todd:\nThe PR is merged.');
  assert.equal(result.ok, false);
  assert.equal(result.rule, 'git-vocabulary');
});

test('checkForToddGuard: the plain progress comment and "For Todd: nothing" pass untouched', () => {
  assert.deepEqual(checkForToddGuard('Progress only.'), { ok: true });
  assert.deepEqual(checkForToddGuard('Progress only.\n\nFor Todd: nothing'), { ok: true });
});

test('checkForToddGuard: never throws on a missing or non-string body', () => {
  assert.deepEqual(checkForToddGuard(), { ok: true });
  assert.deepEqual(checkForToddGuard(null), { ok: true });
  assert.deepEqual(checkForToddGuard(42), { ok: true });
});

test('JUL-79 acceptance: asking Todd to merge is rejected', () => {
  const result = checkForToddGuard('Everything is verified.\n\nFor Todd: please merge PR #42 for me');
  assert.equal(result.ok, false);
  assert.equal(result.rule, 'git-vocabulary');
});

test('JUL-79 acceptance: WAITING ON YOU with no category is rejected', () => {
  const result = checkForToddGuard('The build is stuck.\n\nWAITING ON YOU');
  assert.equal(result.ok, false);
  assert.equal(result.rule, 'category');
});

test('JUL-79 acceptance: a valid categorized park is accepted', () => {
  const body = 'The Apple sign-in needs Todd.\n\nWAITING ON YOU -- this needs an action only Todd\'s account can take (a): sign in to App Store Connect.';
  assert.deepEqual(checkForToddGuard(body), { ok: true });
});

test('postComment refuses a For Todd git request before any Linear API call, naming the rule and the acting instruction', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({ data: {} }) };
  };
  await assert.rejects(
    () => postComment('JUL-77', 'For Todd: merge the PR', { apiKey: 'k', fetchImpl }),
    (error) => /git-vocabulary/.test(error.message) && /Act instead of asking/.test(error.message),
  );
  assert.equal(calls, 0, 'the guard must run before the first network call');
});

test('postComment refuses an uncategorized WAITING ON YOU before any Linear API call', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({ data: {} }) };
  };
  await assert.rejects(() => postComment('JUL-77', 'WAITING ON YOU', { apiKey: 'k', fetchImpl }), /category/);
  assert.equal(calls, 0);
});

test('postComment still posts a body that passes the guard', async () => {
  const fetchImpl = fakeFetch([
    { body: { data: { issue: { id: 'uuid-77' } } } },
    { body: { data: { commentCreate: { success: true, comment: { id: 'c1' } } } } },
  ]);
  const comment = await postComment('JUL-77', 'Progress.\n\nFor Todd: nothing', { apiKey: 'k', fetchImpl });
  assert.equal(comment.id, 'c1');
});
