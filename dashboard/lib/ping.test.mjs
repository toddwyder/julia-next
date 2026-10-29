// ping.test.mjs -- the notice Todd actually gets, and the reminder that delivers it
// (JUL-276 PR-2, decision D6). A comment on his own key does not notify him.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkForToddGuard } from '../../scripts/linear-cli.mjs';
import { DASHBOARD_CARD, dashboardNotice, sendDashboardNotice } from './ping.js';

const KEY = 'lin_api_never_in_a_body';

test('the down notice names the dashboard, the address and the last failure', () => {
  const text = dashboardNotice({ kind: 'down', detail: 'HTTP 503 from http://127.0.0.1:4313/api/health (failing: runs)', address: 'http://127.0.0.1:4313/api/health', at: '2026-10-29T10:00:00.000Z' });
  assert.match(text, /Julia dashboard is down/);
  assert.match(text, /three times in a row/);
  assert.match(text, /HTTP 503/);
  assert.match(text, /2026-10-29T10:00:00.000Z/);
});

test('a multi-line failure reason is folded to one line so the comment stays readable', () => {
  const text = dashboardNotice({ kind: 'down', detail: 'line one\nline two\n\nline three', at: '2026-10-29T10:00:00.000Z' });
  assert.match(text, /line one line two line three/);
});

test('the recovery notice names the dashboard and when it went down', () => {
  const text = dashboardNotice({ kind: 'recovery', at: '2026-10-29T10:03:00.000Z', downSince: '2026-10-29T10:00:00.000Z' });
  assert.match(text, /Julia dashboard is answering again/);
  assert.match(text, /went down at 2026-10-29T10:00:00.000Z/);
});

test('both notices pass the For-Todd guard, so the sender cannot be refused', () => {
  for (const kind of ['down', 'recovery']) {
    assert.deepEqual(checkForToddGuard(dashboardNotice({ kind, detail: 'HTTP 503', at: '2026-10-29T10:00:00.000Z' })), { ok: true });
  }
  assert.throws(() => dashboardNotice({ kind: 'telepathy' }), /unknown dashboard notice kind/);
});

test('the sender posts the comment, then sets the reminder on the issue id, with no key in any body', async () => {
  const requests = [];
  const replies = [
    { data: { issue: { id: 'issue-uuid-1' } } },
    { data: { commentCreate: { success: true, comment: { id: 'comment-1', url: 'https://linear.app/julia-next/issue/JUL-276#comment-1' } } } },
    { data: { issueReminder: { success: true } } },
  ];
  const fetchImpl = (url, init) => {
    requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return Promise.resolve(new Response(JSON.stringify(replies[requests.length - 1]), { status: 200 }));
  };
  const before = Date.now();
  const result = await sendDashboardNotice({ kind: 'down', detail: 'connection refused', at: '2026-10-29T10:00:00.000Z' }, { apiKey: KEY, fetchImpl });

  assert.equal(requests.length, 3);
  assert.equal(requests[0].body.variables.id, DASHBOARD_CARD);
  assert.equal(requests[1].body.variables.issueId, 'issue-uuid-1');
  assert.match(requests[1].body.variables.body, /Julia dashboard is down/);
  assert.equal(requests[2].body.variables.id, 'issue-uuid-1');
  const remindAt = Date.parse(requests[2].body.variables.at);
  assert.ok(remindAt >= before + 25_000 && remindAt <= Date.now() + 35_000, `reminder at ${requests[2].body.variables.at}`);
  for (const request of requests) {
    assert.equal(request.headers.Authorization, KEY);
    assert.doesNotMatch(JSON.stringify(request.body), new RegExp(KEY));
  }
  assert.equal(result.comment, 'https://linear.app/julia-next/issue/JUL-276#comment-1');
  assert.equal(result.reminded, true);
});

test('a reminder Linear did not confirm is an error, so a comment is never mistaken for delivery', async () => {
  const replies = [
    { data: { issue: { id: 'issue-uuid-1' } } },
    { data: { commentCreate: { success: true, comment: { id: 'comment-1', url: 'https://linear.app/x' } } } },
    { data: { issueReminder: { success: false } } },
  ];
  let index = 0;
  const fetchImpl = () => Promise.resolve(new Response(JSON.stringify(replies[index++]), { status: 200 }));
  await assert.rejects(sendDashboardNotice({ kind: 'recovery' }, { apiKey: KEY, fetchImpl }), /issueReminder did not report success/);
});
