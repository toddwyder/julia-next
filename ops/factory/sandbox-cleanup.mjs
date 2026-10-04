#!/usr/bin/env node
// Sandbox retirement cleanup is deliberately dry-run-only. Enabling real
// deletion is a separate operator action after the exceptions-list approval.
import { appendFileSync, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

export const SANDBOX_ROOT = '/var/lib/julia-factory/sandboxes';
export const RETEST_AFTER_MS = 24 * 60 * 60 * 1000;
export const ALLOWED_IGNORED_DIRECTORY_NAMES = new Set([
  'node_modules', '.cache', '.next', '.npm', '.pnpm-store', 'build', 'dist',
]);

// Factory-created working files that do not block deletion per operator decision:
// .artifacts/ (all subfolders), .julia/, test-results/, and __pycache__/ (whether ignored or untracked).
export const ALLOWED_FACTORY_WORKING_DIRECTORY_NAMES = new Set([
  '.artifacts', '.julia', 'test-results', '__pycache__',
]);

const pass = () => ({ ok: true });
const fail = reason => ({ ok: false, reason });

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
  } catch (error) {
    const detail = error?.stderr?.toString().trim() || error?.stdout?.toString().trim() || error?.message || 'unknown command error';
    const wrapped = new Error(`${command} ${args.join(' ')}: ${detail}`);
    wrapped.exitCode = error?.status;
    throw wrapped;
  }
}

function within(root, target) {
  const path = relative(root, target);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..');
}

function targetGate({ sandboxRoot, sessionRoot }) {
  try {
    const root = realpathSync(sandboxRoot);
    const stat = lstatSync(sessionRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return fail('session root is not a real directory');
    const session = realpathSync(sessionRoot);
    if (session !== resolve(sessionRoot)) return fail('session root resolves through a symlink');
    if (dirname(session) !== root || !within(root, session)) return fail('session root is not an immediate child of the sandbox root');
    return pass();
  } catch (error) {
    return fail(`cannot resolve session root safely: ${error.message}`);
  }
}

function checkoutRoot(sessionRoot) {
  if (existsSync(join(sessionRoot, '.git'))) return sessionRoot;
  const candidates = readdirSync(sessionRoot).flatMap(name => {
    const candidate = join(sessionRoot, name);
    const stat = lstatSync(candidate);
    return stat.isDirectory() && !stat.isSymbolicLink() && existsSync(join(candidate, '.git')) ? [candidate] : [];
  });
  if (candidates.length !== 1) throw new Error(`expected one repository checkout below the session root, found ${candidates.length}`);
  return candidates[0];
}

function symlinkGate(sessionRoot) {
  try {
    const root = realpathSync(sessionRoot);
    const pending = [root];
    while (pending.length) {
      const current = pending.pop();
      for (const name of readdirSync(current)) {
        const path = join(current, name);
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) {
          if (!within(root, realpathSync(path))) return fail(`symlink points outside session root: ${path}`);
        } else if (stat.isDirectory()) {
          pending.push(path);
        }
      }
    }
    return pass();
  } catch (error) {
    return fail(`cannot inspect symlinks: ${error.message}`);
  }
}

function idleGate({ sessionRoot }) {
  try {
    // /proc lets us see the child process's cwd and descriptors before lsof;
    // it also gives a deterministic same-user test on the Linux Factory host.
    if (existsSync('/proc')) {
      for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
        try {
          if (within(sessionRoot, realpathSync(`/proc/${pid}/cwd`))) return fail(`process ${pid} runs in the session root`);
          for (const fd of readdirSync(`/proc/${pid}/fd`)) {
            try {
              if (within(sessionRoot, realpathSync(`/proc/${pid}/fd/${fd}`))) return fail(`process ${pid} has an open file in the session root`);
            } catch {
              // The descriptor may close between directory enumeration and read.
            }
          }
        } catch {
          // Another account's process may be unreadable. lsof below is the
          // complete host-wide check; inability to run it fails closed.
        }
      }
    }
    try {
      const open = run('lsof', ['-nP', '+D', sessionRoot]);
      if (open.trim()) return fail('a file is open in the session root');
    } catch (error) {
      if (error.exitCode !== 1) return fail(`cannot prove sandbox is idle: ${error.message}`);
    }
    return pass();
  } catch (error) {
    return fail(`cannot prove sandbox is idle: ${error.message}`);
  }
}

function git(checkout, args) {
  return run('git', args, { cwd: checkout });
}

function pathHasAllowedSegment(path, allowedSet) {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).some(segment => allowedSet.has(segment));
}

function allowedIgnoredPath(path) {
  return pathHasAllowedSegment(path, ALLOWED_IGNORED_DIRECTORY_NAMES) || pathHasAllowedSegment(path, ALLOWED_FACTORY_WORKING_DIRECTORY_NAMES);
}

