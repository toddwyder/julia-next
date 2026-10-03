#!/usr/bin/env node

/**
 * pick-builder: Sets Factory project builder model and selects the reviewer helper.
 *
 * Rule: The reviewer helper is always from a different company than the builder.
 * The reviewer list is ranked; the command picks the first reviewer on the list
 * from a different company than the builder, and sets:
 *   1. Factory project model (factory_projects.default_model_id)
 *   2. Mastra reviewer helper (models.subagentModels.default in settings.json)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Extracts the company/maker name from a model identifier.
 * Examples:
 *   'openai/gpt-5-codex' -> 'openai'
 *   'command-code/deepseek/deepseek-v4-flash' -> 'deepseek'
 *   'acme/builder-1' -> 'acme'
 *   'gateway-x/brand-b/model-beta' -> 'brand-b'
 */
export function getMaker(modelId) {
  if (!modelId || typeof modelId !== 'string') return '';
  const parts = modelId.trim().split('/');
  if (parts.length >= 3) {
    return parts[1].toLowerCase();
  }
  return parts[0].toLowerCase();
}

/**
 * Chooses the first reviewer from the ranked reviewer list from a different company than the builder.
 * Refuses if no such reviewer exists.
 */
export function selectReviewer(builderModel, reviewerList) {
  if (!builderModel || typeof builderModel !== 'string') {
    throw new Error('A builder model is required');
  }
  if (!Array.isArray(reviewerList) || reviewerList.length === 0) {
    throw new Error('No reviewer found from a different company than builder');
  }

  const builderMaker = getMaker(builderModel);

  for (const reviewer of reviewerList) {
    if (typeof reviewer === 'string' && reviewer.trim()) {
      const reviewerMaker = getMaker(reviewer);
      if (reviewerMaker && reviewerMaker !== builderMaker) {
        return reviewer.trim();
      }
    }
  }

  throw new Error(
    `No reviewer found from a different company than builder (${builderMaker})`
  );
}

/**
 * Loads the server-side reviewer list from environment variable or configuration file.
 */
export function loadReviewerList(options = {}) {
  if (Array.isArray(options.reviewerList)) {
    return options.reviewerList;
  }

  const envList = options.envList ?? process.env.FACTORY_REVIEWER_LIST ?? process.env.REVIEWER_LIST;
  if (envList) {
    try {
      const parsed = JSON.parse(envList);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return envList.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }

  const candidatePaths = [
    options.reviewerListPath,
    process.env.REVIEWER_LIST_PATH,
    '/var/lib/julia-factory/reviewer-list.json',
    '/etc/julia-factory/reviewer-list.json',
  ].filter(Boolean);

  for (const filePath of candidatePaths) {
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) return parsed;
      } catch (err) {
        throw new Error(`Failed to parse reviewer list at ${filePath}: ${err.message}`);
      }
    }
  }

  throw new Error(
    'No reviewer list configured. Set FACTORY_REVIEWER_LIST or configure /var/lib/julia-factory/reviewer-list.json'
  );
}

/**
 * Updates models.subagentModels.default in Mastra's settings.json file.
 */
export function updateMastraSettingsFile(settingsPath, reviewerModel) {
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

  settings.models.subagentModels.default = reviewerModel;

  writeFileSync(resolvedPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

/**
 * Updates the Factory project default model in the PostgreSQL database.
 */
export async function updateFactoryProjectModel(builderModel, options = {}) {
  const dbUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL is not configured for updating Factory project model');
  }

  // Use dynamic import and createRequire fallback so dependencies resolve across test and server environments
  let pg;
  try {
    pg = await import('pg');
  } catch {
    const { createRequire } = await import('node:module');
    const searchPaths = [
      process.cwd(),
      '/var/lib/julia-factory/app/package.json',
    ];
    for (const p of searchPaths) {
      try {
        const req = createRequire(p);
        pg = req('pg');
        if (pg) break;
      } catch {
        // continue
      }
    }
  }

  if (!pg) {
    throw new Error("Package 'pg' is required to update Factory project model");
  }

  const { Client } = pg.default ?? pg;
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const projectId = options.projectId ?? process.env.FACTORY_PROJECT_ID;
    if (projectId) {
      await client.query(
        'UPDATE factory_projects SET default_model_id = $1, updated_at = NOW() WHERE id = $2',
        [builderModel, projectId]
      );
    } else {
      await client.query(
        'UPDATE factory_projects SET default_model_id = $1, updated_at = NOW()',
        [builderModel]
      );
    }
  } finally {
    await client.end();
  }
}

/**
 * Orchestrates picking a builder model and configuring Factory and Mastra.
 */
export async function pickBuilder(builderModel, options = {}) {
  if (!builderModel || typeof builderModel !== 'string' || !builderModel.trim()) {
    throw new Error('A builder model is required');
  }

  const normalizedBuilder = builderModel.trim();
  const reviewerList = loadReviewerList(options);
  const selectedReviewer = selectReviewer(normalizedBuilder, reviewerList);

  if (options.projectUpdater) {
    await options.projectUpdater(normalizedBuilder);
  } else {
    await updateFactoryProjectModel(normalizedBuilder, options);
  }

  if (options.settingsUpdater) {
    await options.settingsUpdater(selectedReviewer);
  } else {
    updateMastraSettingsFile(options.settingsPath, selectedReviewer);
  }

  return {
    builder: normalizedBuilder,
    reviewer: selectedReviewer,
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
    .then(({ builder, reviewer }) => {
      console.log(`Builder: ${builder}`);
      console.log(`Reviewer: ${reviewer}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
}
