// seat-worktree.mjs -- JUL-98 step 6: one worktree made ready for one agent,
// BEFORE that agent is started in it. Runs AS THE WORKER, inside the worker-side
// terminal scripts/prepare-seat-worktree.mjs is started in -- the same route
// ./cost-read.mjs takes, and for the same reason: both of the things it does are
// the worker's own files.
//
//   * the agent's folder-trust list (./agent-trust.mjs records the measurement:
//     ~/.gemini/antigravity-cli/settings.json, mode 0600, owned by `runner`).
//     A TUI on a folder it has not seen asks whether the folder is trusted and
//     then does nothing -- the 19-20 September eight-hour stall.
//   * the allowance reading, for an agent billed against one, so the cost line
//     has something to difference against when the worker reports.
//
// It is its own file rather than part of ./cost-read.mjs because the two change
// for different reasons: that one reads figures a finished worker left behind,
// this one prepares a worktree a worker has not started in yet.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { addTrustedWorkspace, hasTrustStore, trustStoreFor } from './agent-trust.mjs';
import { WORKER_HOME, geminiAllowanceFromUsage, geminiAllowanceBuckets, readAgyAllowance } from './cost-read.mjs';

// ---------------------------------------------------------------------------
// Preparing one worktree for one agent, as the worker
// ---------------------------------------------------------------------------

// Two things, both of which only the WORKER can do, and both of which have to
// happen BEFORE the agent is started:
//
//   * the worktree goes into the agent's own folder-trust list, if it has one
//     (./agent-trust.mjs records the measurement that says agy does and Pi does
//     not). `trusted: true` means "this agent will not stop on a trust question
//     in this folder" -- an entry was written, or there is no list to write to.
//   * the allowance is read, for an agent billed against one, so the cost line
//     has something to difference against when the worker reports.
export async function prepareSeatWorktree({
  agent,
  worktreePath,
  workerHome = WORKER_HOME,
  readFileImpl = readFileSync,
  writeFileImpl = writeFileSync,
  mkdirImpl = mkdirSync,
  readAllowanceImpl = readAgyAllowance,
} = {}) {
  let trustStore = null;
  let added = false;
  if (hasTrustStore(agent)) {
    const store = trustStoreFor(agent);
    const file = join(workerHome, store.file);
    const next = addTrustedWorkspace({ agent, text: readIfPresent(file, readFileImpl), worktreePath });
    mkdirImpl(dirname(file), { recursive: true });
    writeFileImpl(file, next.text);
    // READ BACK. The write is the intention; this is the fact.
    const written = addTrustedWorkspace({ agent, text: readIfPresent(file, readFileImpl), worktreePath });
    if (written.added) {
      throw new Error(`prepare-seat-worktree: ${worktreePath} is still not in ${agent}'s trust list (${file}) after writing it -- an untrusted folder is what a TUI stops dead on, so this worktree is not prepared`);
    }
    trustStore = file;
    added = next.added;
  }
  const allowance = agent === 'agy'
    ? geminiAllowanceFromUsage(await readAllowanceImpl(), { buckets: geminiAllowanceBuckets() })
    : null;
  return { agent, worktreePath, trusted: true, trustStore, added, allowance };
}

// No settings file yet just means the agent has never run here; an empty store
// is a real starting point. An unreadable one is a different thing, and
// addTrustedWorkspace refuses that by itself.
function readIfPresent(file, readFileImpl) {
  try {
    return readFileImpl(file, 'utf8');
  } catch {
    return '';
  }
}

