import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { mergeSweep, parsePrices, stateDir } from '../lib/models.js';

const here = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = dirname(here);

export function readConfig(name) {
  return JSON.parse(readFileSync(join(dashboardRoot, 'config', name), 'utf8'));
}

export function findSdkPath(env = process.env) {
  if (env.MASTRACODE_SDK_PATH) return env.MASTRACODE_SDK_PATH;
  const relative = join('node_modules', '@mastra', 'code-sdk', 'dist', 'index.js');
  if (env.MASTRACODE_PROGRAM) {
    const candidate = join(env.MASTRACODE_PROGRAM, relative);
    if (existsSync(candidate)) return candidate;
    throw new Error(`The Mastra Code SDK was not found at ${candidate}. Check MASTRACODE_PROGRAM.`);
  }
  let bin;
  try {
    bin = execFileSync('which', ['mastracode'], { encoding: 'utf8' }).trim();
  } catch {
    bin = '';
  }
  if (!bin) {
    throw new Error('The Mastra Code program was not found. Set MASTRACODE_PROGRAM or put mastracode on PATH.');
  }
  let directory = dirname(realpathSync(bin));
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, relative);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error('The Mastra Code SDK was not found next to the mastracode program.');
}

export async function availableModels(env = process.env) {
  const sdkPath = findSdkPath(env);
  const { createMastraCodeAgentController } = await import(sdkPath);
  const storageDir = join(tmpdir(), `julia-dashboard-sweep-${process.pid}`);
  mkdirSync(storageDir, { recursive: true });
  const { controller, storage } = await createMastraCodeAgentController({
    cwd: dashboardRoot,
    disableMcp: true,
    disableHooks: true,
    disablePlugins: true,
    disableGithubSignals: true,
    createInitialThread: false,
    storage: { type: 'libsql', url: `file:${join(storageDir, 'sweep.db')}` },
  });
  try {
    const list = await controller.listAvailableModels();
    return list
      .filter(model => model.hasApiKey === true)
      .map(model => ({
        id: model.id,
        provider: model.provider,
        modelName: model.modelName ?? model.id.split('/').at(-1),
      }));
  } finally {
    await storage?.close?.();
  }
}

export async function fetchPrices(source, { fetchImpl = fetch, now = new Date() } = {}) {
  const response = await fetchImpl(source.url, {
    headers: { 'user-agent': 'julia-dashboard-sweep' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`${source.label} price page answered ${response.status}.`);
  }
  const body = await response.text();
  const rows = parsePrices(source.parser, body, source.label).map(row => ({
    ...row,
    source: source.url,
    readAt: now.toISOString(),
  }));
  return rows;
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

export async function sweep({ env = process.env, directory = stateDir(env), fetchImpl = fetch, now = new Date() } = {}) {
  const accounts = readConfig('accounts.json').accounts;
  const sources = readConfig('price-sources.json');
  const defaults = readConfig('defaults.json');

  const all = await availableModels(env);
  const wanted = new Set(accounts.map(account => account.provider));
  const perAccount = accounts.map(account => {
    const models = all.filter(model => model.provider === account.provider);
    return { id: account.id, name: account.name, provider: account.provider, models };
  });
  if (perAccount.every(account => account.models.length === 0)) {
    throw new Error('No account reported any model. The sweep wrote nothing.');
  }

  const prices = {};
  for (const [provider, source] of Object.entries(sources)) {
    if (!wanted.has(provider)) continue;
    prices[provider] = await fetchPrices(source, { fetchImpl, now });
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
    pricesByProvider: prices,
    readAt: now.toISOString(),
    defaultIds: { mainSession: defaults.mainSession, shipping: defaults.shipping },
  });

  const saved = {
    sweptAt: now.toISOString(),
    accounts: perAccount.map(account => ({
      id: account.id,
      name: account.name,
      provider: account.provider,
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
