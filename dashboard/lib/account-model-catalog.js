import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function listAccountModels(createController, cwd) {
  const directory = mkdtempSync(join(tmpdir(), 'julia-model-catalog-'));
  let storage;
  try {
    const created = await createController({
      cwd,
      disableMcp: true,
      disableHooks: true,
      disablePlugins: true,
      disableGithubSignals: true,
      createInitialThread: false,
      storage: { type: 'libsql', url: `file:${join(directory, 'catalog.db')}` },
    });
    storage = created.storage;
    const models = await created.controller.listAvailableModels();
    return models.filter(model => model.hasApiKey === true).map(model => ({
      id: model.id,
      provider: model.provider,
      modelName: model.modelName ?? model.id.split('/').at(-1),
    }));
  } finally {
    try { await storage?.close?.(); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  }
}
