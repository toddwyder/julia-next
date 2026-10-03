import { FactoryProjectsStorage } from '@mastra/factory/storage/domains/projects/base';
import type { FactoryStorage } from '@mastra/core/storage';
import { builderModel } from './reviewer/model-choice';

/**
 * Synchronize the centralized builder model setting to Factory projects.
 * Best-effort on startup: ensures all existing projects in storage use the
 * configured `JULIA_BUILDER_MODEL` without manual SQL or code rebuilds.
 */
export async function syncFactoryProjectModel(
  storage: FactoryStorage,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const model = builderModel(env);
  let projectsDomain: FactoryProjectsStorage;

  if (storage.hasDomain('projects')) {
    projectsDomain = storage.getDomain<FactoryProjectsStorage>('projects');
  } else {
    projectsDomain = storage.registerDomain(new FactoryProjectsStorage());
  }

  await projectsDomain.ensureReady();
  const projects = await projectsDomain.listAll();
  let updatedCount = 0;

  for (const project of projects) {
    if (project.defaultModelId !== model) {
      await projectsDomain.update({
        orgId: project.orgId,
        id: project.id,
        input: { defaultModelId: model },
      });
      updatedCount++;
    }
  }

  return updatedCount;
}
