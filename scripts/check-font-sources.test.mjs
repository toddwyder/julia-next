import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { scratchDir } from './scratch-dir.mjs';
import { checkFontSources, findOutsideFonts, FONT_HOSTS } from './check-font-sources.mjs';

test('an import of next/font/google is reported with its file and line', () => {
  const text = "import Link from 'next/link';\nimport { Inter } from 'next/font/google';\n";
  assert.deepEqual(findOutsideFonts({ file: 'app/layout.jsx', text }), ['app/layout.jsx:2: imports next/font/google']);
});

test('a stylesheet link to an outside font host is reported with its line', () => {
  const text = '<head>\n  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">\n</head>';
  assert.deepEqual(findOutsideFonts({ file: 'public/index.html', text }), ['public/index.html:2: names an outside font host']);
});

test('every listed outside font host is reported', () => {
  for (const host of FONT_HOSTS) {
    assert.equal(findOutsideFonts({ file: 'app/x.css', text: `a { b: url(//${host}/f) }` }).length, 1, host);
  }
});

test('an @font-face with an https url is reported at the url line', () => {
  const text = '@font-face {\n  font-family: X;\n  src: url(https://example.com/x.woff2);\n}';
  assert.deepEqual(findOutsideFonts({ file: 'app/x.css', text }), ['app/x.css:3: @font-face src points at an outside address']);
});

test('an outside url after a local one in the same src is reported', () => {
  const text = "@font-face {\n  src: url('./x.woff2'),\n    url(//example.com/x.woff2);\n}";
  assert.deepEqual(findOutsideFonts({ file: 'app/x.css', text }), ['app/x.css:3: @font-face src points at an outside address']);
});

test('an @import of an outside stylesheet and a fontsource file on a CDN are reported', () => {
  assert.deepEqual(findOutsideFonts({ file: 'app/x.css', text: '@import url("https://example.com/a.css");' }), ['app/x.css:1: @import points at an outside address']);
  assert.deepEqual(findOutsideFonts({ file: 'app/x.css', text: 'a{b:url(https://cdn.jsdelivr.net/npm/@fontsource/inter/x.woff2)}' }), ['app/x.css:1: loads a fontsource file from a CDN']);
});

test('a font file kept in the repository produces no finding', () => {
  const text = "import localFont from 'next/font/local';\nexport const inter = localFont({ src: './fonts/inter/inter.woff2' });\n";
  assert.deepEqual(findOutsideFonts({ file: 'app/fonts.js', text }), []);
  assert.deepEqual(findOutsideFonts({ file: 'app/x.css', text: '@font-face { src: url(./inter.woff2) format("woff2"); }\n@import "./local.css";' }), []);
});

test('only the two apps are scanned, not design sketches', () => {
  const root = mkdtempSync(join(scratchDir, 'font-sources-'));
  try {
    const files = {
      'app/layout.jsx': "import { Inter } from 'next/font/google';\n",
      'dashboard/app/layout.jsx': "import { Public_Sans } from 'next/font/google';\n",
      'prototypes/sketch.html': '<link href="https://fonts.googleapis.com/css2?family=Inter">\n',
      'docs/page.html': '<link href="https://fonts.googleapis.com/css2?family=Inter">\n',
    };
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, dirname(path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    assert.deepEqual(checkFontSources({ root }), [
      'app/layout.jsx:1: imports next/font/google',
      'dashboard/app/layout.jsx:1: imports next/font/google',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('no tracked file in either app loads a font from an outside address', () => {
  assert.deepEqual(checkFontSources({ root: join(import.meta.dirname, '..') }), []);
});
