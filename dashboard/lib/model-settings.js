import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { initialChoice, sharedModel } from './roles.js';
import ROLES from '../config/roles.json' with { type: 'json' };

export const ROLE_GROUPS = ROLES.groups;
const EFFORT = { unlimited: 'max', large: 'xhigh', medium: 'high', small: 'medium' };

// The model a Lead run uses before anyone saves a pick: what scripts/install-lead-model.mjs
// writes into the Lead setting file on a fresh machine.
export const LEAD_DEFAULT_MODEL = 'openai/gpt-6.1-sol';

export function settingsPaths(home = homedir()) {
  return {
    pstack: join(home, '.config', 'julia', 'lead-role-models.md'),
    lead: join(home, '.config', 'julia', 'lead-model'),
  };
}

function readSetting(file) {
  try { return readFileSync(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function parsePstack(text = '') {
  const roles = new Map();
  for (const line of text.split('\n')) {
    const at = line.indexOf(':');
    if (at < 0 || line.startsWith('#')) continue;
    roles.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  const budget = text.match(/^# budget: (unlimited|large|medium|small)\b/m)?.[1] ?? 'medium';
  return { budget, roles };
}

export function readSettings({ paths = settingsPaths(), modelIds = [] } = {}) {
  const parsed = parsePstack(readSetting(paths.pstack) ?? '');
  const choice = initialChoice({ groups: ROLE_GROUPS, modelIds, effort: parsed.budget });
  for (const group of ROLE_GROUPS) {
    const target = choice.groups[group.id];
    for (const role of group.roles) {
      const value = parsed.roles.get(role.name);
      if (value) target.roles[role.id] = group.panel ? value.split(',').map(id => id.trim()) : value;
    }
    if (group.panel) target.models = [...new Set(Object.values(target.roles).flat())];
    else target.model = sharedModel(Object.values(target.roles));
  }
  choice.lead = readSetting(paths.lead)?.trim() || LEAD_DEFAULT_MODEL;
  return choice;
}

export function leadModels(models) {
  return models.filter(model => model.provider === 'openai' && /^openai\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model.id));
}

export function formatSettings(choice, models) {
  const offered = new Set(models.map(model => model.id));
  const check = (id, role) => {
    if (typeof id !== 'string' || !offered.has(id) || /[\r\n,]/.test(id)) {
      throw new Error(`Choose an available account model for ${role}.`);
    }
    return id;
  };
  if (!Object.hasOwn(EFFORT, choice?.effort)) throw new Error('Choose a valid effort.');
  if (!leadModels(models).some(model => model.id === choice.lead)) {
    throw new Error('Choose an available ChatGPT model for Lead.');
  }
  const lines = [`# budget: ${choice.effort} (${EFFORT[choice.effort]})`];
  for (const group of ROLE_GROUPS) {
    for (const role of group.roles) {
      const value = choice.groups?.[group.id]?.roles?.[role.id];
      if (group.panel) {
        if (!Array.isArray(value) || !value.length) throw new Error(`Choose at least one model for ${role.name}.`);
        lines.push(`${role.name}: ${[...new Set(value.map(id => check(id, role.name)))].join(', ')}`);
      } else lines.push(`${role.name}: ${check(value, role.name)}`);
    }
  }
  return { pstack: `${lines.join('\n')}\n`, lead: `${choice.lead}\n` };
}

export function saveSettings(choice, { models, paths = settingsPaths() }) {
  const contents = formatSettings(choice, models);
  const files = Object.entries(paths).map(([key, file]) => ({
    file, text: contents[key], before: readSetting(file), temporary: `${file}.${randomUUID()}.tmp`,
  }));
  const replaced = [];
  try {
    for (const item of files) {
      mkdirSync(dirname(item.file), { recursive: true });
      writeFileSync(item.temporary, item.text, { mode: 0o600, flag: 'wx' });
    }
    for (const item of files) {
      renameSync(item.temporary, item.file);
      replaced.push(item);
    }
  } catch (error) {
    for (const item of replaced.reverse()) {
      try {
        if (item.before === null) rmSync(item.file);
        else {
          writeFileSync(item.temporary, item.before, { mode: 0o600 });
          renameSync(item.temporary, item.file);
        }
      } catch (rollback) {
        throw new AggregateError([error, rollback], 'Settings could not be saved or restored. Check both settings files before restarting Studio.');
      }
    }
    throw error;
  } finally {
    for (const item of files) rmSync(item.temporary, { force: true });
  }
  return { updatedAt: new Date().toISOString() };
}
