// The Start screen's model choices: the six groups from config/roles.json, the four effort
// levels, and the draft record that keeps a choice across a reload.
//
// A draft looks like this:
//   {
//     version: 1,
//     card: 'JUL-276',
//     updatedAt: '2026-10-29T16:40:00.000Z',
//     effort: 'large',
//     groups: {
//       building: { model: 'openai/gpt-6.1-sol', roles: { 'bug-fix': 'openai/gpt-6.1-sol' } },
//       panels: { models: ['openai/gpt-6.1-sol'], roles: { 'arena-runners': ['openai/gpt-6.1-sol'] } }
//     }
//   }
//
// This module stays free of Node builtins so the client component can import it.

export const DRAFT_VERSION = 1;

export const EFFORTS = Object.freeze([
  {
    id: 'small',
    name: 'Small',
    brains: 1,
    info: 'One brain: the quickest and cheapest. Each step gets less thinking.',
  },
  {
    id: 'medium',
    name: 'Medium',
    brains: 2,
    info: 'Two brains: more care at every step, and still quick.',
  },
  {
    id: 'large',
    name: 'Large',
    brains: 3,
    info: 'Three brains: the everyday setting for real work.',
  },
  {
    id: 'unlimited',
    name: 'Unlimited',
    brains: 4,
    info: 'Four brains: the slowest and most expensive. Use it for the hardest work.',
  },
]);

export const PANEL_MINIMUM = 'A panel needs at least one model.';
export const PANEL_MODEL_ONLY = 'Panels hold a list of models. Change the chips instead.';

const copy = value => JSON.parse(JSON.stringify(value));
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const unique = values => [...new Set(values)];

export function effortById(id) {
  return EFFORTS.find(effort => effort.id === id) ?? EFFORTS[2];
}

// pstack writes `commandcode/deepseek/deepseek-v4.1-flash`; the sweep saves
// `mastracode/commandcode/deepseek/deepseek-v4.1-flash`. Prefer an exact id, then the
// provider-prefixed one, then any id that ends with the wanted name.
export function resolveModelId(wanted, modelIds) {
  if (!wanted) return '';
  if (modelIds.includes(wanted)) return wanted;
  const prefixed = modelIds.find(id => id === `mastracode/${wanted}`);
  if (prefixed) return prefixed;
  return modelIds.find(id => id.endsWith(`/${wanted}`)) ?? '';
}

function defaultModelFor(role, modelIds, fallback) {
  const resolved = resolveModelId(role.default, modelIds);
  return resolved || fallback;
}

