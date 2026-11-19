import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function listFiles(dir, root) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...listFiles(full, root));
    else results.push(relative(root, full).replaceAll('\\', '/'));
  }
  return results.sort();
}

/** Fails when the retired docs/adr folder exists or holds any document. */
export function checkNoAdrFolder(root = process.cwd()) {
  const adrDir = join(root, 'docs', 'adr');
  if (!existsSync(adrDir)) return [];
  const files = listFiles(adrDir, root);
  const detail = files.length ? `: ${files.join(', ')}` : '';
  return [
    `docs/adr is retired; decisions live in code, checks, and history (git, PRs, Linear). Remove docs/adr${detail}.`,
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = checkNoAdrFolder(resolve(process.argv[2] ?? '.'));
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Retired docs/adr folder is absent.');
  }
}
