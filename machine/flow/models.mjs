// The Lead's own model is one account model, read from its independent setting.
// CommandCode models use the same raw id route as the helpers; Claude and ChatGPT
// use their subscription providers.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { agentModel } from './role-models.mjs';

const ACCOUNT_MODEL = /^[a-z][a-z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9/._:-]*$/;

export function leadModelPath() {
  return process.env.JULIA_LEAD_MODEL_FILE ?? join(homedir(), '.config', 'julia', 'lead-model');
}

export function leadModelId(file = leadModelPath()) {
  let value;
  try {
    value = readFileSync(file, 'utf8').trim();
  } catch (error) {
    if (error.code === 'ENOENT') {
      error.message = `Lead model setting ${file} is missing. Run node scripts/install-lead-model.mjs before starting Studio.`;
    }
    throw error;
  }
  if (!ACCOUNT_MODEL.test(value)) {
    throw new Error(`Lead model setting ${file} must contain one account model id, such as provider/model.`);
  }
  return value;
}

export function buildModel(file) {
  return agentModel(leadModelId(file));
}

// Mastra calls a `model` function at every model call, so a Lead setting saved while Studio
// runs reaches the next call without a restart.
export function buildModelReader(file) {
  return () => buildModel(file ?? leadModelPath());
}