// A group's model is the one most of its roles share. On a tie the first role decides,
// and the roles that differ keep their own model and show as set on their own.
export function sharedModel(roleModels) {
  const counts = new Map();
  for (const model of roleModels) {
    if (!model) continue;
    counts.set(model, (counts.get(model) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [model, count] of counts) {
    if (count > bestCount) {
      best = model;
      bestCount = count;
    }
  }
  return best;
}

export function initialChoice({ card = '', groups, modelIds, fallback = '', effort = 'large' }) {
  const choice = {
    version: DRAFT_VERSION,
    card,
    updatedAt: '',
    effort: effortById(effort).id,
    groups: {},
  };
  for (const group of groups) {
    if (group.panel) {
      const models = group.roles.flatMap(role => (role.default ?? []).map(id => resolveModelId(id, modelIds) || fallback))
        .filter(Boolean);
      const shared = unique(models.length ? models : [fallback]);
      choice.groups[group.id] = {
        models: shared,
        roles: Object.fromEntries(group.roles.map(role => [role.id, [...shared]])),
      };
      continue;
    }
    const roleModels = Object.fromEntries(group.roles.map(role => [role.id, defaultModelFor(role, modelIds, fallback)]));
    choice.groups[group.id] = { model: sharedModel(Object.values(roleModels)), roles: roleModels };
  }
  return choice;
}

function groupOf(choice, groupId) {
  const group = choice.groups?.[groupId];
  if (!group) throw new Error(`Unknown group ${groupId}.`);
  return group;
}

export function setGroupModel(choice, groupId, modelId) {
  const group = groupOf(choice, groupId);
  if (group.models) throw new Error(PANEL_MODEL_ONLY);
  if (typeof modelId !== 'string' || !modelId) throw new Error('A model is needed.');
  const next = copy(choice);
  const target = next.groups[groupId];
  target.model = modelId;
  for (const roleId of Object.keys(target.roles)) target.roles[roleId] = modelId;
  return next;
}

export function setRoleModel(choice, groupId, roleId, modelId) {
  const group = groupOf(choice, groupId);
  if (group.models) throw new Error(PANEL_MODEL_ONLY);
  if (!(roleId in group.roles)) throw new Error(`Unknown role ${roleId}.`);
  if (typeof modelId !== 'string' || !modelId) throw new Error('A model is needed.');
  const next = copy(choice);
  next.groups[groupId].roles[roleId] = modelId;
  return next;
}

export function setEffort(choice, effortId) {
  if (!EFFORTS.some(effort => effort.id === effortId)) throw new Error(`Unknown effort ${effortId}.`);
  const next = copy(choice);
  next.effort = effortId;
  return next;
}

export function isRoleOverride(choice, groupId, roleId) {
  const group = groupOf(choice, groupId);
  if (group.models) {
    const roleModels = group.roles[roleId] ?? [];
    return roleModels.length !== group.models.length || roleModels.some((model, at) => model !== group.models[at]);
  }
  return group.roles[roleId] !== group.model;
}

export function addPanelModel(choice, groupId, modelId, roleId = '') {
  const group = groupOf(choice, groupId);
  if (!group.models) throw new Error('Only panels hold a list of models.');
  if (typeof modelId !== 'string' || !modelId) throw new Error('A model is needed.');
  if (roleId && !(roleId in group.roles)) throw new Error(`Unknown role ${roleId}.`);
  const next = copy(choice);
  const target = next.groups[groupId];
  if (roleId) {
    target.roles[roleId] = unique([...target.roles[roleId], modelId]);
    return next;
  }
  target.models = unique([...target.models, modelId]);
  for (const id of Object.keys(target.roles)) target.roles[id] = unique([...target.roles[id], modelId]);
  return next;
}

export function removePanelModel(choice, groupId, modelId, roleId = '') {
  const group = groupOf(choice, groupId);
  if (!group.models) throw new Error('Only panels hold a list of models.');
  if (roleId && !(roleId in group.roles)) throw new Error(`Unknown role ${roleId}.`);
  if (roleId) {
    const remaining = group.roles[roleId].filter(id => id !== modelId);
    if (remaining.length === 0) throw new Error(PANEL_MINIMUM);
    const next = copy(choice);
    next.groups[groupId].roles[roleId] = remaining;
    return next;
  }
  const remaining = group.models.filter(id => id !== modelId);
  if (remaining.length === 0) throw new Error(PANEL_MINIMUM);
  const next = copy(choice);
  const target = next.groups[groupId];
  target.models = remaining;
  for (const id of Object.keys(target.roles)) {
    const roleRemaining = target.roles[id].filter(model => model !== modelId);
    target.roles[id] = roleRemaining.length ? roleRemaining : [...remaining];
  }
  return next;
}

// A saved draft is untrusted: the file may have been hand-edited, a model may have retired,
// or a group may have changed. Anything unknown falls back to the fresh choice, and every
// group and role in the config is always present.
export function mergeDraft({ saved, fallback, modelIds = [] }) {
  if (!isObject(saved) || !isObject(saved.groups)) return copy(fallback);
  const known = id => typeof id === 'string' && modelIds.includes(id);
  const merged = copy(fallback);
  merged.effort = EFFORTS.some(effort => effort.id === saved.effort) ? saved.effort : fallback.effort;
  for (const [groupId, fresh] of Object.entries(fallback.groups)) {
    const kept = saved.groups[groupId];
    if (!isObject(kept)) continue;
    if (fresh.models) {
      const models = Array.isArray(kept.models) ? unique(kept.models.filter(known)) : [];
      merged.groups[groupId].models = models.length ? models : [...fresh.models];
      for (const roleId of Object.keys(fresh.roles)) {
        const roleModels = Array.isArray(kept.roles?.[roleId]) ? unique(kept.roles[roleId].filter(known)) : [];
        merged.groups[groupId].roles[roleId] = roleModels.length ? roleModels : [...merged.groups[groupId].models];
      }
      continue;
    }
    merged.groups[groupId].model = known(kept.model) ? kept.model : fresh.model;
    for (const roleId of Object.keys(fresh.roles)) {
      const model = kept.roles?.[roleId];
      merged.groups[groupId].roles[roleId] = known(model) ? model : merged.groups[groupId].model;
    }
  }
  return merged;
}
