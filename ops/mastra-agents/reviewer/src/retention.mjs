import { DuckDBStore } from '@mastra/duckdb';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const reviewerRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

export async function pruneReviewerTraces(storageDirectory = resolve(reviewerRoot, 'traces')) {
  const path = resolve(storageDirectory, 'reviewer-costs.duckdb');
  const storage = new DuckDBStore({
    id: 'julia-reviewer-retention',
    path,
    retention: { observability: { spans: { maxAge: '14d' } } },
  });
  try {
    await storage.observability.init();
    return await storage.prune({ maxRows: 100_000, pauseMs: 25 });
  } finally {
    await storage.close();
  }
}

async function main() {
  const results = await pruneReviewerTraces(process.argv[2]);
  console.log(JSON.stringify({ database: 'reviewer-costs.duckdb', retention: { spans: '14d' }, results }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
