import { readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { AuthStorage } from '@mastra/code-sdk/auth/storage';
import { defaultSettingsPath, discoverCatalogueOffers } from './catalogue.mjs';

export async function stockSubscriptionOffers(settingsPath = defaultSettingsPath, options = {}) {
  const offers = await discoverCatalogueOffers({ ...options, settingsPath });
  return offers.filter(offer => offer.route === 'claude' || offer.route === 'openai-codex');
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
