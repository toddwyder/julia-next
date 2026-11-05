import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_LEAD_MODEL } from '../machine/flow/models.mjs';

export function installLeadModel(file = join(homedir(), '.agents', 'lead-model')) {
  mkdirSync(dirname(file), { recursive: true });
  try {
    writeFileSync(file, `${DEFAULT_LEAD_MODEL}\n`, { flag: 'wx' });
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
