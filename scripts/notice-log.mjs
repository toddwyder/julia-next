// The notice record: one line per notice in the file the stop ping already writes, so a
// notice that did not reach Linear is still visible afterwards.
//
// It lives outside machine/flow because the framework rules keep that folder to definitions
// rather than file writes (ADR 0026), and the stop ping's own writer sits beside it.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { stopsFile } from './scorecard.mjs';

export function recordNotice(entry, file = stopsFile()) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

// One line per notice already sent for this run and kind. A restart that a later boot would
// report again is the case this answers.
export function noticeSeen({ kind, runId }, file = stopsFile()) {
  if (!runId || !existsSync(file)) return false;
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .some(line => {
      try {
        const entry = JSON.parse(line);
        return entry.kind === kind && entry.runId === runId;
      } catch {
        // A half-written line is not worth failing a notice over.
        return false;
      }
    });
}
