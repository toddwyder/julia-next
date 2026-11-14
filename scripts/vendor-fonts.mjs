#!/usr/bin/env node
// Copies each font and its licence out of the pinned Fontsource package into
// the repository. Rerunning it must leave `git diff` empty, which is how a
// reviewer proves where the files came from.

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scratchDir } from './scratch-dir.mjs';

const root = resolve(fileURLToPath(import.meta.url), '../..');

const FONTS = [
  {
    package: '@fontsource-variable/playfair-display',
    version: '5.3.0',
    files: ['playfair-display-latin-wght-normal.woff2', 'playfair-display-latin-wght-italic.woff2'],
    into: 'app/fonts/playfair-display',
  },
  {
    package: '@fontsource-variable/inter',
    version: '5.3.0',
    files: ['inter-latin-wght-normal.woff2'],
    into: 'app/fonts/inter',
  },
  {
    package: '@fontsource-variable/roboto-mono',
    version: '5.3.0',
    files: ['roboto-mono-latin-wght-normal.woff2'],
    into: 'app/fonts/roboto-mono',
  },
  {
    package: '@fontsource-variable/public-sans',
    version: '5.3.0',
    files: ['public-sans-latin-wght-normal.woff2'],
    into: 'dashboard/app/fonts/public-sans',
  },
];

function vendor({ package: name, version, files, into }, work) {
  const tarball = execFileSync('npm', ['pack', `${name}@${version}`, '--silent', '--pack-destination', work], { encoding: 'utf8' }).trim();
  const unpacked = mkdtempSync(join(work, 'unpacked-'));
  execFileSync('tar', ['xzf', join(work, tarball), '-C', unpacked]);
  const target = join(root, into);
  mkdirSync(target, { recursive: true });
  for (const file of files) copyFileSync(join(unpacked, 'package/files', file), join(target, file));
  copyFileSync(join(unpacked, 'package/LICENSE'), join(target, 'LICENSE'));
  return readdirSync(target).length;
}

mkdirSync(scratchDir, { recursive: true });
const work = mkdtempSync(join(scratchDir, 'vendor-fonts-'));
try {
  for (const font of FONTS) console.log(`${font.into}: ${vendor(font, work)} files from ${font.package}@${font.version}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
