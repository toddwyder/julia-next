#!/usr/bin/env node
// Fails when either app loads a font from outside the repository. Each rule is a
// row in RULES, and the font files each app's fonts.css declares are the only
// fonts that may exist. Findings read `file:line: id: say`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_HOSTS } from './font-hosts.mjs';

const APP_FOLDERS = ['app', 'dashboard/app'];
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|css)$/;
const IGNORED_FOLDERS = new Set(['node_modules', '.next']);
const FONT_FILE = '(?:woff2?|ttf|otf)';
const REMOTE = '(?:https?:)?\\/\\/';
const OUTSIDE_HOST = new RegExp(FONT_HOSTS.map(host => host.replaceAll('.', '\\.')).join('|'), 'i');
const REMOTE_FONT_URL = new RegExp(`url\\(\\s*['"]?${REMOTE}[^)'"\\s]+\\.${FONT_FILE}`, 'i');
const REMOTE_IMPORT = new RegExp(`@import\\s+(?:url\\(\\s*)?['"]?${REMOTE}`, 'i');
const NEXT_FONT = /['"]next\/font(?:\/[\w-]+)?['"]/;
const LOCAL_FONT_URL = new RegExp(`url\\(\\s*['"]?(\\.{1,2}\\/[^)'"\\s?#]+\\.${FONT_FILE})`, 'gi');

function localFontFiles({ line, file, root }) {
  return [...line.matchAll(LOCAL_FONT_URL)].map(([, url]) => resolve(root, dirname(file), url));
}

export const RULES = [
  { id: 'next-font', test: ({ line }) => NEXT_FONT.test(line), say: 'a font is loaded through next/font, which fetches it at build time; declare it with @font-face in the app\'s fonts.css' },
  { id: 'font-host', test: ({ line }) => OUTSIDE_HOST.test(line), say: 'the line names an outside font host; serve the font from the repository' },
  { id: 'remote-import', test: ({ line }) => REMOTE_IMPORT.test(line), say: '@import pulls a stylesheet from an outside address; copy the font into the repository' },
  { id: 'remote-font-url', test: ({ line }) => REMOTE_FONT_URL.test(line), say: 'a font file is read from an outside address; copy it into the repository' },
  { id: 'font-file-missing', test: context => localFontFiles(context).some(path => !existsSync(path)), say: 'an @font-face url() points at a file that is not in the repository' },
  { id: 'licence-missing', test: context => localFontFiles(context).some(path => !existsSync(join(dirname(path), 'OFL.txt'))), say: 'the font file has no OFL.txt beside it; add the family\'s licence next to the file' },
];

export function findFontHosts({ file, text, root = process.cwd() }) {
  const found = [];
  String(text ?? '').split(/\r?\n/).forEach((line, index) => {
    for (const rule of RULES) {
      if (rule.test({ line, file, root })) found.push(`${file}:${index + 1}: ${rule.id}: ${rule.say}`);
    }
  });
  return found;
}

function sourceFiles(root, folder) {
  const start = join(root, folder);
  if (!existsSync(start)) return [];
  return readdirSync(start, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && SOURCE_FILE.test(entry.name))
    .map(entry => join(entry.parentPath, entry.name))
    .filter(path => !relative(start, path).split(/[\\/]/).some(part => IGNORED_FOLDERS.has(part)))
    .map(path => relative(root, path).replaceAll('\\', '/'));
}

export function checkFontHosts({ root = process.cwd() } = {}) {
  const files = [...new Set(APP_FOLDERS.flatMap(folder => sourceFiles(root, folder)))].sort();
  return files.flatMap(file => findFontHosts({ file, text: readFileSync(resolve(root, file), 'utf8'), root }));
}

function main(args) {
  const root = resolve(args.includes('--root') ? args[args.indexOf('--root') + 1] : process.cwd());
  const findings = checkFontHosts({ root });
  if (findings.length) {
    console.error(findings.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log('Every font is served from this repository.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
