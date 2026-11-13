// The per-card spending record is a running record beside the run, like the run record and the
// cost record, and ADR 0026 gives those to a runner file. The flow definitions read the total and
// stop the card; only this file reads and writes the record itself.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function readLedger(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object') return null;
    return {
      card: String(data.card ?? ''),
      limit: Number(data.limit) || 0,
      total: Number(data.total) || 0,
      calls: Array.isArray(data.calls) ? data.calls : [],
      stop: data.stop && typeof data.stop === 'object' ? data.stop : null,
      memoryModel: typeof data.memoryModel === 'string' ? data.memoryModel : null,
    };
  } catch {
    return null;
  }
}

// A write that a reader never sees half done: the new record lands whole, or the old one stays.
export function writeLedger(file, ledger) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`);
  renameSync(temporary, file);
}
