import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { checkFontHosts, findFontHosts, RULES } from './check-font-hosts.mjs';
import { FONT_HOSTS } from './font-hosts.mjs';

function app(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'font-hosts-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const FACE = "@font-face { font-family: 'Inter'; src: url(./fonts/inter/inter.woff2) format('woff2'); }\n";

test('refuses a next/font/google import and names its line', t => {
  const root = app(t, { 'app/layout.jsx': "import './fonts.css';\nimport { Inter } from 'next/font/google';\n" });
  assert.deepEqual(checkFontHosts({ root }).map(line => line.split(': ').slice(0, 2).join(': ')), ['app/layout.jsx:2: next-font']);
});

test('refuses a next/font/local import', t => {
  const root = app(t, { 'dashboard/app/layout.jsx': "import localFont from 'next/font/local';\n" });
  assert.match(checkFontHosts({ root })[0], /^dashboard\/app\/layout\.jsx:1: next-font: /);
});

test('refuses every outside font host', t => {
  for (const host of FONT_HOSTS) {
    const root = app(t, { 'app/page.module.css': `.a { color: red; }\n/* ${host} */\n` });
    assert.match(checkFontHosts({ root })[0], /^app\/page\.module\.css:2: font-host: /, host);
  }
});

test('refuses an @import of an outside stylesheet', t => {
  const root = app(t, { 'app/globals.css': "body { margin: 0; }\n@import url('https://example.com/type.css');\n" });
  assert.match(checkFontHosts({ root })[0], /^app\/globals\.css:2: remote-import: /);
  assert.match(findFontHosts({ file: 'app/a.css', text: '@import "//cdn.example.com/a.css";' })[0], /^app\/a\.css:1: remote-import: /);
});

test('refuses a font file read from an outside address', t => {
  const root = app(t, { 'app/fonts.css': "@font-face { src: url('https://cdn.example.com/inter.woff2'); }\n" });
  assert.match(checkFontHosts({ root })[0], /^app\/fonts\.css:1: remote-font-url: /);
});

test('refuses outside font sources without extensions and across CSS lines', t => {
  for (const source of [
    "url('https://example.com/font')",
    "url(\n'https://example.com/inter.woff2'\n)",
    "url('./local.woff2'), url('//example.com/font')",
  ]) {
    const root = app(t, { 'app/fonts.css': `/* typography */\n@font-face {\n  src: ${source};\n}\n` });
    const found = checkFontHosts({ root });
    assert.ok(found.some(line => /^app\/fonts\.css:3: remote-font-url: /.test(line)), source);
  }
});

test('refuses an outside stylesheet import split across lines', t => {
  const root = app(t, { 'dashboard/app/fonts.css': "/* typography */\n@import\nurl(\n'https://example.com/fonts.css'\n);\n" });
  assert.match(checkFontHosts({ root })[0], /^dashboard\/app\/fonts\.css:2: remote-import: /);
});

test('refuses an @font-face whose file is not in the repository', t => {
  const root = app(t, { 'app/fonts.css': FACE });
  const found = checkFontHosts({ root });
  assert.match(found[0], /^app\/fonts\.css:1: font-file-missing: /);
});

test('refuses a font file with no OFL.txt beside it', t => {
  const root = app(t, { 'app/fonts.css': FACE, 'app/fonts/inter/inter.woff2': 'x' });
  const found = checkFontHosts({ root });
  assert.equal(found.length, 1);
  assert.match(found[0], /^app\/fonts\.css:1: licence-missing: /);
});

test('keeps a font declared in the repository with its licence beside it', t => {
  const root = app(t, { 'app/fonts.css': FACE, 'app/fonts/inter/inter.woff2': 'x', 'app/fonts/inter/OFL.txt': 'licence' });
  assert.deepEqual(checkFontHosts({ root }), []);
});

test('checks the dashboard app and skips build output and installed packages', t => {
  const root = app(t, {
    'dashboard/app/fonts.css': FACE.replace('inter', 'public-sans'),
    'dashboard/app/node_modules/x/index.js': "import 'next/font/google';\n",
    'dashboard/app/.next/a.css': '@import "https://fonts.googleapis.com/css";\n',
  });
  assert.deepEqual(checkFontHosts({ root }).map(line => line.split(': ')[1]), ['font-file-missing', 'licence-missing']);
});

test('every rule has a distinct id and a message that says what to do', () => {
  assert.equal(new Set(RULES.map(rule => rule.id)).size, RULES.length);
  for (const rule of RULES) assert.match(rule.say, /\b(?:declare|serve|copy|add|point)|not in the repository/, rule.id);
});

test('the command exits nonzero and names the file and line, and exits zero when clean', t => {
  const dirty = app(t, { 'app/layout.jsx': "import { Playfair_Display } from 'next/font/google';\n" });
  const refused = spawnSync(process.execPath, [join(import.meta.dirname, 'check-font-hosts.mjs'), '--root', dirty], { encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /app\/layout\.jsx:1: next-font: /);
  const clean = app(t, { 'app/fonts.css': FACE, 'app/fonts/inter/inter.woff2': 'x', 'app/fonts/inter/OFL.txt': 'licence' });
  const accepted = spawnSync(process.execPath, [join(import.meta.dirname, 'check-font-hosts.mjs'), '--root', clean], { encoding: 'utf8' });
  assert.equal(accepted.status, 0);
  assert.match(accepted.stdout, /Every font is served from this repository\./);
});
