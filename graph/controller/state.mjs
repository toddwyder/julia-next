// state.mjs -- JUL-98 step 4: the little the controller has to remember
// between cycles, kept somewhere it can actually write.
//
// THE CONSTRAINT THIS FILE EXISTS FOR. The controller runs from
// /srv/orchestrator-svc/julia-next, which is root-owned and READ-ONLY to the
// account that runs it (verified live, runbook: "/, /srv, /srv/orchestrator-svc
// and the checkout are not writable by it"). So the controller must never try
// to keep state in its own checkout. It keeps it under $XDG_STATE_HOME --
// ~/.local/state/julia-next/ by default, the same place scripts/ready-queue.mjs
// already keeps its own file, which the runbook records as working for this
// account with a bare environment.
//
// WHAT IS *NOT* HERE. The in-flight record for a card is its Orca run, not a
// field in this file (graph/controller/inflight.mjs, and the 2026-09-20
// Decision: "Use Orca for double-starts and two writers"). Nothing below is a
// lock, and losing this file costs the controller one repeated first sighting
// and one duplicate refusal comment at most -- never a double-started card.
//
// What it holds:
//   ready/commented   the one-full-check rule's memory (selectStartableCard's
//                     `previousReady`/`previousCommented`). These must survive
//                     a restart or every restart would re-sight every card.
//   starts            one record per process start: Task C's crash-loop
//                     evidence.
//   carrying          the card the controller was carrying when it last wrote
//                     -- its real Linear id and identifier -- so a crash loop
//                     knows which card to comment on. Written to disk BEFORE
//                     the work starts (main.mjs's runOnce), because a carry
//                     recorded only in memory is a carry the next process
//                     cannot see.
//   crashReported     the last crash-loop episode already commented on, so the
//                     comment is posted once per episode rather than every
//                     5 seconds for ever.
//   requests          the request-id ledger (wiring.mjs's createRequestLedger):
//                     action -> the id Orca issued for it. It survives a
//                     restart, so if the same action is issued again it is
//                     recognised as a replay and no second worker is started.
//                     Nothing here re-issues an interrupted action: a card
//                     killed mid-flight is NOT picked back up by itself. That
//                     resume is JUL-99.
//   lastError         the last cycle error, so a crash-loop comment can name
//                     what caused the loop.
//   senderTerminal    the Orca terminal handle this controller sends from
//                     (JUL-98 step 5). An Orca terminal handle does not
//                     survive an Orca restart, so it cannot be a thing a human
//                     pastes into the unit once; the controller provisions its
//                     own. It is remembered HERE so a restart re-uses the
//                     terminal it already has instead of creating a fresh one
//                     every RestartSec=5 -- a leak of one terminal every five
//                     seconds, for ever. Checked against Orca before it is
//                     reused: a handle Orca no longer knows is replaced.
//
// EVERY ONE OF THOSE ROUND-TRIPS. `normalize` below is the serializer for both
// directions, so a field it forgets is a field that is silently dropped on read
// -- there is no other place a reader could pick it up.

import os from 'node:os';
import { join, resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

export const ORCHESTRATOR_CHECKOUT = '/srv/orchestrator-svc/julia-next';

export function defaultStateDir({ env = process.env, homedir = os.homedir } = {}) {
  const base = env.XDG_STATE_HOME && env.XDG_STATE_HOME.trim() !== ''
    ? env.XDG_STATE_HOME
    : join(homedir(), '.local', 'state');
  return join(base, 'julia-next');
}

export function defaultStatePath(options = {}) {
  return join(defaultStateDir(options), 'controller.json');
}

export function emptyControllerState() {
  return { ready: {}, commented: {}, starts: [], carrying: null, crashReported: null, requests: {}, lastError: null, senderTerminal: null };
}

// A state path inside the read-only checkout is refused OUTRIGHT rather than
// discovered as an EACCES at the first write -- by which point the controller
// has already done a cycle's work it is about to lose.
export function assertStatePathIsWritable(statePath, { checkout = ORCHESTRATOR_CHECKOUT } = {}) {
  const full = resolve(statePath);
  if (full === checkout || full.startsWith(`${checkout}/`)) {
    throw new Error(
      `controller state: refusing to keep state at ${full} -- ${checkout} is root-owned and read-only to orchestrator-svc, so the controller must never write into its own checkout (set XDG_STATE_HOME instead)`,
    );
  }
  return full;
}

// `typeof [] === 'object'`, so a guard that asks only for an object lets a JSON
// ARRAY through, and the controller then holds an array where it reads keys --
// every lookup undefined, no error anywhere. An array is not a map: it falls
// back to the empty default exactly as a string or a number already does.
function isMap(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalize(parsed) {
  const base = emptyControllerState();
  if (!parsed || typeof parsed !== 'object') return base;
  return {
    ready: isMap(parsed.ready) ? parsed.ready : base.ready,
    commented: isMap(parsed.commented) ? parsed.commented : base.commented,
    starts: Array.isArray(parsed.starts) ? parsed.starts : base.starts,
    carrying: parsed.carrying ?? null,
    crashReported: parsed.crashReported ?? null,
    requests: isMap(parsed.requests) ? parsed.requests : base.requests,
    lastError: typeof parsed.lastError === 'string' ? parsed.lastError : base.lastError,
    // Guarded as a STRING, the same way lastError is: a handle is a string and
    // nothing else, and anything else on disk means the file was written by
    // something other than this controller. Listed here at all because this
    // file's header rule is real -- a field normalize() forgets is dropped on
    // read, and a dropped senderTerminal is a new terminal on every restart.
    senderTerminal: typeof parsed.senderTerminal === 'string' && parsed.senderTerminal !== ''
      ? parsed.senderTerminal
      : base.senderTerminal,
  };
}

// A missing or unreadable state file is an EMPTY state, never a crash: the very
// first start on a fresh account has no file, and that is the normal case, not
// an error. A corrupt file is the same -- the cost is one repeated sighting.
export function readControllerState({ statePath = defaultStatePath(), readFileImpl = readFileSync } = {}) {
  assertStatePathIsWritable(statePath);
  let raw;
  try {
    raw = readFileImpl(statePath, 'utf8');
  } catch {
    return emptyControllerState();
  }
  try {
    return normalize(JSON.parse(raw));
  } catch {
    return emptyControllerState();
  }
}

export function writeControllerState(state, {
  statePath = defaultStatePath(),
  writeFileImpl = writeFileSync,
  mkdirImpl = mkdirSync,
} = {}) {
  assertStatePathIsWritable(statePath);
  mkdirImpl(join(statePath, '..'), { recursive: true });
  writeFileImpl(statePath, `${JSON.stringify(normalize(state), null, 2)}\n`, 'utf8');
  return statePath;
}
