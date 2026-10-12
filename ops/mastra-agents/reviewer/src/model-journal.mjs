import { durableWrite } from './run-file.mjs';
import { readFile } from 'node:fs/promises';

export async function createModelJournal({
  path,
  maxBytes = 64 * 1024 * 1024,
  verdictSaved = () => false,
  warnings = [],
}) {
  if (!path) throw new Error('model journal needs a run-file path');
  let events;
  try {
    events = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(events)) throw new Error('reviewer refused: saved model journal is invalid');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    events = [];
  }
  let mutation = Promise.resolve();
  await durableWrite(path, `${JSON.stringify(events)}\n`);

  const record = event => {
    const operation = mutation.then(async () => {
      try {
        const next = [...events, event];
        const content = `${JSON.stringify(next)}\n`;
        if (Buffer.byteLength(content, 'utf8') > maxBytes) throw new Error(`reviewer refused: model journal limit of ${maxBytes} bytes would be exceeded`);
        await durableWrite(path, content);
        events.push(event);
        return true;
      } catch (error) {
        if (!verdictSaved()) throw error;
        warnings.push(`model journal warning: ${error?.message ?? String(error)}`);
        return false;
      }
    });
    mutation = operation.catch(() => {});
    return operation;
  };

  return { record };
}
