#!/usr/bin/env node
// Fails when a pstack update drops or doubles a line our code enforces, and lists
// new pstack text that no anchor covers. Anchors are data: pstack-anchors.json.
//
//   node scripts/check-pstack-anchors.mjs
//   node scripts/check-pstack-anchors.mjs --new-text --base <commit>
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ANCHORS_FILE = 'docs/agents/mechanical-layer/pstack-anchors.json';
export const PSTACK_ROOT = '.agents/skills';
export const SOURCE_FILE = `${PSTACK_ROOT}/PSTACK-SOURCE.md`;
export const COMMENT_MARKER = '<!-- pstack-anchors -->';

export function readAnchors(root = process.cwd()) {
  const { anchors } = JSON.parse(readFileSync(join(root, ANCHORS_FILE), 'utf8'));
  if (!Array.isArray(anchors) || !anchors.length) throw new Error(`${ANCHORS_FILE} must hold a non-empty "anchors" list`);
  for (const row of anchors) {
    for (const key of ['rule', 'file', 'anchor', 'enforcedBy']) {
      if (typeof row[key] !== 'string' || !row[key]) throw new Error(`every anchor needs a non-empty "${key}": ${JSON.stringify(row)}`);
    }
  }
  return anchors;
}

export function countOccurrences(text, needle) {
  let count = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) count += 1;
  return count;
}

export function checkAnchors(anchors, root = process.cwd()) {
  const problems = [];
  for (const { rule, file, anchor } of anchors) {
    const path = join(root, file);
    if (!existsSync(path)) {
      problems.push(`anchor file is missing: ${file} (rule: ${rule})`);
      continue;
    }
    const count = countOccurrences(readFileSync(path, 'utf8'), anchor);
    if (count === 0) problems.push(`anchor is missing from ${file}: "${anchor}" (rule: ${rule})`);
    else if (count > 1) problems.push(`anchor appears ${count} times in ${file}: "${anchor}" (rule: ${rule})`);
  }
  return problems;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

export function changedFiles(root, base, paths) {
  return git(root, ['diff', '--name-only', '--diff-filter=d', base, 'HEAD', '--', ...paths]).split('\n').filter(Boolean);
}

// Line numbers in HEAD that the diff adds to one file, read from zero-context hunks.
export function addedLineNumbers(root, base, file) {
  const added = new Set();
  let next = 0;
  for (const line of git(root, ['diff', '--no-color', '--unified=0', base, 'HEAD', '--', file]).split('\n')) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) next = Number(hunk[1]);
    else if (line.startsWith('+') && !line.startsWith('+++')) {
      added.add(next);
      next += 1;
    }
  }
  return added;
}

// SKILL.md files group their rules under `##`; playbooks use `###`.
function headingLevel(file) {
  if (file.endsWith('/SKILL.md')) return 2;
  if (file.includes('/playbooks/')) return 3;
  return 2;
}

export function newPstackText({ root = process.cwd(), base, anchors }) {
  if (!base) throw new Error('--new-text needs --base <commit>');
  if (!changedFiles(root, base, [SOURCE_FILE]).length) return { text: '', sections: [] };
  const covered = anchors.map(row => row.anchor);
  const sections = [];
  for (const file of changedFiles(root, base, [PSTACK_ROOT])) {
    if (file === SOURCE_FILE || !existsSync(join(root, file))) continue;
    const level = headingLevel(file);
    const lines = readFileSync(join(root, file), 'utf8').split('\n');
    const added = addedLineNumbers(root, base, file);
    const groups = [];
    let heading = null;
    lines.forEach((text, index) => {
      const match = text.match(/^(#{1,6})\s+(.+)$/);
      if (match && match[1].length === level) {
        heading = `${match[1]} ${match[2].trim()}`;
        groups.push({ heading, lines: [] });
      }
      if (!added.has(index + 1)) return;
      const trimmed = text.trim();
      if (!trimmed || covered.some(anchor => trimmed.includes(anchor))) return;
      if (!groups.length) groups.push({ heading: null, lines: [] });
      groups.at(-1).lines.push(trimmed);
    });
    const kept = groups.filter(group => group.lines.length);
    if (kept.length) sections.push({ file, groups: kept });
  }
  if (!sections.length) return { text: '', sections };
  const out = [COMMENT_MARKER, '', 'New pstack text in this pull request that no enforced anchor covers.'];
  for (const { file, groups } of sections) {
    out.push('', `**\`${file}\`**`);
    for (const group of groups) {
      out.push('', group.heading ? `Under \`${group.heading}\`` : 'Above the first heading');
      for (const line of group.lines) out.push(`- ${line}`);
    }
  }
  return { text: `${out.join('\n')}\n`, sections };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const root = resolve('.');
  try {
    const anchors = readAnchors(root);
    if (args.includes('--new-text')) {
      const base = args[args.indexOf('--base') + 1];
      process.stdout.write(newPstackText({ root, base, anchors }).text);
    } else {
      const problems = checkAnchors(anchors, root);
      if (problems.length) {
        console.error(`pstack anchor check failed:\n${problems.join('\n')}`);
        process.exitCode = 1;
      } else {
        const files = new Set(anchors.map(row => row.file));
        console.log(`${anchors.length} anchors found in ${files.size} pstack files.`);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
