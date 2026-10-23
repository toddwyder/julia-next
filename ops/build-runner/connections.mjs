import { readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { AuthStorage } from '@mastra/code-sdk/auth/storage';

const stockProviders = {
  openai: { authId: 'openai-codex', route: 'openai-codex', company: 'OpenAI', service: 'ChatGPT plan', wire: 'responses' },
  anthropic: { authId: 'anthropic', route: 'claude', company: 'Anthropic', service: 'Claude subscription', wire: 'messages' },
};
const stockEfforts = ['low', 'medium', 'high'];
const priceFields = ['input', 'output', 'cacheRead', 'cacheWrite'];
const defaultSettingsPath = fileURLToPath(new URL('./machine-settings.json', import.meta.url));

function configuredStockOffer(modelId, spec) {
  const provider = stockProviders[modelId.slice(0, modelId.indexOf('/'))];
  if (!provider || typeof spec !== 'object' || spec === null || spec.unavailable) return undefined;
  if (typeof spec.endpoint !== 'string' || !spec.endpoint || spec.protocol !== provider.wire) return undefined;
  if (typeof spec.wireModel !== 'string' || !spec.wireModel.trim()) return undefined;
  if (!Number.isSafeInteger(spec.maxInputTokens) || spec.maxInputTokens <= 0) return undefined;
  if (!Number.isSafeInteger(spec.maxOutputTokens) || spec.maxOutputTokens <= 0) return undefined;
  if (typeof spec.price !== 'object' || spec.price === null || !priceFields.every(field => Number.isFinite(spec.price[field]) && spec.price[field] >= 0)) return undefined;
  return {
    route: provider.route,
    modelId: spec.wireModel,
    name: typeof spec.name === 'string' && spec.name.trim() ? spec.name : spec.wireModel,
    company: provider.company,
    service: provider.service,
    codingCapable: true,
    supportedEfforts: [...stockEfforts],
    wire: provider.wire,
  };
}

export async function stockSubscriptionOffers(settingsPath = defaultSettingsPath) {
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  if (typeof settings.authPath !== 'string' || !settings.authPath) return [];
  const auth = new AuthStorage(resolve(settings.authPath));
  auth.allowEnvironmentFallback = false;
  const signedIn = new Set(Object.values(stockProviders).map(provider => provider.authId).filter(id => auth.isLoggedIn(id)));
  if (!signedIn.size || typeof settings.models !== 'object' || settings.models === null) return [];
  return Object.entries(settings.models).flatMap(([modelId, spec]) => {
    const offer = configuredStockOffer(modelId, spec);
    return offer && signedIn.has(stockProviders[modelId.slice(0, modelId.indexOf('/'))].authId) ? [offer] : [];
  });
}

export async function connectionCommand([command, settingsPath, provider]) {
  if (!['status', 'login'].includes(command) || !settingsPath) throw Error('Usage: connections.mjs <status|login> <settings.json> [openai-codex|anthropic]');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  if (!settings.authPath) throw Error('Shared stock authPath is required in settings');
  await mkdir(dirname(resolve(settings.authPath)), { recursive: true, mode: 0o700 });
  const auth = new AuthStorage(resolve(settings.authPath));
  auth.allowEnvironmentFallback = false;
  if (command === 'login') {
    if (!['openai-codex', 'anthropic'].includes(provider)) throw Error('Stock subscription provider required');
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
      await auth.login(provider, {
        authMode: provider === 'openai-codex' ? 'device' : undefined,
        onAuth: info => console.log(JSON.stringify({ provider, ...info })),
        onPrompt: prompt => terminal.question(`${prompt.message}\n`),
      });
      console.log(JSON.stringify({ provider, signedIn: auth.isLoggedIn(provider), saved: true }));
    } finally { terminal.close(); }
  } else {
    console.log(JSON.stringify(Object.fromEntries(['openai-codex', 'anthropic'].map(id => [id, { signedIn: auth.isLoggedIn(id) }]))));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  connectionCommand(process.argv.slice(2)).catch(() => {
    console.error('Stock connection operation failed; no alternative connection attempted.');
    process.exitCode = 1;
  });
}
