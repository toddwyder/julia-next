import { buildOpenAICodexOAuthFetch } from '@mastra/code-sdk/providers/openai-codex';
import { createMastraCodeAgentController } from '@mastra/code-sdk';
import { listAccountModels } from './account-model-catalog.js';

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

export async function accountModels() {
  const [available, chatgpt] = await Promise.all([listAccountModels(createMastraCodeAgentController, process.cwd()), chatgptModels()]);
  return [...available.filter(model => model.provider === 'anthropic' || model.provider === 'commandcode'), ...chatgpt];
}
