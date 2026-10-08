// The delivery route has exactly two independently selected workers. Keep this
// contract intentionally small: it is configuration validation, not a worker
// or permissions framework.
import { readFile } from 'node:fs/promises';

const TOOLS = Object.freeze({
  'Claude Code': Object.freeze({ maker: 'Anthropic', models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'] }),
  Codex: Object.freeze({ maker: 'OpenAI', models: ['gpt-5.5'] }),
  'Command Code': Object.freeze({ maker: 'DeepSeek', models: ['deepseek-v4-pro', 'deepseek-v4-flash'] }),
});
const ROLES = Object.freeze(['builder', 'reviewer']);

function reject(reason) {
  throw new Error(`delivery-tool settings: ${reason}`);
}

function validateRole(role, choice) {
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
    reject(`${role} must name a tool, model, and maker`);
  }
  const extra = Object.keys(choice).filter((key) => !['tool', 'model', 'maker'].includes(key));
  if (extra.length > 0) reject(`${role} contains unsupported setting "${extra[0]}"`);
  for (const key of ['tool', 'model', 'maker']) {
    if (typeof choice[key] !== 'string' || choice[key].trim() === '') reject(`${role} ${key} must be a non-empty string`);
  }
  const tool = TOOLS[choice.tool];
  if (!tool) reject(`${role} tool ${JSON.stringify(choice.tool)} is not supported; use Claude Code, Codex, or Command Code`);
  if (choice.maker !== tool.maker) reject(`${role} maker ${JSON.stringify(choice.maker)} does not match ${choice.tool} (${tool.maker})`);
  if (!tool.models.includes(choice.model)) reject(`${role} model ${JSON.stringify(choice.model)} is not supported by ${choice.tool}`);
}

export function validateDeliveryToolSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) reject('must be an object');
  const extra = Object.keys(settings).filter((key) => !ROLES.includes(key));
  if (extra.length > 0) reject(`contains unsupported role "${extra[0]}"; only builder and reviewer are allowed`);
  for (const role of ROLES) validateRole(role, settings[role]);
  if (settings.builder.maker === settings.reviewer.maker) {
    reject(`builder and reviewer both name maker ${JSON.stringify(settings.builder.maker)}; they must use different makers`);
  }
  return settings;
}

export async function loadDeliveryToolSettings(path, { read = readFile } = {}) {
  let settings;
  try {
    settings = JSON.parse(await read(path, 'utf8'));
  } catch (error) {
    reject(`could not read ${path}: ${error.message}`);
  }
  return validateDeliveryToolSettings(settings);
}

// The runner will supply its real launcher in a later card. Validation happens
// once, before either role is handed to that launcher.
export async function startDeliveryWorkers(path, launch, dependencies = {}) {
  const settings = await loadDeliveryToolSettings(path, dependencies);
  for (const role of ROLES) await launch(role, settings[role]);
}
