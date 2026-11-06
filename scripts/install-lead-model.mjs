import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEAD_DEFAULT_MODEL } from '../dashboard/lib/model-settings.js';
import { leadModelPath } from '../machine/flow/models.mjs';

export function installLeadModel(file = leadModelPath()) {
  mkdirSync(dirname(file), { recursive: true });
  try {
    writeFileSync(file, `${LEAD_DEFAULT_MODEL}\n`, { flag: 'wx' });
    return { file, created: true };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return { file, created: false };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { file, created } = installLeadModel();
  console.log(`${created ? 'Created' : 'Kept'} Lead model setting at ${file}.`);
}
