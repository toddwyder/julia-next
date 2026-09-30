/**
 * Supported DuckDB observability retention for the Factory deployment.
 *
 * Mastra's own documented pattern (feedback-analytics blog,
 * https://mastra.ai/blog/introducing-feedback-and-feedback-analytics, and the
 * installed `@mastra/duckdb` `DuckDBStore` docs) is to keep the existing
 * default storage and add the DuckDB observability domain through a
 * `MastraCompositeStore`:
 *
 *   const duckdb = new DuckDBStore({ path, retention: DEFAULT_RETENTION });
 *   const observability = await duckdb.getStore('observability');
 *   const storage = new MastraCompositeStore({
 *     id: 'mastra-code-storage',
 *     default: existingStorage,
 *     domains: { observability },
 *   });
 *
 * `retention` is what actually bounds the DuckDB file: `@mastra/duckdb`
 * prunes observability spans (and the other tables it manages) by age when
 * `prune()` is called, and Mastra never calls it for you. The daily
 * `ops/factory/duckdb-prune.mjs` timer calls the same store's `prune()`.
 *
 * This module is deliberately free of a top-level `@mastra/duckdb` import so
 * unit tests can exercise the config and composition with fakes without
 * loading DuckDB's native bindings. The real constructor is loaded inside
 * `createDuckDBStore()`.
 */
import { MastraCompositeStore } from '@mastra/core/storage';
import type {
  MastraCompositeStore as MastraCompositeStoreType,
  ObservabilityStorage,
  RetentionConfig,
} from '@mastra/core/storage';
import { getObservabilityDatabasePath } from '@mastra/code-sdk/utils/project';
import { DEFAULT_RETENTION } from '@mastra/code-sdk/utils/storage-maintenance';

/** Store id for the composed Factory storage. Matches the pre-DuckDB entry. */
export const FACTORY_STORAGE_ID = 'mastra-code-storage';

/** Store id for the DuckDB observability store. */
export const DUCKDB_OBSERVABILITY_ID = 'factory-observability';

/** The retention policy that bounds the DuckDB observability tables. */
export function duckdbObservabilityRetention(): RetentionConfig {
  return DEFAULT_RETENTION;
}

/**
 * The DuckDB file Factory's observability exporter writes. `@mastra/code-sdk`
 * resolves the same path (`MASTRA_OBSERVABILITY_DB_PATH`, else the app data
 * dir's `observability.duckdb`), so the app and the daily prune program agree
 * without a second copy of the path.
 */
export function observabilityDuckDBPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.MASTRA_OBSERVABILITY_DB_PATH?.trim() || getObservabilityDatabasePath();
}

/** The pure config `new DuckDBStore(...)` receives. Kept data-only for tests. */
export function duckdbObservabilityConfig(): { id: string; path: string; retention: RetentionConfig } {
  return {
    id: DUCKDB_OBSERVABILITY_ID,
    path: observabilityDuckDBPath(),
    retention: duckdbObservabilityRetention(),
  };
}

/** The real DuckDB store. Loaded lazily so tests never touch native bindings. */
export async function createDuckDBStore(
  config: { id?: string; path: string; retention?: RetentionConfig } = duckdbObservabilityConfig(),
) {
  const { DuckDBStore } = await import('@mastra/duckdb');
  return new DuckDBStore(config);
}

/**
 * Compose the DuckDB observability domain over the existing default storage.
 * Every other domain still comes from `defaultStorage`; only observability is
 * routed to DuckDB, exactly as the documented pattern shows.
 */
export function composeStorageWithObservability({
  defaultStorage,
  observabilityDomain,
}: {
  defaultStorage: MastraCompositeStoreType;
  observabilityDomain: ObservabilityStorage;
}): MastraCompositeStore {
  return new MastraCompositeStore({
    id: FACTORY_STORAGE_ID,
    default: defaultStorage,
    domains: { observability: observabilityDomain },
  });
}
