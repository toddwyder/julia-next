import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HARNESS_OR_FILE_MENTIONS = /\b(?:Claude Code|CLAUDE\.md|claude-code\.md)\b|\.claude\/|\.commandcode\//gi;

const MODEL_PATTERN = new RegExp(
  [
    '\\b(?:' +
      [
        'claude', 'opus', 'sonnet', 'haiku', 'gpt', 'grok', 'deepseek', 'kimi', 'gemini', 'llama',
        'mistral', 'qwen', 'beam', 'sol', 'fable', 'argon', 'inkling', 'glyph',
        ':free',
      ].join('|') +
    ')\\b',
    '(?<![.\\w/])(?:anthropic|openai|commandcode|reflection|moonshotai|opencode|kilo)\\/',
  ].join('|'),
  'i',
);

function walkMarkdown(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkMarkdown(full));
    else if (entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

function topLevelMarkdown(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => join(dir, entry.name));
}

function agentFacingDocs(root) {
  const candidates = [
    join(root, 'AGENTS.md'),
    join(root, 'GLOSSARY.md'),
    join(root, 'docs', 'pstack-deviations.md'),
    ...walkMarkdown(join(root, 'docs', 'plans')),
    ...topLevelMarkdown(join(root, 'docs', 'agents')),
    ...walkMarkdown(join(root, 'docs', 'harness')),
  ];
  return candidates.filter(existsSync).sort();
}

/** Checks that agent-facing docs name kinds of model only (free or paid), never specific models. */
export function checkDocModels(root = process.cwd()) {
  const failures = [];
  for (const file of agentFacingDocs(root)) {
    const rel = relative(root, file).replaceAll('\\', '/');
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const cleaned = line.replace(HARNESS_OR_FILE_MENTIONS, ' ');
      const match = MODEL_PATTERN.exec(cleaned);
      if (match) {
        failures.push(
          `${rel}:${index + 1}: specific model "${match[0]}" found; agent-facing docs must name kinds of model only (free or paid).`,
        );
      }
    }
  }
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = checkDocModels(resolve(process.argv[2] ?? '.'));
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Agent-facing docs name kinds of model only.');
  }
}
