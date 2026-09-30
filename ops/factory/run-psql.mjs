// run-psql.mjs -- issue #140: the one place the Monday note shells out to the
// installed `psql` client, mirroring how ops/factory/wait-alerts.py reads
// Factory's records. It returns `{ stdout, stderr, status }` instead of
// throwing, so the card reader decides how to fail closed.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Run `psql` with explicit args and a read-only environment.
 *
 * `args` and `env` come from factory-cards.mjs, which sets
 * `PGOPTIONS=-c default_transaction_read_only=on`. Only PATH and the PG*
 * variables are passed through, so the subprocess cannot pick up an ambient
 * connection or write setting.
 */
export async function runPsql({ args, env }) {
  const passthrough = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (key === 'PATH' || key.startsWith('PG') || key === 'PGOPTIONS') passthrough[key] = value;
  }
  try {
    const { stdout, stderr } = await execFileAsync('psql', args, { env: passthrough, maxBuffer: 64 * 1024 * 1024 });
    return { stdout, stderr, status: 0 };
  } catch (error) {
    return { stdout: error.stdout ?? '', stderr: error.stderr ?? error.message, status: error.code ?? 1 };
  }
}
