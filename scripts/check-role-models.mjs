import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_MODEL = 'commandcode/deepseek/deepseek-v4.1-flash';

/**
 * Fails when any role in dashboard/config/roles.json, any model in
 * dashboard/config/defaults.json, or LEAD_DEFAULT_MODEL in
 * dashboard/lib/model-settings.js names a model other than REQUIRED_MODEL.
 */
export function checkRoleModels(root = process.cwd()) {
  const failures = [];

  const rolesPath = join(root, 'dashboard', 'config', 'roles.json');
  const rolesData = JSON.parse(readFileSync(rolesPath, 'utf8'));
  for (const group of rolesData.groups ?? []) {
    for (const role of group.roles ?? []) {
      const defaults = Array.isArray(role.default) ? role.default : [role.default];
      if (defaults.length === 0) {
        failures.push(`dashboard/config/roles.json: ${group.id}/${role.id} has no default model.`);
        continue;
      }
      for (const model of defaults) {
        if (model !== REQUIRED_MODEL) {
          failures.push(`dashboard/config/roles.json: ${group.id}/${role.id} (${role.name}) names "${model}", expected "${REQUIRED_MODEL}".`);
        }
      }
    }
  }

  const defaultsPath = join(root, 'dashboard', 'config', 'defaults.json');
  const defaultsData = JSON.parse(readFileSync(defaultsPath, 'utf8'));
  for (const key of ['mainSession', 'shipping']) {
    if (defaultsData[key] !== REQUIRED_MODEL) {
      failures.push(`dashboard/config/defaults.json: ${key} names "${defaultsData[key]}", expected "${REQUIRED_MODEL}".`);
    }
  }

  const modelSettingsPath = join(root, 'dashboard', 'lib', 'model-settings.js');
  const modelSettingsSource = readFileSync(modelSettingsPath, 'utf8');
  const leadMatch = modelSettingsSource.match(/export const LEAD_DEFAULT_MODEL\s*=\s*(['"`])([^'"`]+)\1/);
  if (!leadMatch) {
    failures.push('dashboard/lib/model-settings.js: LEAD_DEFAULT_MODEL constant not found.');
  } else if (leadMatch[2] !== REQUIRED_MODEL) {
    failures.push(`dashboard/lib/model-settings.js: LEAD_DEFAULT_MODEL names "${leadMatch[2]}", expected "${REQUIRED_MODEL}".`);
  }

  return failures;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = checkRoleModels(resolve(process.argv[2] ?? '.'));
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`All role models are ${REQUIRED_MODEL}.`);
  }
}
