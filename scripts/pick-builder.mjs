#!/usr/bin/env node

/**
 * pick-builder: Sets Factory project builder model and pairs the reviewer helper.
 *
 * Rule: The reviewer helper is always from a different company than the builder.
 * Company is declared in server-side settings ({ model, company }), never guessed.
 * The reviewer list is ranked; the command picks the first reviewer on the list
 * from a different company than the builder, and sets:
 *   1. Factory project model (FactoryProjectsStorage.update for one named project)
 *   2. Mastra reviewer helper (models.subagentModels.<helperType> in settings.json, never default)
 *
 * If the second change fails, the first change is rolled back.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Chooses the first reviewer from the ranked reviewer list from a different declared company than the builder.
 * Refuses if no declared company exists on builder or reviewer, or if no eligible reviewer exists.
 */
export function selectReviewer(builder, reviewerList) {
  if (!builder || typeof builder !== 'object') {
    throw new Error('A builder model object with declared company is required');
  }

  const builderModel = typeof builder.model === 'string' ? builder.model.trim() : '';
  const builderCompany = typeof builder.company === 'string' ? builder.company.trim().toLowerCase() : '';

  if (!builderModel || !builderCompany) {
    throw new Error(`Builder model "${builderModel || 'unknown'}" has no declared company`);
  }

  if (!Array.isArray(reviewerList) || reviewerList.length === 0) {
    throw new Error(`No eligible reviewer found from a different company than "${builder.company}"`);
  }

  for (const item of reviewerList) {
    if (!item || typeof item !== 'object') {
      throw new Error('Reviewer item must be an object with declared model and company');
    }
    const reviewerModel = typeof item.model === 'string' ? item.model.trim() : '';
    const reviewerCompany = typeof item.company === 'string' ? item.company.trim().toLowerCase() : '';

    if (!reviewerModel || !reviewerCompany) {
      throw new Error(`Reviewer model "${reviewerModel || 'unknown'}" has no declared company`);
    }

    if (reviewerCompany !== builderCompany) {
      return reviewerModel;
    }
  }

  throw new Error(`No eligible reviewer found from a different company than "${builder.company}"`);
}

/**
 * Resolves builder model and its declared company from catalog or options.
 */
export function resolveBuilder(builderInput, options = {}) {
  if (builderInput && typeof builderInput === 'object') {
    const model = typeof builderInput.model === 'string' ? builderInput.model.trim() : '';
    const company = typeof builderInput.company === 'string' ? builderInput.company.trim() : '';
    if (!model || !company) {
      throw new Error(`Builder model "${model || 'unknown'}" has no declared company`);
    }
    return { model, company };
  }

  const modelId = typeof builderInput === 'string' ? builderInput.trim() : '';
  if (!modelId) {
    throw new Error('A builder model ID is required');
  }

  const catalog = options.builderCatalog ?? loadServerConfig(options).builders ?? [];
  for (const item of catalog) {
    if (item && typeof item === 'object' && item.model === modelId) {
      const company = typeof item.company === 'string' ? item.company.trim() : '';
      if (!company) {
        throw new Error(`Builder model "${modelId}" has no declared company`);
      }
      return { model: modelId, company };
    }
  }

  throw new Error(`Builder model "${modelId}" has no declared company`);
}

/**
 * Loads the server-side model configuration.
 */
export function loadServerConfig(options = {}) {
  if (options.serverConfig && typeof options.serverConfig === 'object') {
    return options.serverConfig;
  }

  const envConfig = options.envConfig ?? process.env.FACTORY_MODEL_JOBS_CONFIG;
  if (envConfig) {
    try {
      const parsed = JSON.parse(envConfig);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (err) {
      throw new Error(`Failed to parse FACTORY_MODEL_JOBS_CONFIG: ${err.message}`);
    }
  }

  const candidatePaths = [
    options.configPath,
    process.env.FACTORY_MODEL_JOBS_PATH,
    '/var/lib/julia-factory/reviewer-settings.json',
    '/var/lib/julia-factory/reviewer-list.json',
    '/etc/julia-factory/reviewer-settings.json',
    '/etc/julia-factory/reviewer-list.json',
  ].filter(Boolean);

  for (const filePath of candidatePaths) {
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          return { reviewers: parsed };
        }
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      } catch (err) {
        throw new Error(`Failed to parse configuration at ${filePath}: ${err.message}`);
      }
    }
  }

  return {};
}

