#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildRecordFile, isActiveRun, readRuns, writeJsonRecord } from '../lib/state.js';

export const DEFAULT_CHECKOUT = '/home/ubuntu/julia-dashboard';
export const DEFAULT_REF = 'origin/main';
export const UNIT = 'julia-dashboard';

const trimSlash = value => value.replace(/\/+$/, '');
export const checkoutDir = (env = process.env) => trimSlash(env.DASHBOARD_CHECKOUT || DEFAULT_CHECKOUT);
export const updateRef = (env = process.env) => env.DASHBOARD_UPDATE_REF || DEFAULT_REF;

export function decideUpdate(entries = []) {
  const unreadable = entries.filter(entry => entry.error);
  if (unreadable.length) {
    return {
      action: 'skip',
      code: 'unreadable-run-file',
      reason: `${unreadable.length} run ${unreadable.length === 1 ? 'file' : 'files'} cannot be read, so an active run cannot be ruled out`,
      blocking: unreadable.map(entry => ({ file: entry.file, error: entry.error })),
    };
  }
  const active = entries.filter(isActiveRun);
  if (active.length) {
    const named = active.map(entry => `${entry.run.id} is ${entry.run.status}`);
    return {
      action: 'skip',
      code: 'active-run',
      reason: `${named.join(', ')}; no update while a run is starting or running`,
      blocking: active.map(entry => ({ file: entry.file, id: entry.run.id, status: entry.run.status })),
    };
  }
  return { action: 'update', code: 'idle', reason: 'no run is starting or running', blocking: [] };
}

const firstLine = value => String(value ?? '').split('\n')[0].slice(0, 400);

function runCommand(command, args, { capture = true, cwd } = {}) {
  const output = execFileSync(command, args, { encoding: 'utf8', cwd, stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'] });
  return capture ? output.trim() : '';
}

const isSha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);

function checkoutIsAhead({ checkout, head, target, run }) {
  try {
    run('git', ['-C', checkout, 'merge-base', '--is-ancestor', target, head]);
    return true;
  } catch {
    return false;
  }
}

export function runUpdate({ env = process.env, run = runCommand, log = line => console.log(`julia-dashboard: ${line}`), now = () => new Date().toISOString(), entries } = {}) {
  const decided = entries ?? readRuns(env).entries;
  const checkout = checkoutDir(env);
  const ref = updateRef(env);
  const started = Date.now();

  const decision = decideUpdate(decided);
  log(JSON.stringify({ phase: 'decide', checkout, ref, action: decision.action, code: decision.code, reason: decision.reason, blocking: decision.blocking }));
  if (decision.action !== 'update') return { ...decision, checkout, ref, updated: false };

  const step = (phase, fields) => log(JSON.stringify({ phase, checkout, ref, ...fields, ms: Date.now() - started }));
  const attempt = (phase, command, args, options) => {
    try {
      const output = run(command, args, options);
      step(phase, { status: 'ok', command: [command, ...args].join(' ') });
      return { ok: true, output };
    } catch (error) {
      step(phase, { status: 'failed', command: [command, ...args].join(' '), error: firstLine(error.stderr) || firstLine(error.message) });
      return { ok: false };
    }
  };

  if (!attempt('fetch', 'git', ['-C', checkout, 'fetch', '--prune', 'origin']).ok) return { action: 'failed', phase: 'fetch', checkout, ref, updated: false };

  let head;
  let target;
  try {
    head = run('git', ['-C', checkout, 'rev-parse', 'HEAD']);
    target = run('git', ['-C', checkout, 'rev-parse', '--verify', ref]);
  } catch (error) {
    step('resolve', { status: 'failed', error: firstLine(error.message) });
    return { action: 'failed', phase: 'resolve', checkout, ref, updated: false };
  }
  if (!isSha(head) || !isSha(target)) {
    step('resolve', { status: 'failed', error: `HEAD ${JSON.stringify(head)} and ${ref} ${JSON.stringify(target)} are not commits` });
    return { action: 'failed', phase: 'resolve', checkout, ref, updated: false };
  }
  step('resolve', { status: 'ok', head, target });
  if (head === target) {
    step('compare', { status: 'ok', action: 'up-to-date', commit: head });
    return { action: 'up-to-date', commit: head, checkout, ref, updated: false };
  }
  if (checkoutIsAhead({ checkout, head, target, run })) {
    step('compare', { status: 'ok', action: 'ahead', commit: head, target });
    return { action: 'up-to-date', commit: head, checkout, ref, updated: false };
  }
  step('compare', { status: 'ok', action: 'behind', head, target });

  if (!attempt('fast-forward', 'git', ['-C', checkout, 'merge', '--ff-only', target]).ok) return { action: 'failed', phase: 'fast-forward', checkout, ref, updated: false };
  let served = head;
  try {
    served = run('git', ['-C', checkout, 'rev-parse', 'HEAD']);
  } catch (error) {
    step('fast-forward', { status: 'failed', error: firstLine(error.message) });
    return { action: 'failed', phase: 'fast-forward', checkout, ref, updated: false };
  }
  if (served !== target) {
    step('fast-forward', { status: 'failed', error: `checkout stands at ${served}, wanted ${target}` });
    return { action: 'failed', phase: 'fast-forward', checkout, ref, updated: false };
  }
  const app = join(checkout, 'dashboard');
  if (!attempt('install', 'npm', ['ci'], { cwd: app, capture: false }).ok) return { action: 'failed', phase: 'install', checkout, ref, updated: false };
  if (!attempt('build', 'npm', ['run', 'build'], { cwd: app, capture: false }).ok) return { action: 'failed', phase: 'build', checkout, ref, updated: false };
  if (!attempt('restart', 'sudo', ['-n', 'systemctl', 'restart', UNIT]).ok) return { action: 'failed', phase: 'restart', checkout, ref, updated: false };

  const record = { commit: target, ref, updatedAt: now(), previous: head, checkout };
  try {
    writeJsonRecord(buildRecordFile(env), record);
    step('record', { status: 'ok', commit: target, previous: head, file: buildRecordFile(env) });
  } catch (error) {
    step('record', { status: 'failed', error: firstLine(error.message) });
    return { action: 'failed', phase: 'record', checkout, ref, updated: true };
  }
  return { action: 'updated', commit: target, previous: head, checkout, ref, updated: true };
}

function main() {
  const result = runUpdate();
  process.exitCode = result.action === 'failed' ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
