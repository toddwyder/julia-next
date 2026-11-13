import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { listAccountModels } from '../lib/account-model-catalog.js';

import { accountProviders, mergeSweep, stateDir } from '../lib/models.js';
import { loadCatalog, priceFor as findPrice, readCorrections } from '../lib/model-prices.js';

const here = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = dirname(here);

export function readConfig(name) {
  return JSON.parse(readFileSync(join(dashboardRoot, 'config', name), 'utf8'));
}

// `mastracode` on PATH is the launcher, a plain script in this repo, so the program is not
// beside it. MASTRACODE_PROGRAM names the program directory, and this server's installer puts
// it at ~/.local/lib/mastracode-program.
export function findSdkPath(env = process.env) {
  if (env.MASTRACODE_SDK_PATH) return env.MASTRACODE_SDK_PATH;
  const relative = join('node_modules', '@mastra', 'code-sdk', 'dist', 'index.js');
  const programs = [env.MASTRACODE_PROGRAM, env.MASTRACODE_PROGRAM_DIR, join(homedir(), '.local', 'lib', 'mastracode-program')].filter(Boolean);
  for (const program of programs) {
    const candidate = join(program, relative);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`The Mastra Code SDK was not found in ${programs.join(' or ')}. Set MASTRACODE_PROGRAM to the directory that holds its node_modules.`);
}

export async function availableModels(env = process.env) {
  const sdkPath = findSdkPath(env);
  const { createMastraCodeAgentController } = await import(sdkPath);
  return listAccountModels(createMastraCodeAgentController, dashboardRoot);
}

function writeAtomically(path, contents) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, contents);
  renameSync(temporary, path);
}

export function appendLog(directory, entry) {
  mkdirSync(directory, { recursive: true });
  appendFileSync(join(directory, 'sweep-log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

// The sweep keeps only the check of which models each account offers. Prices come from
// Mastra's models.dev list plus the corrections file, the same list the spending total uses.
export async function sweep({
  env = process.env,
  directory = stateDir(env),
  now = new Date(),
  listModels = availableModels,
  catalog = loadCatalog({ env }),
  corrections = readCorrections({ env }),
} = {}) {
  const accounts = readConfig('accounts.json').accounts;
  const defaults = readConfig('defaults.json');

  const all = await listModels(env);
  const perAccount = accounts.map(account => {
    const providers = accountProviders(account);
    return {
      id: account.id,
      name: account.name,
      providers,
      models: all.filter(model => providers.includes(model.provider)),
    };
  });
  if (perAccount.every(account => account.models.length === 0)) {
    throw new Error('No account reported any model. The sweep wrote nothing.');
  }

  const available = perAccount.flatMap(account => account.models);
  const previous = (() => {
    try {
      return JSON.parse(readFileSync(join(directory, 'models.json'), 'utf8')).models ?? [];
    } catch {
      return [];
    }
  })();

  const merged = mergeSweep({
    previousModels: previous,
    available,
    priceFor: model => findPrice({ catalog, corrections, provider: model.provider, model: model.modelName }),
    readAt: now.toISOString(),
    defaultIds: { mainSession: defaults.mainSession, shipping: defaults.shipping },
  });

  const saved = {
    sweptAt: now.toISOString(),
    accounts: perAccount.map(account => ({
      id: account.id,
      name: account.name,
      providers: account.providers,
      modelCount: account.models.length,
    })),
    models: merged.models,
    // The effort is a word, not a model id, so it is copied rather than resolved.
    defaults: { ...merged.defaults, effort: defaults.effort ?? 'large' },
  };

  mkdirSync(directory, { recursive: true });
  writeAtomically(join(directory, 'models.json'), `${JSON.stringify(saved, null, 2)}\n`);

  for (const model of merged.models) {
    appendLog(directory, {
      event: merged.added.includes(model.id) ? 'added' : 'kept',
      model: model.id,
      price: model.free ? 'free' : `${model.inputPerMillion}/${model.outputPerMillion}`,
      source: model.priceSource,
    });
  }
  for (const model of merged.retired) appendLog(directory, { event: 'retired', model });
  for (const model of merged.excluded) appendLog(directory, { event: 'excluded', model: model.id, reason: model.reason });
  appendLog(directory, {
    event: 'sweep',
    models: merged.models.length,
    added: merged.added.length,
    retired: merged.retired.length,
    excluded: merged.excluded.length,
    accounts: saved.accounts,
  });

  return saved;
}

const isCli = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isCli) {
  try {
    const saved = await sweep();
    console.log(`Swept ${saved.models.length} models at ${saved.sweptAt}.`);
    process.exit(0);
  } catch (error) {
    console.error(`Sweep failed, previous models.json kept. ${error.message}`);
    process.exit(1);
  }
}
