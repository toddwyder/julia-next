import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const entryPoints = ['AGENTS.md', 'CLAUDE.md', 'CODING_STANDARDS.md'];

function agentReadFiles(root) {
  const files = entryPoints.map(file => resolve(root, file));
  const visit = directory => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name === 'SKILL.md') files.push(path);
    }
  };
  visit(resolve(root, '.agents/skills'));
  visit(resolve(root, '.claude/skills'));
  const recoveryPrompt = resolve(root, 'scripts/julia-delivery-recovery.mjs');
  if (existsSync(recoveryPrompt)) files.push(recoveryPrompt);
  return files;
}

function headingIds(text) {
  const counts = new Map();
  return text.split('\n').filter(line => /^#{1,6} /.test(line)).map(line => {
    const slug = line.replace(/^#+\s+/, '').replace(/\s+#+\s*$/, '').toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-');
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    return count ? `${slug}-${count}` : slug;
  });
}

export function checkAgentLinks(root = process.cwd()) {
  const failures = [];
  for (const source of agentReadFiles(root)) {
    const file = relative(root, source).replaceAll('\\', '/');
    if (!existsSync(source)) {
      failures.push(`${file}:1: missing entry point; restore ${file}`);
      continue;
    }
    const lines = readFileSync(source, 'utf8').split('\n');
    let inFence = false;
    for (const [index, line] of lines.entries()) {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const isSkill = file.endsWith('/SKILL.md');
      const references = [...line.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)]
        .map(match => match[1])
        .map(destination => ({ destination, bases: [dirname(source)] }));
      for (const match of line.matchAll(/^@([^\s]+)$/g)) references.push({ destination: match[1], bases: [dirname(source)] });
      const prose = line.replace(/\[[^\]]*\]\([^)]*\)/g, '').replace(/\b[\w+.-]+:\/\/\S+/g, '');
      for (const match of prose.matchAll(/(?<![\w:/\\])(?:\.?[\w@-]+\/)+[\w@.-]*/g)) {
        const destination = match[0].replace(/\.$/, '');
        if (destination.startsWith('node_modules/') || line.slice(match.index + match[0].length).startsWith('<')) continue;
        const isEntryPoint = entryPoints.includes(file);
        const isRepositoryPath = /^(?:\.agents|\.claude)\/skills\/.+\/SKILL\.md$/.test(destination);
        const isSkillResource = /^(?:references|playbooks)\//.test(destination)
          || /^scripts\/.+\.[a-z][\w-]*$/i.test(destination);
        if (!isEntryPoint && !isRepositoryPath && !(isSkill && isSkillResource)) continue;
        const bases = isSkill && isSkillResource ? [dirname(source), root] : [root];
        if (destination.endsWith('/') || /\.[a-z][\w-]*$/i.test(destination)) references.push({ destination, bases });
      }
      for (const { destination, bases } of references) {
        if (/^[\w+.-]+:/.test(destination)) continue;
        const [path, fragment] = destination.split('#');
        const targets = path
          ? [...new Set(bases.map(base => resolve(base, decodeURIComponent(path))))]
          : [source];
        const target = targets.find(existsSync);
        const label = `${file}:${index + 1}: ${destination}`;
        if (!target) failures.push(`${label} does not exist; fix the reference or restore ${targets.map(candidate => relative(root, candidate)).join(' or ')}`);
        else if (fragment && !headingIds(readFileSync(target, 'utf8')).includes(decodeURIComponent(fragment))) {
          failures.push(`${label} has no matching heading; link to a current heading in ${relative(root, target)}`);
        }
      }
    }
  }
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = checkAgentLinks(resolve(process.argv[2] ?? '.'));
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else console.log('Agent-read file destinations exist and heading links resolve.');
}