/**
 * Loads the ranked reviewer list from options or server settings.
 */
export function loadReviewers(options = {}) {
  if (Array.isArray(options.reviewerList)) {
    return options.reviewerList;
  }
  const config = loadServerConfig(options);
  if (Array.isArray(config.reviewers)) {
    return config.reviewers;
  }
  if (Array.isArray(config)) {
    return config;
  }
  throw new Error('No reviewer list configured in server settings');
}

/**
 * Loads the reviewing helper type from options or server settings.
 */
export function loadHelperType(options = {}) {
  const type = options.helperType ?? process.env.REVIEWER_HELPER_TYPE ?? loadServerConfig(options).helperType;
  if (!type || typeof type !== 'string' || !type.trim() || type.trim().toLowerCase() === 'default') {
    throw new Error(`Invalid reviewing helper type "${type}". Must be a specific named helper type, never "default".`);
  }
  return type.trim();
}

/**
 * Updates models.subagentModels.<helperType> in Mastra's settings.json file.
 * Never sets "default". Returns previous value.
 */
export function updateMastraSettingsFile(settingsPath, helperType, reviewerModel) {
  if (!helperType || typeof helperType !== 'string' || !helperType.trim() || helperType.trim().toLowerCase() === 'default') {
    throw new Error(`Invalid reviewing helper type "${helperType}". Must be a specific named helper type, never "default".`);
  }

  const normalizedHelper = helperType.trim();
  const resolvedPath =
    settingsPath ??
    process.env.MASTRA_SETTINGS_PATH ??
    join(homedir(), '.local', 'share', 'mastracode', 'settings.json');

  if (!existsSync(resolvedPath)) {
    throw new Error(`Mastra settings file not found at ${resolvedPath}`);
  }

  const content = readFileSync(resolvedPath, 'utf8');
  const settings = JSON.parse(content);

  if (!settings.models || typeof settings.models !== 'object') {
    settings.models = {};
  }
  if (!settings.models.subagentModels || typeof settings.models.subagentModels !== 'object') {
    settings.models.subagentModels = {};
  }

  const previousValue = settings.models.subagentModels[normalizedHelper];
  settings.models.subagentModels[normalizedHelper] = reviewerModel;

  writeFileSync(resolvedPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return previousValue;
}

/**
 * Updates the Factory project default model for ONE named project using FactoryProjectsStorage.
 * Returns previous defaultModelId.
 */
export async function updateFactoryProjectModel(builderModel, options = {}) {
  const projectId = options.projectId ?? process.env.FACTORY_PROJECT_ID;
  if (!projectId || typeof projectId !== 'string' || !projectId.trim()) {
    throw new Error('Missing required Factory project ID');
  }

  const orgId = options.orgId ?? process.env.FACTORY_ORG_ID ?? 'org_01M3HB0E70TW09VGBX3NZZKPKZ';
  const normalizedProject = projectId.trim();

  let projectsStorage = options.projectsStorage;
  let ownsStorage = false;
  let mastraStorage;

  if (!projectsStorage) {
    const dbUrl = options.databaseUrl ?? process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL is not configured for updating Factory project model');
    }

    const { createRequire } = await import('node:module');
    let PgFactoryStorage;
    let FactoryProjectsStorage;

    try {
      const pgModule = await import('@mastra/pg');
      PgFactoryStorage = pgModule.PgFactoryStorage;
      const projectsModule = await import('@mastra/factory/storage/domains/projects/base');
      FactoryProjectsStorage = projectsModule.FactoryProjectsStorage;
    } catch {
      const searchPaths = [
        process.cwd(),
        '/var/lib/julia-factory/app/package.json',
      ];
      for (const p of searchPaths) {
        try {
          const req = createRequire(p);
          PgFactoryStorage = req('@mastra/pg').PgFactoryStorage;
          FactoryProjectsStorage = req('@mastra/factory/storage/domains/projects/base').FactoryProjectsStorage;
          if (PgFactoryStorage && FactoryProjectsStorage) break;
        } catch {}
      }
    }

    if (!PgFactoryStorage || !FactoryProjectsStorage) {
      throw new Error("Required Factory storage modules '@mastra/pg' and '@mastra/factory' are not available");
    }

    mastraStorage = new PgFactoryStorage({ connectionString: dbUrl });
    await mastraStorage.init();
    projectsStorage = mastraStorage.registerDomain(new FactoryProjectsStorage());
    await projectsStorage.ensureReady();
    ownsStorage = true;
  }

  try {
    const existing = await projectsStorage.get({ orgId, id: normalizedProject });
    if (!existing) {
      throw new Error(`Factory project not found: ${normalizedProject}`);
    }

    const previousModel = existing.defaultModelId;
    const updated = await projectsStorage.update({
      orgId,
      id: normalizedProject,
      input: { defaultModelId: builderModel },
    });

    if (!updated || updated.defaultModelId !== builderModel) {
      throw new Error(`Failed to update Factory project ${normalizedProject}`);
    }

    return previousModel;
  } finally {
    if (ownsStorage && mastraStorage?.close) {
      await mastraStorage.close();
    }
  }
}

