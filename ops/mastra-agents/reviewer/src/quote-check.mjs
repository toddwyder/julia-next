import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export function quoteIsPresent(quote, sourceText) {
  return typeof quote === 'string' && quote.length > 0 && sourceText.includes(quote);
}

export async function gitText(repoRoot, commit, source) {
  if (source === 'diff') return (await exec('git', ['show', '--format=', '--find-renames', commit], { cwd: repoRoot, windowsHide: true })).stdout;
  if (!source.startsWith('file:')) throw new Error(`unsupported evidence source: ${source}`);
  const path = source.slice('file:'.length);
  if (!path || path.includes('..') || path.startsWith('/') || path.startsWith('\\')) throw new Error('unsafe evidence path');
  return (await exec('git', ['show', `${commit}:${path}`], { cwd: repoRoot, windowsHide: true })).stdout;
}

export async function checkQuotes(repoRoot, commit, report) {
  const checks = [];
  for (const criterion of report.criteria) for (const evidence of criterion.evidence) {
    try { checks.push({ source: evidence.source, quote: evidence.quote, ok: quoteIsPresent(evidence.quote, await gitText(repoRoot, commit, evidence.source)) }); }
    catch (error) { checks.push({ source: evidence.source, quote: evidence.quote, ok: false, error: error.message }); }
  }
  return checks;
}
