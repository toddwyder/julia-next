#!/usr/bin/env node
// Fails when served code loads a font from an address outside the repository,
// and when a committed font file has no licence beside it. A build that reaches
// a font service can fail for a reason that has nothing to do with the change
// under test, so the loading forms are refused here as well as blocked on the
// build host. Each finding names the file, the line and the loading form.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FONT_HOSTS } from './font-hosts.mjs';

const SERVED_DIRECTORY = /^(?:app|lib|dashboard\/app|dashboard\/lib)\//;
const SERVED_CONFIG = /^(?:dashboard\/)?next\.config\.[cm]?[jt]s$/;
const SERVED_STYLE = /^public\/.*\.css$/;
const CODE = /\.(?:[cm]?[jt]sx?|css)$/;
const SKIPPED = /^(?:docs|prototypes|spikes)\/|^\.impeccable\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;
const FONT_FILE = /\.(?:woff2?|ttf|otf)$/i;
const LICENCES = /^(?:ofl\.txt|licen[cs]e(?:\.txt)?)$/i;
const EXTERNAL_URL = /(?:https?:)?\/\/[^\s"'`)]+/i;

const HOSTS = new RegExp(`\\b(?:${FONT_HOSTS.map(host => host.replaceAll('.', '\\.')).join('|')})\\b`, 'i');

export const RULES = [
  {
    id: 'outside-font-file',
    pattern: /(?:https?:)?\/\/[^\s"'`)]+\.(?:woff2?|ttf|otf)\b/i,
    message: 'loads a font file from an outside address',
  },
  {
    id: 'font-service-host',
    pattern: HOSTS,
    message: 'names a font service instead of a file in this repository',
  },
  {
    id: 'css-font-face',
    pattern: EXTERNAL_URL,
    construct: /@font-face/,
    message: 'a @font-face rule loads a font from an outside address',
  },
  {
    id: 'css-import',
    pattern: EXTERNAL_URL,
    construct: /@import/,
    message: 'an @import loads a stylesheet from an outside address',
  },
  {
    id: 'js-font-face',
    pattern: EXTERNAL_URL,
    construct: /new\s+FontFace\s*\(/,
    message: 'a FontFace built in JavaScript loads a font from an outside address',
  },
  {
    id: 'next-font-google',
    pattern: /next\/font\/google/,
    message: 'imports next/font/google, which downloads the font from Google at build time',
  },
];

export function isServed(path) {
  const file = String(path).replaceAll('\\', '/');
  if (SKIPPED.test(file)) return false;
  if (SERVED_CONFIG.test(file)) return true;
  if (SERVED_STYLE.test(file)) return true;
  return SERVED_DIRECTORY.test(file) && CODE.test(file);
}

function finding(file, line, message) {
  return `${file}:${line}: ${message}`;
}

function constructLine(lines, index, construct) {
  if (construct.test(lines[index])) return index + 1;
  for (let cursor = index - 1; cursor >= 0 && cursor >= index - 12; cursor -= 1) {
    if (construct.test(lines[cursor])) return cursor + 1;
    if (/\}/.test(lines[cursor])) break;
  }
  for (let cursor = index + 1; cursor < lines.length && cursor <= index + 2; cursor += 1) {
    if (construct.test(lines[cursor])) return cursor + 1;
  }
  return null;
}

export function findOutsideFontSources({ file, text }) {
  if (!isServed(file)) return [];
  const lines = String(text ?? '').split(/\r?\n/);
  const findings = [];
  const reported = new Set();
  lines.forEach((line, index) => {
    if (reported.has(index + 1)) return;
    for (const rule of RULES) {
      if (!rule.pattern.test(line)) continue;
      if (rule.construct && !constructLine(lines, index, rule.construct)) continue;
      const address = line.match(EXTERNAL_URL)?.[0] ?? line.match(HOSTS)?.[0] ?? line.trim();
      reported.add(index + 1);
      findings.push(finding(file, index + 1, `${rule.message} (${address})`));
      return;
    }
  });
  return findings;
}

export function findUnlicensedFontFiles({ files }) {
  const folders = new Map();
  for (const file of files) {
    if (!FONT_FILE.test(file)) continue;
    const folder = file.slice(0, file.lastIndexOf('/'));
    folders.set(folder, [...(folders.get(folder) ?? []), file]);
  }
  const findings = [];
  for (const [folder, fontFiles] of folders) {
    const licensed = files.some(file => {
      const cut = file.lastIndexOf('/');
      return file.slice(0, cut) === folder && LICENCES.test(file.slice(cut + 1));
    });
    if (licensed) continue;
    for (const file of fontFiles) {
      findings.push(finding(file, 1, `no licence beside this font file: put the font's OFL.txt in ${folder || 'the repository root'}`));
    }
  }
  return findings;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function trackedFiles(root) {
  const tracked = git(root, ['ls-files', '-z']).split('\0');
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0');
  return [...new Set([...tracked, ...untracked])].filter(Boolean);
}

function changedFiles(root, base) {
  const diff = git(root, ['diff', '--name-only', '--diff-filter=ACMR', base, 'HEAD']);
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  return [...new Set([...diff.split('\n'), ...untracked.split('\0')])].filter(Boolean);
}

function baseFromGit(root) {
  try {
    git(root, ['rev-parse', '--verify', 'HEAD^']);
    return 'HEAD^';
  } catch {
    return null;
  }
}

export function checkFontSources({ root = process.cwd(), base = null, all = false } = {}) {
  const compared = base || baseFromGit(root);
  if (!all && !compared) return [];
  const served = (all ? trackedFiles(root) : changedFiles(root, compared)).filter(isServed);
  const findings = [];
  for (const file of served) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue;
    findings.push(...findOutsideFontSources({ file, text: readFileSync(path, 'utf8') }));
  }
  findings.push(...findUnlicensedFontFiles({ files: trackedFiles(root) }));
  return findings;
}

function main(args) {
  const root = resolve(args.includes('--root') ? args[args.indexOf('--root') + 1] : '.');
  const baseIndex = args.indexOf('--base');
  const base = baseIndex > -1 ? args[baseIndex + 1] : process.env.FONT_SOURCES_BASE || null;
  const all = args.includes('--all') || !base;
  const findings = checkFontSources({ root, base, all });
  if (!findings.length) {
    console.log(all ? 'Every font is read from a file in this repository.' : 'No changed file loads a font from an outside address.');
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