function allowedUntrackedPath(path) {
  return pathHasAllowedSegment(path, ALLOWED_FACTORY_WORKING_DIRECTORY_NAMES);
}

function gitGate({ sessionRoot }) {
  try {
    const links = symlinkGate(sessionRoot);
    if (!links.ok) return links;
    const checkout = checkoutRoot(sessionRoot);
    if (git(checkout, ['rev-parse', '--is-inside-work-tree']).trim() !== 'true') return fail('checkout is not a Git work tree');
    for (const entry of git(checkout, ['status', '--porcelain=v1', '--ignored=matching', '-z']).split('\0').filter(Boolean)) {
      const code = entry.slice(0, 2);
      const path = entry.slice(3);
      if (code === '!!' && allowedIgnoredPath(path)) continue;
      if (code === '!!') return fail(`ignored path outside allow-list: ${path}`);
      if (code === '??' && allowedUntrackedPath(path)) continue;
      if (code === '??') return fail(`untracked non-ignored file: ${path}`);
      return fail(`changed tracked file: ${path}`);
    }
    if (git(checkout, ['submodule', 'status', '--recursive']).trim()) return fail('submodule present');
    for (const file of git(checkout, ['ls-files', '-z']).split('\0').filter(Boolean)) {
      if (readFileSync(join(checkout, file), 'utf8').slice(0, 128).startsWith('version https://git-lfs.github.com/spec/v1')) return fail(`Git LFS pointer: ${file}`);
    }
    return pass();
  } catch (error) {
    return fail(`cannot verify clean Git state: ${error.message}`);
  }
}

function isGitHubBranch(branch) {
  return branch.startsWith('origin/') && branch !== 'origin/HEAD';
}

function recoverableGate({ sessionRoot }) {
  try {
    const checkout = checkoutRoot(sessionRoot);
    const origin = git(checkout, ['config', '--get', 'remote.origin.url']).trim();
    if (!/(^|[/:])github\.com([/:]|$)/i.test(origin)) return fail('origin is not a GitHub remote');
    // Remote records go stale: a merge that landed after the last fetch looks
    // unsaved, and a branch deleted on GitHub still looks saved. A failed fetch
    // keeps the sandbox.
    git(checkout, ['fetch', 'origin', '--prune']);
    const commits = git(checkout, ['rev-list', 'HEAD', '--branches', '--not', 'origin/main']).trim().split('\n').filter(Boolean);
    const pathsToMatch = new Set();
    for (const commit of commits) {
      const branches = git(checkout, ['branch', '-r', '--contains', commit]).split('\n').map(line => line.trim()).filter(Boolean);
      if (branches.some(isGitHubBranch)) continue;
      for (const path of git(checkout, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', commit]).split('\n').filter(Boolean)) pathsToMatch.add(path);
    }
    // A squash merge replaces the original commits, so none are contained by
    // the surviving remote branch. It is still recoverable if every path those
    // commits changed now has the exact same content in origin/main.
    for (const path of pathsToMatch) {
      if (git(checkout, ['diff', '--name-only', 'origin/main', '--', path]).trim()) return fail(`content changed by an unbranched commit differs from origin/main: ${path}`);
    }
    return pass();
  } catch (error) {
    return fail(`cannot prove recoverable content: ${error.message}`);
  }
}

export function defaultInspection() {
  return { target: targetGate, idle: idleGate, git: gitGate, recoverable: recoverableGate };
}

const gateName = gate => ({ target: 'target', idle: 'idle', git: 'clean-git', recoverable: 'recoverable-content' })[gate] ?? gate;

export function assessSandbox({ sessionId, sandboxRoot = SANDBOX_ROOT, sessionRoot, inspection = defaultInspection() }) {
  const context = { sessionId, sandboxRoot, sessionRoot };
  for (const [gate, check] of Object.entries(inspection)) {
    try {
      const result = check(context);
      if (!result?.ok) return { sessionId, sessionRoot, decision: 'keep', gate: gateName(gate), reason: result?.reason ?? 'unknown check result' };
    } catch (error) {
      return { sessionId, sessionRoot, decision: 'keep', gate: gateName(gate), reason: error.message || String(error) };
    }
  }
  return { sessionId, sessionRoot, decision: 'eligible', gate: null, reason: 'all gates passed' };
}

export function retireSandbox({ sessionId, sandboxRoot = SANDBOX_ROOT, sessionRoot, inspection, allowDelete = false, remove = rmSync, log = () => {} }) {
  const configuredInspection = inspection ?? defaultInspection();
  const context = { sessionId, sandboxRoot, sessionRoot };
  const first = assessSandbox({ ...context, inspection: configuredInspection });
  if (first.decision === 'keep') return keep(first, log);
  if (!allowDelete) return emit({ ...first, decision: 'would-delete', checkedAt: new Date().toISOString() }, log);
  const final = assessSandbox({ ...context, inspection: configuredInspection });
  if (final.decision === 'keep') return keep(final, log);
  // Git inspection can take long enough for a new process to enter the root.
  // This must be the final gate before removal, not just the first gate in a
  // second complete assessment.
  try {
    const finalIdle = configuredInspection.idle(context);
    if (!finalIdle?.ok) return keep({ ...final, gate: 'idle', reason: finalIdle?.reason ?? 'unknown idle check result' }, log);
  } catch (error) {
    return keep({ ...final, gate: 'idle', reason: error.message || String(error) }, log);
  }
  try {
    remove(sessionRoot, { recursive: true, force: false, maxRetries: 0 });
    if (existsSync(sessionRoot)) throw new Error('session root still exists after remove');
    return emit({ ...final, decision: 'delete', checkedAt: new Date().toISOString() }, log);
  } catch (error) {
    return keep({ ...final, gate: 'target', reason: `could not remove session root: ${error.message}` }, log);
  }
}

function emit(event, log) {
  log(event);
  return event;
}

function keep(assessment, log) {
  return emit({ ...assessment, decision: 'keep', checkedAt: new Date().toISOString(), retryAt: new Date(Date.now() + RETEST_AFTER_MS).toISOString() }, log);
}

export function discoverSandboxSessions(sandboxRoot = SANDBOX_ROOT) {
  const root = realpathSync(sandboxRoot);
  return readdirSync(root).flatMap(sessionId => {
    const sessionRoot = join(root, sessionId);
    try {
      const stat = lstatSync(sessionRoot);
      return stat.isDirectory() && !stat.isSymbolicLink() ? [{ sessionId, sandboxRoot: root, sessionRoot }] : [];
    } catch {
      return [];
    }
  });
}

export function findDueSessions({ sandboxRoot = SANDBOX_ROOT, logPath = null }) {
  const sessions = discoverSandboxSessions(sandboxRoot);
  if (!logPath || !existsSync(logPath)) return sessions;
  const lines = readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
  const latestBySession = new Map();
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.sessionId) latestBySession.set(event.sessionId, event);
    } catch {}
  }
  const now = Date.now();
  return sessions.filter(session => {
    const last = latestBySession.get(session.sessionId);
    if (!last || last.decision !== 'keep') return true;
    if (!last.retryAt) return true;
    return new Date(last.retryAt).getTime() <= now;
  });
}

