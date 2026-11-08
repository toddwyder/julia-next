import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { parsePstack, ROLE_GROUPS, stageModels } from '../../dashboard/lib/model-settings.js';
import { roleModelIds } from '../../dashboard/lib/roles.js';
import { opencodeClaudeMaxProvider } from '@mastra/code-sdk/providers/claude-max';
import { openaiCodexProvider } from '@mastra/code-sdk/providers/openai-codex';

export function roleModelsPath() {
  return process.env.JULIA_LEAD_ROLE_MODELS_FILE ?? join(homedir(), '.config', 'julia', 'lead-role-models.md');
}

// The picker's file is the machine's only role models file. pstack's own
// `~/.agents/pstack-models.md` belongs to the sessions Todd runs by hand and is never read here.
export function readRoleModels(file = roleModelsPath()) {
  let text = '';
  try { text = readFileSync(file, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const saved = parsePstack(text).roles;
  return ROLE_GROUPS.filter(group => !group.machine).flatMap(group => group.roles.map(role => {
    const stored = saved.get(role.name);
    if (!stored) throw new Error(`Missing ${role.name} pick in ${file}.`);
    const models = roleModelIds(role, stored);
    if (!models.length || models.some(id => !/^[a-z][a-z0-9-]*\/[a-zA-Z0-9][a-zA-Z0-9/._:-]*$/.test(id))) {
      throw new Error(`Invalid Lead model for ${role.name} in ${file}.`);
    }
    if (!group.panel && models.length !== 1) throw new Error(`${role.name} needs one Lead model in ${file}.`);
    return { ...role, group: group.id, models };
  }));
}

// The Shipping, Remediation and Retro stages read their own saved lines. A missing line
// stops here and names the stage instead of letting a built-in model answer for it.
export function readStageModels(file = roleModelsPath()) {
  return stageModels(file);
}

// Mastra names a Lead subagent tool `agent-<key>`, so this key is also the tool name a Studio
// trace shows. The checker reads that name, so the agent map and the checker share this definition.
export function helperKey(role, index = 0) {
  const base = role.id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  return `${base}${role.models.length > 1 ? index + 1 : ''}`;
}

export function agentModel(id) {
  if (id.startsWith('openai/')) return openaiCodexProvider(id.slice('openai/'.length));
  if (id.startsWith('anthropic/')) return opencodeClaudeMaxProvider(id.slice('anthropic/'.length));
  return id;
}
