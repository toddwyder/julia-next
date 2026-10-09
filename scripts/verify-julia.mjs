import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = join(root, '.artifacts', 'verify-julia');
const statePath = join(artifactRoot, 'run.json');
const nextCli = join(root, 'node_modules', 'next', 'dist', 'bin', 'next');

function fail(message) {
  console.error(`verify-julia: ${message}`);
  process.exitCode = 1;
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
}

function candidateIdentity() {
  const packageBytes = readFileSync(join(root, 'package.json'));
  const packageJson = JSON.parse(packageBytes.toString('utf8'));
  const hash = createHash('sha256');
  hash.update(git(['diff', '--binary', 'HEAD']));
  hash.update(packageBytes);
  for (const relativePath of git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean).sort()) {
    hash.update(relativePath);
    hash.update(readFileSync(join(root, relativePath)));
  }
  const addDirectory = (relativeDirectory) => {
    const absoluteDirectory = join(root, relativeDirectory);
    if (!existsSync(absoluteDirectory)) return;
    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relativePath = join(relativeDirectory, entry.name);
      if (entry.isDirectory()) addDirectory(relativePath);
      else if (entry.isFile()) {
        hash.update(relativePath);
        hash.update(readFileSync(join(root, relativePath)));
      }
    }
  };
  addDirectory('.agents/skills/verify-julia');
  addDirectory('.agents/skills/playwright-cli');
  return {
    root,
    branch: git(['branch', '--show-current']),
    commit: git(['rev-parse', 'HEAD']),
    worktreeSha256: hash.digest('hex'),
    nodeVersion: process.version,
    version: packageJson.version,
    nextVersion: JSON.parse(readFileSync(join(root, 'node_modules', 'next', 'package.json'), 'utf8')).version,
    playwrightVersion: JSON.parse(readFileSync(join(root, 'node_modules', '@playwright', 'test', 'package.json'), 'utf8')).version,
  };
}

function loadState() {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`no active run record at ${statePath}; launch this checkout first`);
  }
}

function writeState(state) {
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function portOwners(port) {
  const output = execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
  const owners = new Set();
  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 5 || fields[0] !== 'TCP' || fields[3] !== 'LISTENING') continue;
    if (fields[1].endsWith(`:${port}`)) owners.add(Number(fields[4]));
  }
  return [...owners].filter(Number.isInteger);
}

function processTree(rootPid) {
  const script = [
    `$all=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,CreationDate)`,
    `$rootRow=$all | Where-Object { $_.ProcessId -eq ${rootPid} } | Select-Object -First 1`,
    `$root=if($rootRow){[pscustomobject]@{ProcessId=$rootRow.ProcessId;CommandLine=$rootRow.CommandLine;Created=$rootRow.CreationDate.ToUniversalTime().ToString('o')}}else{$null}`,
    `$ids=[System.Collections.Generic.List[uint32]]::new(); [void]$ids.Add([uint32]${rootPid})`,
    `$changed=$true; while($changed){$changed=$false; foreach($p in $all){if($ids.Contains([uint32]$p.ParentProcessId) -and -not $ids.Contains([uint32]$p.ProcessId)){[void]$ids.Add([uint32]$p.ProcessId);$changed=$true}}}`,
    `$tree=@($all | Where-Object { $ids.Contains([uint32]$_.ProcessId) } | ForEach-Object { [pscustomobject]@{ProcessId=$_.ProcessId;CommandLine=$_.CommandLine;Created=$_.CreationDate.ToUniversalTime().ToString('o')} })`,
    `[pscustomobject]@{Root=$root;Tree=$tree} | ConvertTo-Json -Compress -Depth 4`,
  ].join('; ');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim();
  if (!output) return { root: null, tree: [] };
  const parsed = JSON.parse(output);
  return { root: parsed.Root ?? null, tree: Array.isArray(parsed.Tree) ? parsed.Tree : parsed.Tree ? [parsed.Tree] : [] };
}

function assertRootIdentity(state, treeInfo) {
  const rootProcess = treeInfo.root;
  if (!rootProcess?.CommandLine) throw new Error(`recorded process ${state.pid} is no longer running`);
  const commandLine = rootProcess.CommandLine.toLowerCase().replaceAll('/', '\\');
  const expectedCli = join(state.candidate.root, 'node_modules', 'next', 'dist', 'bin', 'next').toLowerCase().replaceAll('/', '\\');
  if (!commandLine.includes(expectedCli) || !commandLine.includes(' dev ') || !commandLine.includes(`--port ${state.port}`)) {
    throw new Error(`process ${state.pid} does not match the recorded Next.js command and checkout`);
  }
  const processStartedAt = Date.parse(rootProcess.Created);
  if (!Number.isFinite(processStartedAt) || Math.abs(processStartedAt - state.startedAt) > 15_000) {
    throw new Error(`process ${state.pid} creation time does not match this launch`);
  }
}

async function selectPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const { port } = server.address();
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  if (portOwners(port).length) return selectPort();
  return port;
}

