const model = (id, company, route) => ({ modelId: id, company, route, wireModel: id, price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })

export async function loadCatalogue() {
  return {
    connected: { anthropic: true, 'openai-codex': process.env.FAKE_OPENAI_SIGNED_OUT !== '1', commandcode: true },
    models: {
      'anthropic/claude-haiku-5-5': model('claude-haiku-5-5', 'Anthropic', 'claude'),
      'commandcode/deepseek/deepseek-v4.1-flash': model('deepseek/deepseek-v4.1-flash', 'DeepSeek', 'commandcode'),
      'openai/gpt-6-sol': model('gpt-6-sol', 'OpenAI', 'openai-codex'),
    },
  }
}

export function hydrateSettings(settings, catalogue) {
  return { ...settings, models: { ...catalogue.models } }
}
