const model = (company, route) => ({ company, route, wireModel: 'fake', price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })

export async function loadCatalogue() {
  return {
    connected: { anthropic: true, 'openai-codex': process.env.FAKE_OPENAI_SIGNED_OUT !== '1', commandcode: true },
    models: {
      'anthropic/claude-haiku-5-5': model('Anthropic', 'claude'),
      'commandcode/deepseek/deepseek-v4.1-flash': model('DeepSeek', 'commandcode'),
      'openai/gpt-6-sol': model('OpenAI', 'openai-codex'),
    },
  }
}

export function hydrateSettings(settings, catalogue) {
  return { ...settings, models: { ...catalogue.models } }
}
