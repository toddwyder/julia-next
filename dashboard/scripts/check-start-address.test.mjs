import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkStartHtml } from './check-start-address.mjs';

const startScreen = `<h1>Practice: JUL-276 document the Ready card journey</h1>
<p>Start screen</p><h2>Settings</h2><dt>Main session</dt><dt>Shipping</dt>
<dt>Effort</dt><h2>Effort</h2>
How hard the models think. More brains is slower and costs more.
Small Medium Large Unlimited`;

test('the real Start screen passes the check', () => {
  assert.deepEqual(checkStartHtml(startScreen, 'http://host:4314/start/JUL-279'), { ok: true });
});

test('a cookbook 404 on a Vercel preview fails and names the cause', () => {
  const cookbook404 = '<title>404</title>This page could not be found';
  const verdict = checkStartHtml(cookbook404, 'https://julia-next-git-feat.vercel.app/start/JUL-279');
  assert.equal(verdict.ok, false);
  assert.match(verdict.problem, /not the Julia dashboard/);
  assert.match(verdict.problem, /Vercel builds the cookbook at the repository root/);
});

test('a Vercel sign-in page fails instead of counting as served', () => {
  const verdict = checkStartHtml('<title>Login – Vercel</title>', 'https://julia-next-git-feat.vercel.app/start/JUL-279');
  assert.equal(verdict.ok, false);
  assert.match(verdict.problem, /not the Julia dashboard/);
});

test('the dashboard home page is not the Start screen', () => {
  const verdict = checkStartHtml('<h1>Ready cards</h1><p>JUL-279</p>', 'http://host:4314/');
  assert.equal(verdict.ok, false);
  assert.match(verdict.problem, /missing "Start screen"/);
});

test('a real Start screen still passes when the page carries Next.js 404 wording', () => {
  const realPage = `${startScreen}<script>{"notFound":["This page could not be found"]}</script>`;
  assert.deepEqual(checkStartHtml(realPage, 'http://host:4314/start/JUL-279'), { ok: true });
});