/**
 * Orchestrates picking a builder model, pairing the reviewer helper, and validating readback.
 * Rolls back the project model if setting the reviewing helper fails.
 */
export async function pickBuilder(builderInput, options = {}) {
  const builder = resolveBuilder(builderInput, options);
  const reviewers = loadReviewers(options);
  const selectedReviewer = selectReviewer(builder, reviewers);
  const helperType = loadHelperType(options);

  const projectId = options.projectId ?? process.env.FACTORY_PROJECT_ID;
  if (!projectId || typeof projectId !== 'string' || !projectId.trim()) {
    throw new Error('Missing required Factory project ID');
  }

  const orgId = options.orgId ?? process.env.FACTORY_ORG_ID ?? 'org_01M3HB0E70TW09VGBX3NZZKPKZ';
  const normalizedProject = projectId.trim();

  // 1. Update project builder model
  let previousProjectModel;
  try {
    if (options.projectUpdater) {
      previousProjectModel = await options.projectUpdater(builder.model);
    } else {
      previousProjectModel = await updateFactoryProjectModel(builder.model, {
        ...options,
        projectId: normalizedProject,
        orgId,
      });
    }
  } catch (err) {
    throw new Error(`Failed setting: factory_project, Project: ${normalizedProject}. Cause: ${err.message}`);
  }

  // 2. Update reviewing helper in Mastra settings
  try {
    if (options.settingsUpdater) {
      await options.settingsUpdater(helperType, selectedReviewer);
    } else {
      updateMastraSettingsFile(options.settingsPath, helperType, selectedReviewer);
    }
  } catch (err) {
    // Rollback project model update
    try {
      if (options.projectUpdater) {
        await options.projectUpdater(previousProjectModel);
      } else {
        await updateFactoryProjectModel(previousProjectModel, {
          ...options,
          projectId: normalizedProject,
          orgId,
        });
      }
    } catch (rollbackErr) {
      throw new Error(
        `Failed setting: mastra_settings:models.subagentModels.${helperType}, Project: ${normalizedProject}. ` +
        `Rollback of project model also failed: ${rollbackErr.message}. Cause: ${err.message}`
      );
    }

    throw new Error(
      `Failed setting: mastra_settings:models.subagentModels.${helperType}, Project: ${normalizedProject}. ` +
      `Project model rolled back to ${previousProjectModel}. Cause: ${err.message}`
    );
  }

  // 3. Readback verification
  if (options.settingsReader) {
    const readbackHelper = options.settingsReader(helperType);
    if (readbackHelper !== selectedReviewer) {
      throw new Error(
        `Readback verification failed: setting mastra_settings:models.subagentModels.${helperType} ` +
        `expected "${selectedReviewer}" but read "${readbackHelper}"`
      );
    }
  }

  return {
    builder: builder.model,
    reviewer: selectedReviewer,
    helperType,
    projectId: normalizedProject,
  };
}

// CLI entry point
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const builderArg = process.argv[2];
  if (!builderArg) {
    console.error('Usage: node scripts/pick-builder.mjs <builder-model>');
    process.exit(1);
  }

  pickBuilder(builderArg)
    .then(({ builder, reviewer, helperType, projectId }) => {
      console.log(`Builder: ${builder}`);
      console.log(`Reviewer (${helperType}): ${reviewer}`);
      console.log(`Project: ${projectId}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
}
