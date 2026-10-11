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

export function evidenceCitations(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (typeof value.source === 'string' && typeof value.quote === 'string') found.push({ source: value.source, quote: value.quote });
  for (const child of Array.isArray(value) ? value : Object.values(value)) evidenceCitations(child, found);
  return found;
}

export async function checkQuotes(repoRoot, commit, report, sources = {}) {
  const checks = [];
  for (const evidence of evidenceCitations(report)) {
    try {
      const sourceText = Object.hasOwn(sources, evidence.source)
        ? sources[evidence.source]
        : await gitText(repoRoot, commit, evidence.source);
      checks.push({ source: evidence.source, quote: evidence.quote, ok: quoteIsPresent(evidence.quote, sourceText ?? '') });
    } catch (error) {
      checks.push({ source: evidence.source, quote: evidence.quote, ok: false, error: error.message });
    }
  }
  return checks;
}

export async function verifyEvidenceQuote(repoRoot, commit, source, quote, sources = {}) {
  try {
    const sourceText = Object.hasOwn(sources, source) ? sources[source] : await gitText(repoRoot, commit, source);
    return { ok: quoteIsPresent(quote, sourceText ?? '') };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export function repairSerializedEvidenceQuotes(value, sources, repairs = []) {
  if (!value || typeof value !== 'object') return repairs;
  if (typeof value.source === 'string' && typeof value.quote === 'string' && Object.hasOwn(sources, value.source)) {
    const sourceText = sources[value.source] ?? '';
    if (!quoteIsPresent(value.quote, sourceText)) {
      const escaped = value.quote.replaceAll('\r', '\\r').replaceAll('\n', '\\n').replaceAll('\t', '\\t');
      if (escaped !== value.quote && quoteIsPresent(escaped, sourceText)) {
        repairs.push({ source: value.source, before: value.quote, after: escaped });
        value.quote = escaped;
      }
    }
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) repairSerializedEvidenceQuotes(child, sources, repairs);
  return repairs;
}
