#!/usr/bin/env node
// Points `mastracode` on PATH at scripts/mastracode, which gives every session its own trace
// file and folds the sessions that have finished. That path is first on PATH, so it catches
// every launcher: a shell, the dashboard, and a lane started by scripts/lanes.mjs.
//
//   node scripts/install-launcher.mjs
//
// Safe to re-run: it replaces only its own symlink, and anything else it finds at that path
// is moved aside rather than deleted.
import { lstatSync, mkdirSync, readlinkSync, renameSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function launcherPath(home = homedir()) {
  return join(home, '.local', 'bin', 'mastracode');
}

function exists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

export function installLauncher({ home = homedir(), repoDir = REPO } = {}) {
  const link = launcherPath(home);
  const source = join(repoDir, 'scripts', 'mastracode');
  mkdirSync(dirname(link), { recursive: true });
  const present = exists(link);
  if (present && lstatSync(link).isSymbolicLink() && readlinkSync(link) === source) {
    return { link, source, changed: false };
  }
  const movedAside = present ? `${link}.before-launcher-${Date.now()}` : null;
  if (present) renameSync(link, movedAside);
  symlinkSync(source, link);
  return { link, source, changed: true, movedAside };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(installLauncher(), null, 2));
}