async function waitForReady(state, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = 'listener not assigned to this process tree';
  while (Date.now() < deadline) {
    const treeInfo = processTree(state.pid);
    if (!treeInfo.root?.CommandLine) throw new Error(`Next.js exited before becoming ready; see ${join(state.evidenceDir, 'server.log')}`);
    assertRootIdentity(state, treeInfo);
    const treeIds = new Set(treeInfo.tree.map(({ ProcessId }) => Number(ProcessId)));
    const owners = portOwners(state.port);
    if (owners.some((pid) => treeIds.has(pid))) {
      try {
        const response = await fetch(`${state.baseURL}/api/health`, { signal: AbortSignal.timeout(1500) });
        if (response.ok) {
          const health = await response.json();
          if (health.status === 'ok') return { health, listenerPids: owners.filter((pid) => treeIds.has(pid)) };
          lastFailure = `/api/health returned unexpected body ${JSON.stringify(health)}`;
        } else {
          lastFailure = `/api/health returned HTTP ${response.status}`;
        }
      } catch (error) {
        lastFailure = error.message;
      }
    }
    await delay(500);
  }
  throw new Error(`Next.js did not become ready within ${timeoutMs}ms: ${lastFailure}; see ${join(state.evidenceDir, 'server.log')}`);
}

async function launch() {
  try { loadState(); throw new Error('a run is already recorded; clean it up before launching another'); }
  catch (error) { if (!String(error.message).startsWith('no active run record')) throw error; }
  const candidate = candidateIdentity();
  const port = await selectPort();
  const baseURL = `http://127.0.0.1:${port}`;
  const runId = `${new Date().toISOString().replaceAll(':', '').replaceAll('.', '-')}-${randomUUID().slice(0, 8)}`;
  const session = `verify-julia-${runId}`;
  const runDir = join(artifactRoot, runId);
  const evidenceDir = join(runDir, 'evidence');
  const distDir = join('.next', 'verify-julia', runId);
  mkdirSync(evidenceDir, { recursive: true });
  const args = [nextCli, 'dev', '--hostname', '127.0.0.1', '--port', String(port)];
  const state = { runId, session, candidate, port, url: baseURL, baseURL, pid: null, startedAt: Date.now(), runDir, evidenceDir, distDir, args, status: 'starting' };
  writeState(state);
  const logFd = openSync(join(evidenceDir, 'server.log'), 'a');
  let child;
  try {
    child = spawn(process.execPath, args, {
      cwd: root,
      env: {
        ...process.env,
        JULIA_VERIFY_RUN_ID: runId,
        JULIA_VERIFY_COMMIT: candidate.commit,
        JULIA_VERIFY_DIST_DIR: distDir,
      },
      detached: true,
      windowsHide: true,
      stdio: ['ignore', logFd, logFd],
    });
    await new Promise((resolveSpawn, rejectSpawn) => {
      child.once('spawn', resolveSpawn);
      child.once('error', rejectSpawn);
    });
    child.unref();
    state.pid = child.pid;
    state.status = 'started';
    writeState(state);
  } catch (error) {
    state.status = 'failed-to-start';
    state.startError = error.message;
    writeState(state);
    throw new Error(`server failed to start; cleanup can remove this failed run record: ${error.message}`);
  } finally {
    closeSync(logFd);
  }
  try {
    const readiness = await waitForReady(state);
    state.status = 'ready';
    state.readyAt = Date.now();
    state.readiness = readiness;
    writeState(state);
    console.log(JSON.stringify({ runId, session, url: baseURL, command: [process.execPath, ...args], environment: { JULIA_VERIFY_RUN_ID: runId, JULIA_VERIFY_COMMIT: candidate.commit, JULIA_VERIFY_DIST_DIR: distDir }, candidate, pid: child.pid, readiness, log: join(evidenceDir, 'server.log'), evidenceDir }, null, 2));
  } catch (error) {
    state.status = 'failed-to-become-ready';
    state.startError = error.message;
    writeState(state);
    throw error;
  }
}

async function doctor() {
  const state = loadState();
  if (!state.pid) throw new Error(`run ${state.runId} has no started process; run cleanup`);
  const candidate = candidateIdentity();
  if (candidate.root !== state.candidate.root || candidate.commit !== state.candidate.commit || candidate.worktreeSha256 !== state.candidate.worktreeSha256) {
    throw new Error(`candidate changed since launch; cleanup run ${state.runId} and relaunch`);
  }
  const treeInfo = processTree(state.pid);
  assertRootIdentity(state, treeInfo);
  const treeIds = new Set(treeInfo.tree.map(({ ProcessId }) => Number(ProcessId)));
  const owners = portOwners(state.port);
  if (!owners.some((pid) => treeIds.has(pid))) throw new Error(`port ${state.port} has no listener in the recorded Next.js process tree`);
  const healthDeadline = Date.now() + 6000;
  let health;
  let healthAttempts = 0;
  let healthFailure = 'no attempt made';
  while (healthAttempts < 3 && Date.now() < healthDeadline) {
    healthAttempts += 1;
    try {
      const timeout = Math.min(1500, Math.max(1, healthDeadline - Date.now()));
      const response = await fetch(`${state.baseURL}/api/health`, { signal: AbortSignal.timeout(timeout) });
      if (!response.ok) throw new Error(`/api/health returned HTTP ${response.status}`);
      health = await response.json();
      if (health.status !== 'ok') throw new Error(`/api/health returned unexpected body ${JSON.stringify(health)}`);
      break;
    } catch (error) {
      healthFailure = error.message;
      if (healthAttempts < 3 && Date.now() < healthDeadline) await delay(Math.min(500, healthDeadline - Date.now()));
    }
  }
  if (!health) throw new Error(`/api/health failed after ${healthAttempts} bounded attempts within 6 seconds: ${healthFailure}`);
  console.log(JSON.stringify({ runId: state.runId, session: state.session, url: state.baseURL, command: [process.execPath, ...state.args], candidate, pid: state.pid, listenerPids: owners.filter((pid) => treeIds.has(pid)), health, healthAttempts, evidenceDir: state.evidenceDir }, null, 2));
}

