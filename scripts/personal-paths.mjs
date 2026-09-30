// personal-paths.mjs -- detects hardcoded personal-machine paths
// (single-backslash, escaped double-backslash, and forward-slash forms).
//
// A personal-machine path default works on exactly one machine and fails with a
// raw, unactionable error everywhere else (caught live during JUL-61).
// This module detects personal paths across scripts so they can be required
// from environment variables instead.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const PERSONAL_PATH = /C:(?:\\\\|[\/\\])Users(?:\\\\|[\/\\])[A-Za-z0-9_.-]+/i;

/**
 * Returns the personal-machine paths found in a piece of text:
 * single-backslash, escaped double-backslash and forward-slash forms.
 *
 * @param {string} text - The text to search for personal-machine paths
 * @returns {string[]} Array of matched personal-machine paths
 */
export function findPersonalPaths(text) {
  if (typeof text !== 'string') return [];
  const matches = text.match(new RegExp(PERSONAL_PATH.source, 'gi'));
  return matches ? Array.from(matches) : [];
}

/**
 * Recursively scans directories or files for non-test .mjs files that
 * hardcode personal-machine paths.
 *
 * @param {string|string[]} target - Path or paths to scan
 * @param {Object} [options] - Options
 * @param {string} [options.baseDir] - Base directory for relative output paths
 * @returns {string[]} Array of relative file paths containing personal paths
 */
export function scanPersonalPaths(target, { baseDir } = {}) {
  const targets = Array.isArray(target) ? target : [target];
  const offenders = [];

  function walk(currentDir, base) {
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      // Generated build output is never source. `.mastra` is `mastra build`'s
      // app bundle; scanning it would flag vendored third-party strings and
      // break CI whenever a build happens to run first (JUL-140).
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.mastra') continue;
      const fullPath = path.join(currentDir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const stat = statSync(fullPath);
          isDir = stat.isDirectory();
          isFile = stat.isFile();
        } catch {
          continue;
        }
      }
      if (isDir) {
        walk(fullPath, base);
      } else if (isFile && entry.name.endsWith('.mjs') && !entry.name.endsWith('.test.mjs')) {
        const contents = readFileSync(fullPath, 'utf8');
        if (findPersonalPaths(contents).length > 0) {
          offenders.push(path.relative(base, fullPath).replaceAll('\\', '/'));
        }
      }
    }
  }

  for (const t of targets) {
    const resolvedTarget = path.resolve(t);
    const resolvedBase = baseDir ? path.resolve(baseDir) : resolvedTarget;
    let stat;
    try {
      stat = statSync(resolvedTarget);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walk(resolvedTarget, resolvedBase);
    } else if (stat.isFile() && resolvedTarget.endsWith('.mjs') && !resolvedTarget.endsWith('.test.mjs')) {
      const contents = readFileSync(resolvedTarget, 'utf8');
      if (findPersonalPaths(contents).length > 0) {
        offenders.push(path.relative(resolvedBase, resolvedTarget).replaceAll('\\', '/'));
      }
    }
  }

  return offenders;
}

export const scanForPersonalPaths = scanPersonalPaths;
