import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoots = ['.agents/skills', '.claude/skills'];

function skillFiles(root) {
  const files = [];
  const visit = directory => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name === 'SKILL.md') files.push(path);
    }
  };
  for (const directory of skillRoots) visit(resolve(root, directory));
  return files.sort();
}

function declaredName(path) {
  const text = readFileSync(path, 'utf8');
  const frontmatter = text.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/)?.[1] ?? '';
  return frontmatter.match(/^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m)?.[1];
}

export function checkSkillNames(root = process.cwd()) {
  const declarations = new Map();
  for (const path of skillFiles(root)) {
    const name = declaredName(path);
    if (!name) continue;
    const paths = declarations.get(name) ?? [];
    paths.push(relative(root, path).replaceAll('\\', '/'));
    declarations.set(name, paths);
  }
  return [...declarations.entries()]
    .filter(([, paths]) => paths.length > 1)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, paths]) => `duplicate skill name "${name}": ${paths.join(', ')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = checkSkillNames(resolve(process.argv[2] ?? '.'));
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else console.log('Every installed skill name is unique.');
}
