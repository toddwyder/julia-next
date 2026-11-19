import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function trackedFiles(root) {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  return new Set(output.split('\0').filter(Boolean));
}

function installedPackages(root) {
  const packages = new Set();
  for (const manifest of ['package.json', 'dashboard/package.json']) {
    const full = join(root, manifest);
    if (!existsSync(full)) continue;
    const pkg = JSON.parse(readFileSync(full, 'utf8'));
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const name of Object.keys(pkg[section] ?? {})) {
        packages.add(name);
      }
    }
  }
  return packages;
}

/** Fails when graphify-out/graph.json references any source outside git-tracked files or installed packages. */
export function checkGraphSources(root = process.cwd()) {
  const graphPath = join(root, 'graphify-out', 'graph.json');
  if (!existsSync(graphPath)) {
    return [`Missing ${graphPath}`];
  }
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
  const tracked = trackedFiles(root);
  const packages = installedPackages(root);
  const allowed = source => tracked.has(source) || packages.has(source);

  const failures = [];
  for (const [kind, entries] of [
    ['node', graph.nodes ?? []],
    ['link', graph.links ?? []],
    ['hyperedge', graph.hyperedges ?? []],
  ]) {
    for (const [index, entry] of entries.entries()) {
      const source = entry?.source_file;
      if (!source || allowed(source)) continue;
      const label = entry.id ?? entry.label ?? `#${index}`;
      failures.push(`${kind} ${label}: source "${source}" is not in git ls-files or package.json`);
    }
  }
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = checkGraphSources(resolve(process.argv[2] ?? '.'));
  if (failures.length) {
    console.error(`Graph source check failed (${failures.length} outside source entries):\n${failures.slice(0, 20).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('Every graph entry comes from a tracked repository path or installed package.');
  }
}
