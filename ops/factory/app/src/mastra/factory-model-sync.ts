import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { FactoryStorage } from '@mastra/core/storage';
import type { CustomProvidersStorage } from '@mastra/factory/storage/domains/custom-providers/base';
import type { FactoryProjectsStorage } from '@mastra/factory/storage/domains/projects/base';
import { invalidateCustomProvidersSnapshots } from '@mastra/factory/routes/custom-provider-source';
import {
  COMMAND_CODE_DEFAULT_URL,
  COMMAND_CODE_PROVIDER_ID,
  COMMAND_CODE_PROVIDER_NAME,
  commandCodeProviderModels,
  isCommandCodeRoute,
  redactSecrets,
  validateModelSettings,
} from './reviewer/model-choice';

/**
 * Startup synchronisation of the model settings into Factory's own stores.
 *
 * Scope (assumption recorded on PR #206's repair):
 *  - Custom providers: the Command Code provider is registered, through
 *    Factory's `custom-providers` store, for every organisation that owns a
 *    project. An organisation created after startup gets it on the next restart.
 *  - Project model: set only where the project has no model of its own, or
 *    holds a value this sync wrote earlier (remembered in the ledger), or the
 *    bare id the earlier release wrote (which resolved to the direct key). Any
 *    other value is a project's explicit choice and is kept.
 */

export interface SyncLedger {
  read(): Promise<string | null>;
  write(builder: string): Promise<void>;
}

export interface SyncResult {
  projectsUpdated: number;
  projectsKept: number;
  providersWritten: number;
}

export interface SyncLog {
  info(line: string): void;
  error(line: string): void;
}

interface ProviderRecordShape {
  providerId: string;
  name: string;
  url: string;
  apiKey: string | null;
  models: string[];
}

/** The Command Code custom-provider record the settings call for. Requires `COMMANDCODE_API_KEY`. */
export function commandCodeProviderRecord(env: NodeJS.ProcessEnv = process.env): ProviderRecordShape {
  const apiKey = env.COMMANDCODE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('COMMANDCODE_API_KEY is required when a Command Code model route is configured.');
  }
  return {
    providerId: COMMAND_CODE_PROVIDER_ID,
    name: COMMAND_CODE_PROVIDER_NAME,
    url: env.COMMANDCODE_BASE_URL?.trim() || COMMAND_CODE_DEFAULT_URL,
    apiKey,
    models: commandCodeProviderModels(env),
  };
}

/** Remembers the builder id the last sync wrote, so a later change can replace it without touching explicit choices. */
export function createFileLedger(path: string): SyncLedger {
  return {
    async read() {
      let raw: string;
      try {
        raw = await readFile(path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      try {
        const parsed = JSON.parse(raw) as { builder?: unknown };
        return typeof parsed.builder === 'string' ? parsed.builder : null;
      } catch {
        throw new Error('The model sync ledger file is not valid JSON.');
      }
    },
    async write(builder) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify({ builder })}\n`, { mode: 0o600 });
    },
  };
}

class SyncStepError extends Error {
  readonly step: string;
  constructor(step: string, cause: unknown, env: NodeJS.ProcessEnv) {
    const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : 'non-error value thrown';
    super(`Model settings sync failed at step "${step}": ${redactSecrets(detail, env)}`);
    this.name = 'SyncStepError';
    this.step = step;
    this.cause = cause;
  }
}

async function step<T>(name: string, env: NodeJS.ProcessEnv, run: () => Promise<T> | T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new SyncStepError(name, error, env);
  }
}

export async function syncFactoryModelSettings(
  storage: FactoryStorage,
  env: NodeJS.ProcessEnv,
  ledger: SyncLedger,
): Promise<SyncResult> {
  const settings = validateModelSettings(env);
  const builder = settings.builder;
  const needsCommandCode = commandCodeProviderModels(env).length > 0;

  const { projects, providers } = await step('open stores', env, async () => {
    if (!storage.hasDomain('projects') || !storage.hasDomain('custom-providers')) {
      throw new Error('Factory storage has no projects or custom-providers domain.');
    }
    const projectsDomain = storage.getDomain<FactoryProjectsStorage>('projects');
    const providersDomain = storage.getDomain<CustomProvidersStorage>('custom-providers');
    await projectsDomain.ensureReady();
    await providersDomain.ensureReady();
    return { projects: projectsDomain, providers: providersDomain };
  });

  const allProjects = await step('list projects', env, () => projects.listAll());

  let providersWritten = 0;
  if (needsCommandCode) {
    const wanted = commandCodeProviderRecord(env);
    const createdByOrg = new Map<string, string>();
    for (const project of allProjects) {
      if (!createdByOrg.has(project.orgId)) createdByOrg.set(project.orgId, project.createdBy);
    }
    for (const [orgId, userId] of createdByOrg) {
      const written = await step(`register ${COMMAND_CODE_PROVIDER_NAME} provider`, env, async () => {
        const existing = (await providers.list({ orgId })).find(record => record.providerId === wanted.providerId);
        if (
          existing &&
          existing.name === wanted.name &&
          existing.url === wanted.url &&
          existing.apiKey === wanted.apiKey &&
          isDeepStrictEqual([...existing.models].sort(), [...wanted.models].sort())
        ) {
          return false;
        }
        await providers.upsert({
          orgId,
          userId: existing?.createdBy ?? userId,
          input: { providerId: wanted.providerId, name: wanted.name, url: wanted.url, apiKey: wanted.apiKey ?? undefined, models: wanted.models },
        });
        // Model resolution reads a cached per-organisation snapshot; drop it so the change is live now.
        invalidateCustomProvidersSnapshots({ orgId });
        return true;
      });
      if (written) providersWritten++;
    }
  }

  const previous = await step('read ledger', env, () => ledger.read());
  const legacyBare = builder.slice(builder.indexOf('/') + 1);
  let projectsUpdated = 0;
  let projectsKept = 0;
  for (const project of allProjects) {
    const current = project.defaultModelId;
    const ownedBySettings =
      current === null || current === previous || (isCommandCodeRoute(builder) && current === legacyBare);
    if (!ownedBySettings) {
      projectsKept++;
      continue;
    }
    if (current === builder) continue;
    await step(`update project ${project.id}`, env, () =>
      projects.update({ orgId: project.orgId, id: project.id, input: { defaultModelId: builder } }),
    );
    projectsUpdated++;
  }
  await step('write ledger', env, () => ledger.write(builder));
  return { projectsUpdated, projectsKept, providersWritten };
}

/**
 * Entry-point wrapper: logs what happened with enough context to find the failing
 * step, and rethrows so a failed sync stops Factory from starting on a stale model.
 */
export async function runStartupModelSync(
  storage: FactoryStorage,
  env: NodeJS.ProcessEnv,
  ledger: SyncLedger,
  log: SyncLog = console,
): Promise<SyncResult> {
  try {
    const result = await syncFactoryModelSettings(storage, env, ledger);
    log.info(
      `[Models] Startup sync complete: ${result.projectsUpdated} project(s) set to the builder setting, ` +
        `${result.projectsKept} kept their own model, ${result.providersWritten} ${COMMAND_CODE_PROVIDER_NAME} provider write(s).`,
    );
    return result;
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : 'non-error value thrown', env);
    log.error(`[Models] Startup sync failed; Factory will not start. ${message}`);
    throw error instanceof SyncStepError || !(error instanceof Error)
      ? error
      : new Error(redactSecrets(error.message, env), { cause: error });
  }
}
