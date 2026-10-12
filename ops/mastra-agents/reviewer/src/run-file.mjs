import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const RUN_EVIDENCE_MAX_BYTES = 64 * 1024 * 1024;
export const RUN_WARNING_RESERVE_BYTES = 64 * 1024;

export async function directoryBytes(directory) {
  let total = 0;
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      total += entry.isDirectory() ? await directoryBytes(path) : (await stat(path)).size;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return total;
}

export async function verifyRunEvidenceLimit(root, maxBytes = RUN_EVIDENCE_MAX_BYTES) {
  const bytes = await directoryBytes(root);
  if (bytes > maxBytes) throw new Error(`reviewer refused: durable evidence uses ${bytes} bytes, above the ${maxBytes} byte limit`);
  return bytes;
}

export async function durableWrite(path, content, { root = dirname(path), maxBytes = RUN_EVIDENCE_MAX_BYTES - RUN_WARNING_RESERVE_BYTES } = {}) {
  await mkdir(dirname(path), { recursive: true });
  await withFileLock(join(root, '.evidence-quota.lock'), async () => {
    if (await directoryBytes(root) + Buffer.byteLength(content, 'utf8') > maxBytes) {
      throw new Error(`reviewer refused: durable evidence limit of ${maxBytes} bytes would be exceeded`);
    }
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    const file = await open(temporaryPath, 'wx');
    try {
      await file.writeFile(content);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, path);
    if (await directoryBytes(root) > maxBytes) throw new Error(`reviewer refused: durable evidence exceeded the ${maxBytes} byte limit`);
  }, 'durable evidence writer is busy');
}

export async function withFileLock(path, operation, busyMessage = 'run-file lock is busy') {
  await mkdir(dirname(path), { recursive: true });
  let lock;
  try { lock = await open(path, 'wx'); }
  catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`reviewer refused: ${busyMessage}`);
    throw error;
  }
  try { return await operation(); }
  finally {
    await lock.close();
    await rm(path, { force: true });
  }
}
