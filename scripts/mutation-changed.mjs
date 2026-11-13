#!/usr/bin/env node
// Mutation testing on the lines a pull request changes. A surviving mutant on a changed line
// fails the run and names the line and the change in the CI log.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base');
const base = baseIndex === -1 ? 'origin/main' : args[baseIndex + 1];
const reportFile = 'reports/mutation/changed.json';
const root = process.cwd();

const diff = spawnSync('git', ['diff', '--unified=0', '--no-color', base, 'HEAD', '--', 'machine'], { cwd: root, encoding: 'utf8' });
if (diff.status !== 0) {
  console.error(diff.stderr || `git diff against ${base} failed.`);
  process.exit(1);
}

const ranges = [];
let file = null;
for (const line of diff.stdout.split('\n')) {
  if (line.startsWith('+++ ')) {
    file = line.slice(4).replace(/^b\//, '');
    continue;
  }
  const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!hunk || !file) continue;
  if (!file.endsWith('.mjs') || file.endsWith('.test.mjs') || file.startsWith('machine/guards/fixtures/')) continue;
  const start = Number(hunk[1]);
  const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
  if (count === 0) continue;
  ranges.push({ file, start, end: start + count - 1 });
}

if (ranges.length === 0) {
  console.log(`No machine source lines changed against ${base}. Mutation testing skipped.`);
  process.exit(0);
}

const mutate = ranges.map(range => (range.start === range.end ? `${range.file}:${range.start}` : `${range.file}:${range.start}-${range.end}`));
console.log(`Mutating ${mutate.length} changed range(s) against ${base}:`);
for (const range of mutate) console.log(`  ${range}`);

mkdirSync(dirname(resolve(root, reportFile)), { recursive: true });
rmSync(resolve(root, reportFile), { force: true });
const stryker = resolve(root, 'node_modules/@stryker-mutator/core/bin/stryker.js');
const run = spawnSync(process.execPath, [stryker, 'run', 'stryker.config.mjs', '--mutate', ...mutate, '--jsonReporter.fileName', reportFile], {
  cwd: root,
  stdio: 'inherit',
});
if (run.status !== 0 && run.status !== 1) process.exit(run.status ?? 1);

let report;
try {
  report = JSON.parse(readFileSync(resolve(root, reportFile), 'utf8'));
} catch {
  console.error(`Stryker wrote no report at ${reportFile}; the run did not finish.`);
  process.exit(1);
}

const sources = new Map();
function originalText(changedFile, mutant) {
  if (!sources.has(changedFile)) sources.set(changedFile, readFileSync(resolve(root, changedFile), 'utf8').split('\n'));
  const lines = sources.get(changedFile);
  const { start, end } = mutant.location;
  if (start.line === end.line) return lines[start.line - 1].slice(start.column, end.column);
  const parts = [lines[start.line - 1].slice(start.column)];
  for (let i = start.line; i < end.line - 1; i += 1) parts.push(lines[i]);
  parts.push(lines[end.line - 1].slice(0, end.column));
  return parts.join('\n');
}

const failed = [];
const counts = {};
let killed = 0;
let detected = 0;
for (const [changedFile, result] of Object.entries(report.files)) {
  for (const mutant of result.mutants) {
    counts[mutant.status] = (counts[mutant.status] ?? 0) + 1;
    if (mutant.status === 'Killed' || mutant.status === 'Timeout') killed += 1;
    if (mutant.status !== 'NoCoverage' && mutant.status !== 'Ignored') detected += 1;
    if (['Survived', 'NoCoverage', 'Error', 'CompileError', 'RuntimeError'].includes(mutant.status)) failed.push({ changedFile, mutant });
  }
}

const score = detected === 0 ? 100 : ((killed / detected) * 100).toFixed(2);
console.log(`\nChanged lines: ${counts.Killed ?? 0} killed, ${counts.Survived ?? 0} survived, ${counts.NoCoverage ?? 0} not covered, ${counts.Timeout ?? 0} timed out.`);
console.log(`Changed-line mutation score: ${score}%`);

if (failed.length > 0) {
  console.error(`\n${failed.length} mutant(s) in changed lines were not caught:`);
  for (const { changedFile, mutant } of failed.sort((a, b) => a.mutant.location.start.line - b.mutant.location.start.line)) {
    const { line, column } = mutant.location.start;
    const change = `${mutant.mutatorName}: ${JSON.stringify(originalText(changedFile, mutant))} -> ${JSON.stringify(mutant.replacement)}`;
    console.error(`  ${changedFile}:${line}:${column} ${mutant.status} ${change}`);
    console.error(`::error file=${changedFile},line=${line},col=${column}::Mutation ${mutant.status.toLowerCase()}: ${change}. Add or fix a test that fails on this change.`);
  }
  process.exit(1);
}
