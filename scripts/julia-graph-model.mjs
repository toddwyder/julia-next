// Resolve the graph's two selected model labels through the shared catalog.
// A known label with no installed launcher is refused; it is never replaced
// with a different vendor because that would make the card name the wrong one.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FAMILY_OF } from '../graph/seat-table.mjs';
import { MODEL_CATALOG } from './seat-labels.mjs';

const MAKER = Object.freeze({ openai: 'OpenAI', google: 'Google', deepseek: 'DeepSeek' });
const LAUNCH = Object.freeze({
  codex: Object.freeze({ account: 'runner', name: 'Codex', installedModel: 'gpt-5.5' }),
  gemini: Object.freeze({ account: 'gemini-worker', name: 'Gemini 3.8 Flash' }),
  'pi-deepseek': Object.freeze({ account: 'runner', name: 'DeepSeek V4 Pro (Pi)' }),
});
const SUPPORTED = Object.freeze({
  builder: Object.freeze(['builder-codex', 'builder-gemini-flash']),
  reviewer: Object.freeze(['adversary-codex', 'adversary-gemini-flash', 'adversary-deepseek-pro']),
});

export function resolveChoice(role, label) {
  const prefix = role === 'builder' ? 'builder-' : role === 'reviewer' ? 'adversary-' : null;
  if (!prefix || typeof label !== 'string' || !label.startsWith(prefix) || !MODEL_CATALOG[label]) {
    throw new Error(`unknown model choice for ${role}: ${JSON.stringify(label)}`);
  }
  const { entry, model } = MODEL_CATALOG[label];
  if (!SUPPORTED[role].includes(label)) throw new Error(`no installed graph launch route for ${label}`);
  const route = LAUNCH[entry];
  const maker = MAKER[FAMILY_OF[entry]];
  if (!route || !maker) throw new Error(`no installed graph launch route for ${label}`);
  const { installedModel, ...launcher } = route;
  return { label, entry, model: model ?? installedModel, maker, ...launcher };
}

export function resolvePair(builderLabel, reviewerLabel) {
  const builder = resolveChoice('builder', builderLabel);
  const reviewer = resolveChoice('reviewer', reviewerLabel);
  if (builder.maker === reviewer.maker) {
    throw new Error(`builder and reviewer must come from different model makers (${builder.maker})`);
  }
  return { builder, reviewer };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(resolvePair(process.argv[2], process.argv[3]))}\n`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
