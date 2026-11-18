import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkFontSources, findOutsideFontSources } from './check-font-sources.mjs';

const SCRIPT = fileURLToPath(new URL('./check-font-sources.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('..', import.meta.url));
const LICENCE = 'Copyright 2026 The Font Authors. This Font Software is licensed under the SIL Open Font License, Version 1.1.\n';

const dirs = [];
after(() => dirs.forEach(dir => rmSync(dir, { recursive: true, force: true })));

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'font-sources-'));
  dirs.push(dir);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'fixture'], { cwd: dir });
  return dir;
}

function run(dir, args = ['--all']) {
  return spawnSync(process.execPath, [SCRIPT, '--root', dir, ...args], { encoding: 'utf8' });
}

function messages(file, text) {
  return findOutsideFontSources({ file, text });
}

test('a next/font/google import fails and names the loading form', () => {
  const [message] = messages('app/layout.jsx', "import { Inter } from 'next/font/google';\n");
  assert.match(message, /^app\/layout\.jsx:1: imports next\/font\/google/);
});

test('a font file fetched from an outside address fails', () => {
  const [message] = messages('app/vintage.css', '@font-face{font-family:x;src:url(https://example.com/x.woff2)}\n');
  assert.match(message, /^app\/vintage\.css:1: loads a font file from an outside address/);
});

test('a font service host fails even without a font file extension', () => {
  const [message] = messages('app/page.jsx', "const href = 'https://fonts.googleapis.com/css2?family=Inter';\n");
  assert.match(message, /names a font service/);
});

test('an @font-face rule split across lines fails on the line loading the address', () => {
  const css = ['@font-face {', '  font-family: Serif;', '  src: url("https://cdn.example.com/serif.woff2") format("woff2");', '}', ''].join('\n');
  const [message] = messages('dashboard/app/globals.css', css);
  assert.match(message, /^dashboard\/app\/globals\.css:3: /);
});

test('an @import of an outside stylesheet fails', () => {
  const [message] = messages('app/vintage.css', '@import url("https://fonts.bunny.net/css");\n');
  assert.match(message, /^app\/vintage\.css:1: /);
});

test('a FontFace built in JavaScript from an outside address fails', () => {
  const js = ['const face = new FontFace(', "  'Inter',", "  'url(https://example.com/inter.woff2)',", ');', ''].join('\n');
  const [message] = messages('dashboard/lib/face.mjs', js);
  assert.match(message, /^dashboard\/lib\/face\.mjs:3: /);
});

test('a protocol-relative address fails', () => {
  const [message] = messages('app/vintage.css', '@font-face{src:url(//fonts.gstatic.com/x.woff2)}\n');
  assert.match(message, /outside address/);
});

test('the health route naming a family it never loads passes', () => {
  const js = "const CSS = `font-family: 'Public Sans', system-ui, sans-serif;`;\n";
  assert.deepEqual(messages('dashboard/app/api/health/route.js', js), []);
});

test('fonts read from files in the repository pass', () => {
  const js = "import localFont from 'next/font/local';\nexport const serif = localFont({ src: './fonts/playfair-display/latin.woff2' });\n";
  const css = "@font-face{font-family:'Playfair Display';src:url('./fonts/playfair-display/latin.woff2') format('woff2')}\n";
  assert.deepEqual(messages('lib/fonts.js', js), []);
  assert.deepEqual(messages('app/fonts.css', css), []);
});

test('design artifacts, docs and tests are not served code', () => {
  const outside = "import { Inter } from 'next/font/google';\n";
  assert.deepEqual(messages('prototypes/voice-add.html', outside), []);
  assert.deepEqual(messages('.impeccable/mocks/x.html', outside), []);
  assert.deepEqual(messages('docs/design/latin.md', outside), []);
  assert.deepEqual(messages('dashboard/app/fonts.test.mjs', outside), []);
});

test('a committed font file with no licence beside it fails', () => {
  const dir = repo({
    'app/fonts/inter/inter-latin.woff2': 'binary',
    'app/fonts/inter/OFL.txt': LICENCE,
    'app/fonts/public-sans/public-sans-latin.woff2': 'binary',
  });
  const result = run(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /app\/fonts\/public-sans\/public-sans-latin\.woff2:1: no licence beside this font file/);
  assert.doesNotMatch(result.stderr, /app\/fonts\/inter\//);
});

test('the check fails the command and prints file:line', () => {
  const dir = repo({
    'app/layout.jsx': "import { Inter } from 'next/font/google';\n\nexport default function Layout() {}\n",
    'app/fonts/inter/inter-latin.woff2': 'binary',
    'app/fonts/inter/OFL.txt': LICENCE,
  });
  const result = run(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^app\/layout\.jsx:1: /m);
});

test('the check passes a repository whose fonts all live on disk', () => {
  const dir = repo({
    'app/fonts.css': "@font-face{font-family:'Inter';src:url('./fonts/inter/inter-latin-wght-normal.woff2') format('woff2')}\n",
    'app/fonts/inter/inter-latin.woff2': 'binary',
    'app/fonts/inter/OFL.txt': LICENCE,
  });
  const result = run(dir);
  assert.equal(result.status, 0, result.stderr);
});

test('changed-file mode reports only what the change touched', () => {
  const dir = repo({
    'app/fonts/inter/inter-latin.woff2': 'binary',
    'app/fonts/inter/OFL.txt': LICENCE,
    'app/old.css': '@font-face{src:url(https://example.com/old.woff2)}\n',
  });
  writeFileSync(join(dir, 'app/page.jsx'), 'export default function Page() { return null; }\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'second'], { cwd: dir });
  assert.deepEqual(checkFontSources({ root: dir, base: 'HEAD^' }), []);
  assert.equal(checkFontSources({ root: dir, all: true }).length, 1);
});

test('this repository reads every font from a file in the repository', () => {
  assert.deepEqual(checkFontSources({ root: REPO, all: true }), []);
});
