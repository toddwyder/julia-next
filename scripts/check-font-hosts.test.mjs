import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { checkFontHosts } from './check-font-hosts.mjs';

function project(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'font-hosts-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

test('a Google font import is reported with its file and line', t => {
  const root = project(t, { 'app/layout.jsx': "import Link from 'next/link';\nimport { Inter } from 'next/font/google';\n" });
  assert.deepEqual(checkFontHosts(root), ['app/layout.jsx:2: next/font/google import: next/font/google']);
});

test('a dashboard stylesheet that pulls fonts from an outside host is reported', t => {
  const root = project(t, { 'dashboard/app/globals.css': "@import url('https://fonts.googleapis.com/css2?family=Public+Sans');\n" });
  const failures = checkFontHosts(root);
  assert.equal(failures.length >= 1, true);
  assert.match(failures[0], /^dashboard\/app\/globals\.css:1: /);
});

test('an outside font address left in the built output is reported', t => {
  const root = project(t, { '.next/static/css/page.css': '@font-face{src:url(https://fonts.gstatic.com/s/inter/v1/a.woff2)}\n' });
  const failures = checkFontHosts(root);
  assert.match(failures[0], /^\.next\/static\/css\/page\.css:1: Google Fonts address: https:\/\/fonts\.gstatic\.com\/s\/inter\/v1\/a\.woff2/);
});

test('fonts served from this repository pass', t => {
  const root = project(t, {
    'app/layout.jsx': "import localFont from 'next/font/local';\nconst sans = localFont({ src: './fonts/inter.woff2' });\n",
    '.next/static/css/page.css': '@font-face{src:url(/_next/static/media/inter.woff2)}\n',
  });
  assert.deepEqual(checkFontHosts(root), []);
});

test('the repository serves every font itself', () => {
  assert.deepEqual(checkFontHosts(join(import.meta.dirname, '..')), []);
});
