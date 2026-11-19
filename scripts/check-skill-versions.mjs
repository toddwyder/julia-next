import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readPin } from './check-pstack-pin.mjs';

export function checkSkillVersions(root = process.cwd()) {
  const problems = [];
  const lockPath = join(root, 'skills-lock.json');
  if (!existsSync(lockPath)) {
    return { problems: [`Missing skills-lock.json at ${lockPath}`] };
  }

  let lock;
  try {
    lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch (error) {
    return { problems: [`Invalid skills-lock.json: ${error instanceof Error ? error.message : String(error)}`] };
  }

  const skills = lock?.skills && typeof lock.skills === 'object' ? lock.skills : {};
  let pstackPin = null;
  try {
    pstackPin = readPin(root);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }

  const refsBySource = new Map();
  for (const [name, entry] of Object.entries(skills)) {
    const source = entry?.source;
    const ref = entry?.ref;
    if (!source || !ref) {
      problems.push(`skills-lock.json entry "${name}" is missing source or ref`);
      continue;
    }
    if (!refsBySource.has(source)) refsBySource.set(source, new Map());
    const byRef = refsBySource.get(source);
    if (!byRef.has(ref)) byRef.set(ref, []);
    byRef.get(ref).push(name);

    if (source === 'backnotprop/pstack' && pstackPin && ref !== pstackPin.commit) {
      problems.push(
        `skills-lock.json entry "${name}" has ref ${ref}, which disagrees with .agents/skills/PSTACK-SOURCE.md Commit ${pstackPin.commit}`,
      );
    }
  }

  for (const [source, byRef] of refsBySource) {
    if (byRef.size > 1) {
      const summary = [...byRef.entries()]
        .map(([ref, names]) => `${ref} (${names.slice(0, 3).join(', ')}${names.length > 3 ? `, +${names.length - 3} more` : ''})`)
        .join(' vs ');
      problems.push(`skills-lock.json records disagreeing versions for ${source}: ${summary}`);
    }
  }

  return { problems, pstackPin, refsBySource };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? '.');
  const { problems } = checkSkillVersions(root);
  if (problems.length > 0) {
    console.error(`Skill version check failed:\n${problems.map(p => `- ${p}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('All installed skill version records agree.');
  }
}
