// Which model builds a card is pstack's decision, kept in pstack's model file,
// not a constant in this repository. One edit there changes the build model for
// every card, and this module is the only place that reads it.
//
// The file is one role per line, `roles: value`, with `#` for comments. A value
// of `inherit-parent` or `auto` means the role runs on the session's own model.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MODELS_FILE = path.join(os.homedir(), '.agents', 'pstack-models.md');

// `feature` is the pstack role that writes code for a card; the build step is
// that role, run as a plain agent.
export const BUILD_ROLE = 'feature';

const INHERIT = new Set(['inherit-parent', 'auto']);

// Returns the model id for the role, null when the role inherits the session's
// model, and undefined when the file names no line for the role at all.
export function roleModel(text, role = BUILD_ROLE) {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const roles = line.slice(0, colon).split(',').map(name => name.trim().toLowerCase());
    if (!roles.includes(role.toLowerCase())) continue;
    const value = line.slice(colon + 1).trim().split(/[\s,]/)[0];
    if (!value) continue;
    return INHERIT.has(value.toLowerCase()) ? null : value;
  }
  return undefined;
}

export function buildModel(file = MODELS_FILE) {
  const model = roleModel(fs.readFileSync(file, 'utf8'));
  if (model === undefined) {
    throw new Error(`${file} names no "${BUILD_ROLE}" role, so the build step has no model to run on`);
  }
  return model;
}