function cleanup() {
  let state;
  try { state = loadState(); } catch (error) {
    if (String(error.message).startsWith('no active run record')) {
      console.log('No active verify-julia run record.');
      return;
    }
    throw error;
  }
  if (state.pid) {
    const treeInfo = processTree(state.pid);
    if (treeInfo.root?.CommandLine) {
      assertRootIdentity(state, treeInfo);
      try { execFileSync('taskkill.exe', ['/PID', String(state.pid), '/T', '/F'], { stdio: 'ignore' }); }
      catch (error) {
        const stillRunning = processTree(state.pid).root?.CommandLine;
        if (stillRunning) throw error;
      }
      const remaining = processTree(state.pid);
      const remainingIds = new Set(remaining.tree.map(({ ProcessId }) => Number(ProcessId)));
      if (remaining.root?.CommandLine || portOwners(state.port).some((pid) => remainingIds.has(pid))) {
        throw new Error(`Next.js process tree or its listener still exists for run ${state.runId}`);
      }
    } else {
      const descendants = treeInfo.tree.filter(({ ProcessId }) => Number(ProcessId) !== Number(state.pid));
      const rootPath = state.candidate.root.toLowerCase().replaceAll('/', '\\');
      const listenerOwners = new Set(portOwners(state.port));
      const isVerifiedListener = ({ ProcessId, CommandLine, Created }, owners) => {
        const commandLine = String(CommandLine ?? '').toLowerCase().replaceAll('/', '\\');
        const createdAt = Date.parse(Created);
        return commandLine.includes(`${rootPath}\\node_modules\\next\\dist\\`)
          && Number.isFinite(createdAt) && createdAt >= state.startedAt - 15_000
          && owners.has(Number(ProcessId));
      };
      const verifiedChildren = descendants.filter((process) => isVerifiedListener(process, listenerOwners));
      for (const process of verifiedChildren) {
        try { execFileSync('taskkill.exe', ['/PID', String(process.ProcessId), '/F'], { stdio: 'ignore' }); }
        catch (error) {
          const remaining = processTree(state.pid).tree.some(({ ProcessId }) => Number(ProcessId) === Number(process.ProcessId));
          if (remaining) console.error(`verify-julia: could not stop verified child PID ${process.ProcessId}: ${error.message}`);
        }
      }
      const remaining = processTree(state.pid).tree.filter(({ ProcessId }) => Number(ProcessId) !== Number(state.pid));
      const remainingOwners = new Set(portOwners(state.port));
      const remainingVerified = remaining.filter((process) => isVerifiedListener(process, remainingOwners));
      if (remainingVerified.length) throw new Error(`verified Next.js child processes remain after cleanup: ${remainingVerified.map(({ ProcessId }) => ProcessId).join(', ')}`);
      if (remaining.length) console.error(`verify-julia: leaving unverified descendants untouched: ${remaining.map(({ ProcessId }) => ProcessId).join(', ')}`);
      if (portOwners(state.port).length) console.error(`verify-julia: port ${state.port} remains occupied by a process outside the verified Next.js tree; leaving it untouched`);
    }
  }
  const distPath = resolve(root, state.distDir);
  const distPrefix = resolve(root, '.next', 'verify-julia') + '\\';
  if (!distPath.toLowerCase().startsWith(distPrefix.toLowerCase())) throw new Error(`refusing to remove unexpected build output path ${distPath}`);
  const processRemainder = state.pid ? processTree(state.pid).tree.filter(({ ProcessId }) => Number(ProcessId) !== Number(state.pid)) : [];
  if (processRemainder.length) {
    console.error(`verify-julia: preserving isolated output because descendants remain: ${distPath}`);
  } else {
    rmSync(distPath, { recursive: true, force: true });
  }
  rmSync(statePath, { force: true });
  console.log(JSON.stringify({ runId: state.runId, stoppedPid: state.pid, preservedEvidence: state.evidenceDir }, null, 2));
}

const command = process.argv[2];
try {
  if (command === 'launch') await launch();
  else if (command === 'doctor') await doctor();
  else if (command === 'cleanup') cleanup();
  else throw new Error('usage: node scripts/verify-julia.mjs <launch|doctor|cleanup>');
} catch (error) {
  fail(error.message);
}
