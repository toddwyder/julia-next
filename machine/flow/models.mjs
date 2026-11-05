// Which model a stage runs on. The pstack settings file holds one line per
// role, so a model change is a settings change and never an edit of a stage.
// A machine with no settings file falls back to the free model, which is what
// a boot of the dev server on a bare machine needs.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { FREE_MODEL } from './schema.mjs';

// The build stage does the work pstack gives to the feature role.
export const BUILD_ROLE = 'feature, refactoring';

export function settingsPath() {
  return join(homedir(), '.agents', 'pstack-models.md');
}

export function modelForRole(role, file = settingsPath()) {
  if (!existsSync(file)) return null;
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((row) => row.toLowerCase().startsWith(`${role.toLowerCase()}:`));
  if (!line) return null;
  const value = line.slice(line.indexOf(':') + 1).trim();
  if (!value || value === 'auto' || value === 'inherit-parent') return null;
  return value.split(',')[0].trim();
}

export function buildModel(file) {
  return modelForRole(BUILD_ROLE, file) ?? FREE_MODEL;
}
