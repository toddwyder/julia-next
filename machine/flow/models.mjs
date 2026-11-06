import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { openaiCodexProvider } from '@mastra/code-sdk/providers/openai-codex';

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
  if (!/^openai\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) {
    throw new Error(`Lead model setting ${file} must contain one openai/<model> value for the ChatGPT subscription.`);
  }
  return value;
}

export function buildModel(file) {
  return openaiCodexProvider(leadModelId(file).slice('openai/'.length));
}
