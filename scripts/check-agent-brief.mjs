#!/usr/bin/env node
// The four writing-for-agents rules for a card brief, as one check:
//   1. no text copied from repository docs
//   2. acceptance criteria in outcome form
//   3. no implementation words in acceptance criteria
//   4. no negations in acceptance criteria
//
// Triage runs this before showing Todd a brief.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BULLET = /^ {0,2}[-*+]\s+(?:\[( |x|X)\]\s+)?(.*)$/;
const ACCEPTANCE_HEADING = /^\s*(#{1,6})?\s*\**\s*acceptance criteria\s*:?\s*\**\s*:?\s*$/i;
const AGENT_FIELD = /^\*\*Acceptance criteria:\*\*\s*(.*)$/i;
const NEXT_FIELD = /^\*\*[^*]+:\*\*/;
const AGENT_FIELD_END = /^\*\*(?:Category|Summary|Current behavior|Desired behavior|Key interfaces|Out of scope):\*\*/i;
const HEADING = /^\s*(#{1,6})\s/;
const SHINGLE = 10;

const IMPERATIVE = new Set([
  'add', 'build', 'change', 'click', 'configure', 'create', 'delete', 'deploy', 'drop',
  'edit', 'ensure', 'expose', 'fix', 'implement', 'import', 'install', 'introduce', 'make',
  'modify', 'move', 'open', 'parse', 'refactor', 'remove', 'rename', 'replace', 'return',
  'run', 'set', 'store', 'support', 'update', 'use', 'wire', 'write',
]);

const IMPLEMENTATION = /\b(?:api|apis|argument|arguments|branch|class|classes|code|column|commit|component|components|constant|constants|controller|css|database|dependency|dependencies|deploy|deployment|endpoint|endpoints|file|files|function|functions|git|handler|html|implementation|interface|interfaces|javascript|json|merge|method|methods|middleware|migration|module|modules|next\.js|npm|package|parameter|parameters|parser|pr|pull request|query|queries|react|refactor|regex|route|router|schema|schemas|script|sql|type|types|typescript|variable|variables|yaml)\b/i;

const NEGATION = /\b(?:no|not|never|none|nothing|without|cannot|can[’']?t|won[’']?t|isn[’']?t|aren[’']?t|doesn[’']?t|don[’']?t|didn[’']?t|shouldn[’']?t|mustn[’']?t|nor|neither|nowhere)\b/i;

function textOf(line) {
  return line
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~>#]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalize(text) {
  return textOf(String(text ?? '')).toLowerCase();
}

function words(text) {
  return normalize(text).split(' ').filter(Boolean);
}

export function parseCriteria(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const criteria = [];
  let level = null;
  let field = false;
  lines.forEach((raw, index) => {
    const line = raw.replace(/\r$/, '');
    const opening = ACCEPTANCE_HEADING.exec(line);
    if (opening) {
      level = opening[1] ? opening[1].length : 6;
      field = false;
      return;
    }
    const heading = AGENT_FIELD.exec(line);
    if (heading) {
      level = null;
      field = true;
      if (heading[1].trim()) criteria.push({ id: `AC${criteria.length + 1}`, text: heading[1].trim(), line: index + 1 });
      return;
    }
    if (field && NEXT_FIELD.test(line)) {
      field = false;
      return;
    }
    if (level !== null) {
      const section = HEADING.exec(line);
      if (section && section[1].length <= level) {
        level = null;
        return;
      }
      if (AGENT_FIELD_END.test(line)) {
        level = null;
        return;
      }
    }
    if (!level && !field) return;
    const box = BULLET.exec(line);
    if (!box) return;
    criteria.push({ id: `AC${criteria.length + 1}`, text: box[2].trim(), line: index + 1 });
  });
  return criteria;
}

function shingles(wordsList, size) {
  const values = new Set();
  for (let index = 0; index + size <= wordsList.length; index += 1) {
    values.add(wordsList.slice(index, index + size).join(' '));
  }
  return values;
}

export function findCopiedText({ text, docs }) {
  const brief = String(text ?? '');
  const briefWords = words(brief);
  const briefShingles = shingles(briefWords, SHINGLE);
  const findings = [];
  if (!briefShingles.size) return findings;
  for (const doc of docs) {
    const docShingles = shingles(words(doc.text), SHINGLE);
    for (const shingle of briefShingles) {
      if (docShingles.has(shingle)) {
        findings.push(`copies text from ${doc.file}: "${shingle}"`);
        break;
      }
    }
  }
  return findings;
}

export function checkCriterion(criterion) {
  const findings = [];
  const text = String(criterion.text ?? '').trim();
  const plain = textOf(text);
  const first = normalize(plain).split(' ')[0];
  if (IMPERATIVE.has(first)) {
    findings.push(`${criterion.id} is procedural ("${first} ..."); write the observed outcome instead`);
  }
  const implementation = IMPLEMENTATION.exec(plain);
  if (implementation) {
    findings.push(`${criterion.id} uses the implementation word "${implementation[0]}"; describe what Todd sees instead`);
  }
  const negation = NEGATION.exec(plain);
  if (negation) {
    findings.push(`${criterion.id} uses the negation "${negation[0]}"; state the positive behavior instead`);
  }
  return findings;
}

function markdownFiles(root, except) {
  let files;
  try {
    files = execFileSync('git', ['ls-files', '*.md'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
  } catch {
    files = [];
    const visit = directory => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.name.endsWith('.md')) files.push(relative(root, path));
      }
    };
    visit(root);
  }
  return files.map(file => resolve(root, file)).filter(file => file !== except && existsSync(file));
}

export function checkBrief({ text, file = 'brief.md', root = process.cwd() }) {
  const criteria = parseCriteria(text);
  const findings = [];
  if (!criteria.length) findings.push('no acceptance criteria found; a brief needs testable criteria');
  findings.push(...findCopiedText({
    text,
    docs: markdownFiles(root, resolve(root, file)).map(path => ({ file: relative(root, path), text: readFileSync(path, 'utf8') })),
  }));
  for (const criterion of criteria) findings.push(...checkCriterion(criterion));
  const complete = findings.map(finding => `${file}:${criteria.find(criterion => finding.startsWith(`${criterion.id} `))?.line ?? 1}: ${finding}`);
  return complete;
}

function main(args) {
  const root = resolve(args.includes('--root') ? args[args.indexOf('--root') + 1] : '.');
  const textIndex = args.indexOf('--text');
  const file = textIndex > -1 ? 'brief.md' : args.find(arg => !arg.startsWith('--'));
  if (!file) {
    console.error('usage: node scripts/check-agent-brief.mjs <file> [--root <dir>]');
    return 2;
  }
  const text = textIndex > -1 ? args[textIndex + 1] : readFileSync(resolve(file), 'utf8');
  const findings = checkBrief({ text, file, root });
  if (!findings.length) {
    console.log('The brief passes the four writing-for-agents rules.');
    return;
  }
  console.error(findings.join('\n'));
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const code = main(process.argv.slice(2));
    if (code) process.exitCode = code;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
