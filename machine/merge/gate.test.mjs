import assert from 'node:assert/strict';
import test from 'node:test';

import { decideLanding, gateNote, parseShippingComment, sameCommit } from './gate.mjs';

const HEAD = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';

function determination({ verdict = 'PASS', sha = HEAD, round = 1, of = 2, card = 'JUL-310', pr = 420, url = 'https://example.test/1' } = {}) {
  return {
    url,
    body: [
      `Shipping agent: ${verdict}${round ? ` (review ${round} of ${of})` : ''}`,
      '',
      `**Card** ${card} · **Pull request** #${pr} · **Commit** \`${sha}\``,
      '',
      '| Field | Value |',
      '| --- | --- |',
      '| Model | commandcode/reflection/beam:free |',
      '',
      'VERDICT: ' + verdict,
    ].join('\n'),
  };
}

test('a comment is read as a determination only when it starts with the verdict line', () => {
  const parsed = parseShippingComment(determination({ verdict: 'PASS+NOTES', round: 2 }));
  assert.deepEqual(
    { verdict: parsed.verdict, round: parsed.round, of: parsed.of, sha: parsed.sha, card: parsed.card, pr: parsed.pr },
    { verdict: 'PASS+NOTES', round: 2, of: 2, sha: HEAD, card: 'JUL-310', pr: 420 }
  );
  assert.equal(parseShippingComment({ body: 'Thanks, merging this now.' }), null);
  assert.equal(parseShippingComment({ body: 'Shipping agent: LGTM on the branch' }), null);
  assert.equal(parseShippingComment({}), null);
});

test('the gate lands only on the newest verdict, and only for the commit on the pull request', () => {
  const pass = decideLanding({ comments: [determination()], card: 'JUL-310', pr: 420, head: HEAD });
  assert.equal(pass.pass, true);
  assert.equal(pass.rounds, 1);
  assert.deepEqual(pass.verdicts, ['PASS']);

  const moved = decideLanding({ comments: [determination()], card: 'JUL-310', pr: 420, head: 'f'.repeat(40) });
  assert.equal(moved.pass, false);
  assert.match(moved.reason, /judged a1b2c3d/);
  assert.match(moved.reason, /head is f{40}/);

  const failed = decideLanding({
    comments: [determination({ verdict: 'PASS' }), determination({ verdict: 'FAIL', round: 2, url: 'https://example.test/2' })],
    card: 'JUL-310',
    pr: 420,
    head: HEAD,
  });
  assert.equal(failed.pass, false);
  assert.equal(failed.verdict, 'FAIL');
  assert.deepEqual(failed.verdicts, ['PASS', 'FAIL']);
  assert.equal(failed.rounds, 2);

  const fixed = decideLanding({
    comments: [
      determination({ verdict: 'FAIL', round: 1, sha: '1'.repeat(40) }),
      determination({ verdict: 'PASS', round: 2, sha: HEAD, url: 'https://example.test/2' }),
    ],
    card: 'JUL-310',
    pr: 420,
    head: HEAD,
  });
  assert.equal(fixed.pass, true);
  assert.deepEqual(fixed.verdicts, ['FAIL', 'PASS']);
});

test('a verdict for another card, another pull request, or no verdict at all refuses the merge', () => {
  const otherCard = decideLanding({ comments: [determination({ card: 'JUL-311' })], card: 'JUL-310', pr: 420, head: HEAD });
  assert.equal(otherCard.pass, false);
  assert.match(otherCard.reason, /no Shipping determination on pull request #420 names JUL-310/);

  const otherPull = decideLanding({ comments: [determination({ pr: 421 })], card: 'JUL-310', pr: 420, head: HEAD });
  assert.equal(otherPull.pass, false);

  const none = decideLanding({ comments: [], card: 'JUL-310', pr: 420, head: HEAD });
  assert.equal(none.pass, false);

  const unjudged = decideLanding({ comments: [determination({ verdict: 'NOVERDICT' })], card: 'JUL-310', pr: 420, head: HEAD });
  assert.equal(unjudged.pass, false);
  assert.match(unjudged.reason, /came back without a verdict/);
});

test('commits are compared as prefixes, and short strings never match', () => {
  assert.equal(sameCommit(HEAD, HEAD.slice(0, 12)), true);
  assert.equal(sameCommit(HEAD.slice(0, 7), HEAD), true);
  assert.equal(sameCommit('abc1234', 'abc12345'), true);
  assert.equal(sameCommit('abc1234', 'def4567'), false);
  assert.equal(sameCommit('abc', 'abcdef1'), false);
  assert.equal(sameCommit(null, HEAD), false);
});

test('the gate note reads as one line whether or not it passed', () => {
  const pass = gateNote({ pass: true, card: 'JUL-310', reason: 'PASS on a1b2c3d', rounds: 2 });
  assert.equal(pass, 'JUL-310: PASS on a1b2c3d, 2 Shipping rounds.');
  const stop = gateNote({ pass: false, card: 'JUL-310', reason: 'the newest determination says FAIL' });
  assert.equal(stop, 'JUL-310: not merging, because the newest determination says FAIL.');
});