function parseArgs(argv) {
  const args = { sandboxRoot: SANDBOX_ROOT, sessionRoot: null, all: false, logPath: null, allowDelete: false, retest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--sandbox-root') args.sandboxRoot = argv[++index];
    else if (value === '--session-root') args.sessionRoot = argv[++index];
    else if (value === '--all') args.all = true;
    else if (value === '--log') args.logPath = argv[++index];
    else if (value === '--allow-delete') args.allowDelete = true;
    else if (value === '--retest') args.retest = true;
    else throw new Error(`unknown argument: ${value}`);
  }
  const modes = [args.all, Boolean(args.sessionRoot), args.retest].filter(Boolean).length;
  if (modes !== 1) throw new Error('usage: sandbox-cleanup.mjs (--session-root PATH | --all | --retest) [--sandbox-root PATH] [--log PATH] [--allow-delete]');
  return args;
}

if (import.meta.main) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const log = event => {
      if (args.logPath) appendFileSync(args.logPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
      process.stdout.write(`${JSON.stringify(event)}\n`);
    };
    const sessions = args.retest
      ? findDueSessions({ sandboxRoot: args.sandboxRoot, logPath: args.logPath })
      : args.all
        ? discoverSandboxSessions(args.sandboxRoot)
        : [{ sessionId: resolve(args.sessionRoot).split(/[/\\]/).filter(Boolean).at(-1), sandboxRoot: args.sandboxRoot, sessionRoot: resolve(args.sessionRoot) }];
    const events = sessions.map(session => retireSandbox({ ...session, allowDelete: args.allowDelete, log }));
    if (args.retest) {
      for (const event of events) {
        if (event.decision === 'keep') {
          process.stderr.write(`still failing: ${event.sessionId} (${event.gate}: ${event.reason})\n`);
        }
      }
    }
    process.exitCode = (args.all || args.retest) ? 0 : events[0].decision === 'keep' ? 1 : 0;
  } catch (error) {
    process.stderr.write(`sandbox-cleanup: ${error.message}\n`);
    process.exitCode = 2;
  }
}
