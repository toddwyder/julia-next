import assert from 'node:assert/strict';
import test from 'node:test';

import { previewHost } from './preview-domain.mjs';

test('takes the branch preview address, with or without scheme and path', () => {
  const host = 'julia-next-git-feat-jul-208-pri-c7c2ef-toddwyder-2186s-projects.vercel.app';
  assert.equal(previewHost(host), host);
  assert.equal(previewHost(`https://${host}/recipes`), host);
});

test('refuses a per-commit preview, which stops working at the next push', () => {
  assert.throws(() => previewHost('julia-next-3i8mpybw5-toddwyder-2186s-projects.vercel.app'), /not a branch preview/);
});

test("refuses Julia's own address and anything outside Vercel", () => {
  assert.throws(() => previewHost('julia-next.vercel.app'), /not a branch preview/);
  assert.throws(() => previewHost('julia-next-git-x.evil.example'), /not a branch preview/);
});
