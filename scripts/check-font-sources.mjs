#!/usr/bin/env node
// Fails when either app loads a font from an outside address. Every font is a
// file kept in the repository, so a build and its checks never wait on a font
// service answering. FONT_HOSTS is the one list of outside font services; the
// CI step that blocks them (scripts/block-font-hosts.mjs) reads it too.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FONT_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'use.typekit.net',
  'p.typekit.net',
  'fonts.bunny.net',
  'fast.fonts.net',
];

const escape = text => text.replaceAll('.', '\\.');
const OUTSIDE_URL = String.raw`(?:https?:|\/\/)`;

export const RULES = [
  { name: 'imports next/font/google', pattern: /\bnext\/font\/google\b/g },
  { name: 'names an outside font host', pattern: new RegExp(`(?<![\\w-])(?:${FONT_HOSTS.map(escape).join('|')})(?![\\w-])`, 'gi') },
  { name: 'loads a fontsource file from a CDN', pattern: /(?:cdn\.jsdelivr\.net|unpkg\.com)\/\S*fontsource/gi },
  { name: '@font-face src points at an outside address', pattern: new RegExp(String.raw`@font-face\s*\{[^}]*?(url\(\s*['"]?${OUTSIDE_URL})`, 'gi'), at: 1 },
  { name: '@import points at an outside address', pattern: new RegExp(String.raw`@import\s+(?:url\(\s*)?['"]?${OUTSIDE_URL}`, 'gi') },
];

const CODE = /\.(?:c|m)?[jt]sx?$|\.(?:css|scss|html|svg)$/;
const IN_APP = /^(?:app|lib|public|dashboard)\//;
const ROOT_CONFIG = /^[^/]+\.(?:c|m)?js$/;

export function isAppFile(path) {
  const file = String(path).replaceAll('\\', '/');
  return CODE.test(file) && (IN_APP.test(file) || ROOT_CONFIG.test(file));
}

export function findOutsideFonts({ file, text }) {
  const source = String(text ?? '');
  const found = [];
  for (const { name, pattern, at = 0 } of RULES) {
    for (const match of source.matchAll(pattern)) {
      const offset = match.index + match[0].length - match[at].length;
      const line = source.slice(0, offset).split('\n').length;
      found.push({ line, finding: `${file}:${line}: ${name}` });
    }
  }
  return found.sort((a, b) => a.line - b.line).map(({ finding }) => finding);
}

export function checkFontSources({ root = process.cwd() } = {}) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
  return tracked
    .filter(path => path && isAppFile(path))
    .flatMap(file => findOutsideFonts({ file, text: readFileSync(resolve(root, file), 'utf8') }));
}

function main(args) {
  const root = resolve(args.includes('--root') ? args[args.indexOf('--root') + 1] : '.');
  const findings = checkFontSources({ root });
  if (!findings.length) {
    console.log('Every font in both apps comes from a file in the repository.');
    return;
  }
  console.error(findings.join('\n'));
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
