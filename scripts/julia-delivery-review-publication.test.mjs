import assert from 'node:assert/strict';
import { test } from 'node:test';

import { githubReviewPublisher, reviewCommentBody } from './julia-delivery-review-publication.mjs';

const sha = 'a'.repeat(40);
const digest = 'b'.repeat(64);
const publication = {
  issueId: 'JUL-203', round: 0, candidate: { commit: sha, base: 'c'.repeat(40) },
  input: { digest, scope: { kind: 'initial' }, sources: { diff: 'diff --git', 'file:scripts/add.mjs': 'export const add = () => 1;' } },
  verdict: 'PASS', report: { findings: [], limitations: [] },
};

function fakeGitHub({ comments = [], post = null, verify = null, prs = [{ number: 42, html_url: 'https://github.com/toddwyder/julia-next/pull/42', head: { sha } }] } = {}) {
  const calls = [];
  let postedBody = null;
  const run = (args, { input } = {}) => {
    calls.push({ args, input });
    const endpoint = args.find(arg => arg.startsWith('repos/'));
    if (endpoint === `repos/toddwyder/julia-next/commits/${sha}/pulls`) return { status: 0, stdout: JSON.stringify(prs), stderr: '' };
    if (endpoint === 'repos/toddwyder/julia-next/issues/42/comments?per_page=100') return { status: 0, stdout: JSON.stringify(comments), stderr: '' };
    if (endpoint === 'repos/toddwyder/julia-next/issues/42/comments') { postedBody = JSON.parse(input).body; return post ?? { status: 0, stdout: JSON.stringify({ id: 88, url: 'https://api.github.com/comments/88' }), stderr: '' }; }
    if (endpoint === 'repos/toddwyder/julia-next/issues/comments/88') return verify ?? { status: 0, stdout: JSON.stringify({ id: 88, body: postedBody ?? comments[0]?.body, html_url: 'https://github.com/toddwyder/julia-next/pull/42#issuecomment-88' }), stderr: '' };
    return { status: 1, stdout: '', stderr: `unexpected ${endpoint}` };
  };
  return { run, calls };
}

test('publishes and confirms one authoritative, commit-bound initial review comment', async () => {
  const github = fakeGitHub();
  const result = await githubReviewPublisher({ run: github.run })(publication);
  assert.deepEqual(result, { confirmed: true, authoritative: true, id: 88, url: 'https://github.com/toddwyder/julia-next/pull/42#issuecomment-88', pr: 42 });
  const posted = github.calls.find(call => call.args.includes('repos/toddwyder/julia-next/issues/42/comments'));
  assert.match(posted.input, /Julia delivery review — INITIAL — PASS/);
  assert.match(posted.input, new RegExp(sha));
  assert.match(posted.input, new RegExp(digest));
  assert.match(posted.input, /Authoritative completed review/);
  assert.match(posted.input, /No blocking findings/);
  assert.match(posted.input, /commit\//);
});

test('recovery reuses and verifies the one matching authoritative comment without posting again', async () => {
  const first = fakeGitHub();
  await githubReviewPublisher({ run: first.run })(publication);
  const posted = JSON.parse(first.calls.find(call => call.args.includes('repos/toddwyder/julia-next/issues/42/comments')).input).body;
  const github = fakeGitHub({ comments: [{ id: 88, body: posted, html_url: 'https://github.com/toddwyder/julia-next/pull/42#issuecomment-88' }] });
  const result = await githubReviewPublisher({ run: github.run })(publication);
  assert.equal(result.confirmed, true);
  assert.equal(github.calls.some(call => call.args.includes('repos/toddwyder/julia-next/issues/42/comments') && call.args.includes('--method')), false);
});

test('refuses an unconfirmed publication rather than claiming it was durable', async () => {
  const github = fakeGitHub({ verify: { status: 0, stdout: JSON.stringify({ id: 88, body: 'wrong record' }), stderr: '' } });
  await assert.rejects(githubReviewPublisher({ run: github.run })(publication), /could not be confirmed/);
});

test('a repair failure is visibly a repair review and retains its blocking finding', () => {
  const body = reviewCommentBody({
    ...publication,
    round: 1,
    input: { ...publication.input, scope: { kind: 'repair' } },
    verdict: 'FAIL',
    report: { findings: [{ file: 'scripts/add.mjs', location: '7', requirement: 'repair F1', consequence: 'the repair still returns the wrong sum' }], limitations: [] },
  });
  assert.match(body, /Julia delivery review — REPAIR — FAIL/);
  assert.match(body, /Review round: 2 \(repair\)/);
  assert.match(body, /repair F1/);
  assert.match(body, /scripts\/add\.mjs:7/);
  assert.match(body, /Authoritative completed review/);
});
