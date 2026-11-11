import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoots = ['app', 'dashboard/app'];
const buildRoots = ['.next', 'dashboard/.next'];
const sourceExtensions = /\.(?:[cm]?[jt]sx?|css|html)$/;
const buildExtensions = /\.(?:css|html|js|json|rsc|txt)$/;
const skipped = new Set(['node_modules', 'cache', 'dev']);

const rules = [
  { name: 'next/font/google import', pattern: /next\/font\/google/g },
  { name: 'Google Fonts address', pattern: /https?:\/\/fonts\.(?:googleapis|gstatic)\.com[^\s"'`)\\]*/g },
  { name: 'external stylesheet font address', pattern: /@import\s+(?:url\()?\s*["']?https?:\/\/[^"')\s;]*font[^"')\s;]*/gi },
  { name: 'external font file address', pattern: /https?:\/\/[^\s"'`)\\]+\.(?:woff2?|ttf|otf|eot)(?![\w])/gi },
  { name: 'external font stylesheet link', pattern: /<link[^>]+href=["']https?:\/\/[^"']*font[^"']*["']/gi },
];

function filesUnder(directory, extensions) {
  if (!existsSync(directory)) return [];
  const files = [];
  const visit = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!skipped.has(entry.name)) visit(path);
      } else if (extensions.test(entry.name)) files.push(path);
    }
  };
  visit(directory);
  return files.sort();
}

export function checkFontHosts(root) {
  const failures = [];
  const scans = [
    ...sourceRoots.map(directory => [directory, sourceExtensions]),
    ...buildRoots.map(directory => [directory, buildExtensions]),
  ];
  for (const [directory, extensions] of scans) {
    for (const path of filesUnder(resolve(root, directory), extensions)) {
      const lines = readFileSync(path, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const { name, pattern } of rules) {
          for (const match of line.matchAll(pattern)) {
            failures.push(`${relative(root, path).replaceAll('\\', '/')}:${index + 1}: ${name}: ${match[0].slice(0, 120)}`);
          }
        }
      });
    }
  }
  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = checkFontHosts(resolve(process.argv[2] ?? '.'));
  if (failures.length) {
    console.error(`Fonts must be served from this repository, not an outside host:\n${failures.join('\n')}`);
    process.exitCode = 1;
  } else console.log('Every font is served from this repository.');
}
