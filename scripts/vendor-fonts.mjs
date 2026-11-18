#!/usr/bin/env node
// Copies the font files the apps render out of the pinned Fontsource packages
// and into the repository, so a build reads them from disk and never asks a
// font service for anything. Run it by hand after changing a version or a file
// list, then commit what it writes. No install or build runs this script, and
// no Fontsource package is listed in any package.json: the pinned manifest
// below is the only record of where a committed file came from.

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// latin only: every page renders the latin range, and the other subsets would
// be dead weight in the repository.
export const MANIFEST = [
  {
    pkg: '@fontsource-variable/playfair-display',
    version: '5.3.0',
    dir: 'app/fonts/playfair-display',
    files: ['files/playfair-display-latin-wght-normal.woff2', 'files/playfair-display-latin-wght-italic.woff2'],
  },
  {
    pkg: '@fontsource-variable/inter',
    version: '5.3.0',
    dir: 'app/fonts/inter',
    files: ['files/inter-latin-wght-normal.woff2'],
  },
  {
    pkg: '@fontsource-variable/roboto-mono',
    version: '5.3.0',
    dir: 'app/fonts/roboto-mono',
    files: ['files/roboto-mono-latin-wght-normal.woff2'],
  },
  {
    pkg: '@fontsource-variable/public-sans',
    version: '5.3.0',
    dir: 'dashboard/app/fonts/public-sans',
    files: ['files/public-sans-latin-wght-normal.woff2'],
  },
];

function unpack(entry, work) {
  const archive = execFileSync('npm', ['pack', `${entry.pkg}@${entry.version}`, '--pack-destination', work, '--silent'], {
    encoding: 'utf8',
  }).trim().split('\n').pop();
  const into = join(work, entry.dir.replaceAll('/', '-'));
  mkdirSync(into, { recursive: true });
  execFileSync('tar', ['-xzf', join(work, archive), '-C', into]);
  return join(into, 'package');
}

export function vendorFonts({ root = DEFAULT_ROOT, manifest = MANIFEST } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'vendor-fonts-'));
  try {
    const written = [];
    for (const entry of manifest) {
      const packed = unpack(entry, work);
      const dir = resolve(root, entry.dir);
      mkdirSync(dir, { recursive: true });
      for (const file of entry.files) {
        copyFileSync(join(packed, file), join(dir, basename(file)));
        written.push(join(entry.dir, basename(file)));
      }
      copyFileSync(join(packed, 'LICENSE'), join(dir, 'OFL.txt'));
      written.push(join(entry.dir, 'OFL.txt'));
    }
    return written;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main(args) {
  const root = resolve(args.includes('--root') ? args[args.indexOf('--root') + 1] : DEFAULT_ROOT);
  for (const file of vendorFonts({ root })) console.log(file);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
