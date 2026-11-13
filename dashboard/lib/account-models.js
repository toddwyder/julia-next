import { buildOpenAICodexOAuthFetch } from '@mastra/code-sdk/providers/openai-codex';
import { createMastraCodeAgentController } from '@mastra/code-sdk';
import { listAccountModels } from './account-model-catalog.js';
import { readModels } from './models.js';

export async function chatgptModels() {
  const response = await buildOpenAICodexOAuthFetch({ rewriteUrl: false })(
    'https://chatgpt.com/backend-api/codex/models?client_version=0.163.0',
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok) throw new Error(`ChatGPT model list returned HTTP ${response.status}. Sign in to ChatGPT in Mastra Code and try again.`);
  const body = await response.json();
  if (!Array.isArray(body.models)) throw new Error('ChatGPT returned an unreadable model list.');
  return body.models.filter(model => model.visibility === 'list' && model.supported_in_api === true)
    .map(model => ({ id: `openai/${model.slug}`, provider: 'openai', modelName: model.display_name ?? model.slug }));
}

// The controller's registry can lag the account: Kimi K3.1 Pro answers on the CommandCode
// gateway but is absent from listAvailableModels until the registry refreshes. The saved
// sweep is the same account's catalogue, so its CommandCode rows fill that gap.
function savedCommandCodeModels() {
  return readModels().models
    .filter(model => /^(?:mastracode\/)?commandcode\//.test(String(model.id)))
    .map(model => ({
      id: String(model.id).replace(/^mastracode\//, ''),
      provider: 'commandcode',
      modelName: model.name,
    }));
}

export async function accountModels() {
  const [available, chatgpt] = await Promise.all([listAccountModels(createMastraCodeAgentController, process.cwd()), chatgptModels()]);
  const models = [...available.filter(model => model.provider === 'anthropic' || model.provider === 'commandcode'), ...chatgpt];
  const seen = new Set(models.map(model => model.id));
  for (const model of savedCommandCodeModels()) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models;
}
