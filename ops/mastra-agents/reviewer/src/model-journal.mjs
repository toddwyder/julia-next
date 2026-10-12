import { durableWrite } from './run-file.mjs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

async function directoryBytes(directory) {
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

export async function createModelJournal({
  path,
  maxBytes = 64 * 1024 * 1024,
  verdictSaved = () => false,
  warnings = [],
}) {
  if (!path) throw new Error('model journal needs a run-file path');
  const runDirectory = dirname(path);
  const warningPath = `${path}.warnings.json`;
  let events;
  let exists = true;
  try {
    events = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(events)) throw new Error('reviewer refused: saved model journal is invalid');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    events = [];
    exists = false;
  }
  let mutation = Promise.resolve();
  const currentBytes = await directoryBytes(runDirectory);
  if (currentBytes > maxBytes) throw new Error(`reviewer refused: durable evidence already exceeds the ${maxBytes} byte limit`);
  if (!exists) {
    const initial = `${JSON.stringify(events)}\n`;
    if (currentBytes + Buffer.byteLength(initial, 'utf8') > maxBytes) throw new Error(`reviewer refused: durable evidence limit of ${maxBytes} bytes would be exceeded`);
    await durableWrite(path, initial);
  }

  const record = event => {
    const operation = mutation.then(async () => {
      try {
        const next = [...events, event];
        const content = `${JSON.stringify(next)}\n`;
        const nextBytes = Buffer.byteLength(content, 'utf8');
        if (await directoryBytes(runDirectory) + nextBytes > maxBytes) throw new Error(`reviewer refused: durable evidence limit of ${maxBytes} bytes would be exceeded`);
        await durableWrite(path, content);
        events.push(event);
        return true;
      } catch (error) {
        if (!verdictSaved()) throw error;
        const warning = `model journal warning: ${error?.message ?? String(error)}`;
        warnings.push(warning);
        try {
          let durableWarnings = [];
          try { durableWarnings = JSON.parse(await readFile(warningPath, 'utf8')); }
          catch (readError) { if (readError?.code !== 'ENOENT') throw readError; }
          await durableWrite(warningPath, `${JSON.stringify([...durableWarnings, warning])}\n`);
        } catch { /* a saved verdict remains authoritative even if its warning cannot be written */ }
        return false;
      }
    });
    mutation = operation.catch(() => {});
    return operation;
  };

  return { record };
}
