import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const GROUPS = {
  'Julia Vercel': ['VERCEL_TOKEN'],
  'Julia Linear': ['LINEAR_API_KEY'],
  'Julia CommandCode': ['COMMANDCODE_API_KEY'],
  'Julia Axiom': ['AXIOM_TOKEN', 'AXIOM_DATASET'],
  'Julia Sentry': ['NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'],
};
const FIELDS = new Set(Object.values(GROUPS).flat());
const sameFields = (item, values) => Object.entries(values).every(([label, value]) => item.fields?.some(field => field.label === label && field.value === value));

// JSON item bodies and readbacks remain in memory. Only IDs/references/status
// leave this boundary; never put secret values in arguments, files or errors.
export function opExecutor(executable = 'op') {
  return async (args, input) => {
    const result = spawnSync(executable, [...args, '--format', 'json'], { encoding: 'utf8', input: input ? JSON.stringify(input) : undefined, windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw Error(`1Password ${args.slice(0, 2).join(' ')} failed; authenticate in 1Password (exit ${result.status ?? 'unavailable'})`);
    try { return JSON.parse(result.stdout); } catch { throw Error('1Password returned an invalid JSON response'); }
  };
}

export async function migrateJuliaSecrets(environment, { execute = opExecutor(), vaultName = 'Julia' } = {}) {
  const vaults = (await execute(['vault', 'list'])).filter(vault => vault.name === vaultName);
  if (vaults.length > 1) throw Error('Julia vault is ambiguous; select the account before migration');
  const vault = vaults[0] ?? await execute(['vault', 'create', vaultName, '--icon', 'vault-door', '--description', 'Canonical Julia service credentials; runner access is read-only.']);
  if (!vault.id) throw Error('1Password did not return the vault identity');
  const items = await execute(['item', 'list', '--vault', vault.id]);
  const references = {}, migrated = [], missing = [];
  for (const [title, fields] of Object.entries(GROUPS)) {
    const values = Object.fromEntries(fields.filter(field => typeof environment[field] === 'string' && environment[field].trim() && !/^op:\/\//.test(environment[field]) && !/^REPLACE_ME$/i.test(environment[field])).map(field => [field, environment[field]]));
    if (!Object.keys(values).length) { missing.push(title); continue; }
    const existing = items.filter(item => item.title === title);
    if (existing.length > 1) throw Error('existing Julia service item is ambiguous');
    let item;
    if (existing.length) {
      item = await execute(['item', 'get', existing[0].id, '--vault', vault.id, '--reveal']);
      if (!sameFields(item, values)) throw Error(`existing vault item differs: ${title}; nothing was overwritten`);
    } else {
      const created = await execute(['item', 'create', '--vault', vault.id, '-'], {
        title, category: 'API_CREDENTIAL', tags: ['Julia', 'migration'],
        fields: Object.entries(values).map(([label, value]) => ({ id: label, label, value, type: /TOKEN|KEY|SECRET|DSN/.test(label) ? 'CONCEALED' : 'STRING' })),
      });
      if (!created.id) throw Error('1Password did not return the created item identity');
      item = await execute(['item', 'get', created.id, '--vault', vault.id, '--reveal']);
      if (!sameFields(item, values)) throw Error(`vault readback did not match: ${title}; original secret copies were retained`);
    }
    migrated.push({ title, id: item.id, fields: Object.keys(values) });
    for (const field of Object.keys(values)) references[field] = `op://${vault.id}/${item.id}/${field}`;
  }
  return { vaultId: vault.id, references, migrated, missing, verified: 'vault readback only; live service proof pending' };
}

export function assertRestrictedWindowsAuthentication({ platform = process.platform, environment = process.env } = {}) {
  if (platform === 'win32' && (!environment.OP_SERVICE_ACCOUNT_TOKEN || environment.JULIA_VAULT_WINDOWS_HELPER !== 'verified')) {
    throw Error('Windows key operations require the restricted Julia Windows helper; personal 1Password desktop authentication is refused');
  }
}

function validatedVaultSnapshot(configuration, references, environment) {
  if (!configuration?.vaultId || !configuration.referencesPath) throw Error('missing Julia vault launch configuration');
  const values = parseEnv(references);
  if (!Object.keys(values).length) throw Error('empty Julia vault reference file');
  const allowed = value => typeof value === 'string' && value.startsWith(`op://${configuration.vaultId}/`) && /^op:\/\/[^/]+\/[^/]+\/[^/]+(?:\/[^/]+)?$/.test(value);
  for (const [field, value] of Object.entries(values)) {
    if (!FIELDS.has(field) || !allowed(value)) throw Error(`invalid vault reference for ${field}; only Julia secret references are allowed`);
  }
  // op run scans inherited variables too; don't let an unrelated inherited
  // reference silently expand the requested vault access.
  const launchEnvironment = Object.fromEntries(Object.entries(environment).filter(([field]) => !FIELDS.has(field.toUpperCase())));
  for (const [field, value] of Object.entries(launchEnvironment)) {
    if (typeof value === 'string' && value.startsWith('op://') && (!FIELDS.has(field) || !allowed(value))) throw Error(`foreign inherited vault reference for ${field}`);
  }
  return { values, launchEnvironment };
}

export function vaultLaunch(args, { entryPoint = 'mastra-cli', configuration, references, environment = process.env, run = spawnSync, command } = {}) {
  const { values, launchEnvironment } = validatedVaultSnapshot(configuration, references, environment);
  // Resolve this validated snapshot, not a second read of the mutable file.
  // Omitted fields stay absent instead of falling back to stale plaintext.
  let childCommand = command;
  if (!childCommand) {
    const approvedEntryPoints = {
      'mastra-cli': [process.execPath, '--experimental-strip-types', fileURLToPath(new URL('../ops/mastra-agents/reviewer/src/mastra/cli.ts', import.meta.url))],
      'linear-cli.mjs': [process.execPath, fileURLToPath(new URL('./linear-cli.mjs', import.meta.url))],
    };
    childCommand = approvedEntryPoints[entryPoint];
    if (!childCommand) throw Error('unapproved Julia launcher entry point');
  }
  if (!Array.isArray(childCommand) || !childCommand.length || childCommand.some(value => typeof value !== 'string' || !value)) throw Error('vault child command is required');
  const result = run(configuration.opExecutable ?? 'op', ['run', '--', ...childCommand, ...args], { stdio: 'inherit', env: { ...launchEnvironment, ...values }, windowsHide: true });
  if (result.error) throw Error('1Password launch failed; confirm the installed CLI and account access');
  return result.status ?? 1;
}

export function vaultCommand(executable, args, { secretNames, references, ...options } = {}) {
  if (!Array.isArray(secretNames) || !secretNames.length) throw Error('vault command secret names are required');
  const available = validatedVaultSnapshot(options.configuration, references, options.environment ?? process.env).values;
  const selected = {};
  for (const name of new Set(secretNames)) {
    if (!FIELDS.has(name)) throw Error(`vault command secret name is not allowed: ${name}`);
    if (!available[name]) throw Error(`vault command secret is not present: ${name}`);
    selected[name] = available[name];
  }
  const selectedReferences = Object.entries(selected).map(([name, value]) => `${name}=${value}`).join('\n');
  const wrapper = fileURLToPath(new URL('./julia-vault-command.mjs', import.meta.url));
  return vaultLaunch(args, { ...options, references: selectedReferences, command: [process.execPath, wrapper, executable] });
}

export function vaultProbe(options = {}) {
  const fields = Object.keys(parseEnv(options.references ?? ''));
  const code = `const keys=${JSON.stringify(fields)};if(keys.some(k=>!process.env[k]||process.env[k].startsWith('op://')))process.exit(1);console.log('Julia vault resolution verified: '+keys.length+' fields; no values displayed.')`;
  const execute = options.run ?? spawnSync;
  return vaultLaunch([], { ...options, run: (command, args, settings) => execute(command, [...args.slice(0, 3), '-e', code], settings) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [operation, ...args] = process.argv.slice(2);
    const configurationPath = process.env.JULIA_VAULT_CONFIG ?? join(homedir(), '.julia', 'vault-launch.json');
    if (operation === 'migrate') {
      const separator = args.indexOf('--from-env');
      if (separator !== 0 || args.length < 2) throw Error('use migrate --from-env followed by the existing environment file paths');
      const environment = { ...process.env };
      for (const path of args.slice(1)) Object.assign(environment, parseEnv(await readFile(path, 'utf8')));
      const report = await migrateJuliaSecrets(environment, { execute: opExecutor(process.env.JULIA_OP_EXECUTABLE ?? 'op') });
      const referencesPath = join(dirname(configurationPath), 'secrets.env');
      await mkdir(dirname(configurationPath), { recursive: true });
      // The only persisted secret file contains references. Originals are not
      // deleted until the operator's real first-card connection proof succeeds.
      await writeFile(referencesPath, Object.entries(report.references).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
      await writeFile(configurationPath, JSON.stringify({ vaultId: report.vaultId, referencesPath, opExecutable: process.env.JULIA_OP_EXECUTABLE ?? 'op' }, null, 2));
      console.log(JSON.stringify(report));
    } else if (operation === 'init' || operation === 'readIssue' || operation === 'verify' || operation === 'run') {
      assertRestrictedWindowsAuthentication();
      const configuration = JSON.parse(await readFile(configurationPath, 'utf8'));
      const references = await readFile(configuration.referencesPath, 'utf8');
      if (operation === 'verify') process.exitCode = vaultProbe({ configuration, references });
      else if (operation === 'run') {
        if (args[0] !== '--secrets' || !args[1] || args[2] !== '--' || !args[3]) throw Error('use run --secrets NAME[,NAME] -- followed by an executable and arguments');
        process.exitCode = vaultCommand(args[3], args.slice(4), { configuration, references, secretNames: args[1].split(',') });
      } else {
        const entryPoint = operation === 'readIssue' ? 'linear-cli.mjs' : 'mastra-cli';
        const launchArgs = operation === 'readIssue' ? ['get-issue', ...args] : args;
        process.exitCode = vaultLaunch(launchArgs, { entryPoint, configuration, references });
      }
    } else throw Error('expected migrate, init, readIssue, verify, or run');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
