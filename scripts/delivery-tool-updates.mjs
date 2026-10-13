import { spawn } from 'node:child_process';
import { safeWorkerEnvironment } from './julia-minimal-runner-checks.mjs';

const COMMANDS = Object.freeze({
  codex: { update: ['update'], version: ['--version'] },
  agy: { update: ['update'], version: ['--version'] },
});

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: safeWorkerEnvironment() });
    let stdout = '';
    let stderr = '';
    const append = (current, chunk) => `${current}${chunk}`.slice(-64 * 1024);
    child.stdout?.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr?.on('data', chunk => { stderr = append(stderr, chunk); });
    child.on('error', error => resolve({ code: null, stdout, stderr, error }));
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

function cleanVersion(result) {
  return String(result.stdout || result.stderr || '').trim();
}

export async function updateWorkerTools(tools, { run = runCommand, now = () => new Date().toISOString() } = {}) {
  const requested = [...new Set(tools)];
  const unsupported = requested.find(tool => !COMMANDS[tool]);
  if (unsupported) throw new Error(`unsupported worker CLI: ${unsupported}`);
  const records = [];
  for (const tool of requested) {
    const command = COMMANDS[tool];
    const startedAt = now();
    const before = await run(tool, command.version);
    if (before.code !== 0 || !cleanVersion(before)) {
      const reason = `${tool} version check failed before update`;
      records.push({ tool, status: 'FAIL', startedAt, finishedAt: now(), reason });
      return { status: 'FAIL', reason, tools: records };
    }
    const updated = await run(tool, command.update);
    if (updated.code !== 0) {
      const reason = `${tool} update failed${updated.stderr ? `: ${String(updated.stderr).trim()}` : ''}`;
      records.push({ tool, status: 'FAIL', startedAt, finishedAt: now(), beforeVersion: cleanVersion(before), updateExitCode: updated.code, reason });
      return { status: 'FAIL', reason, tools: records };
    }
    const after = await run(tool, command.version);
    if (after.code !== 0 || !cleanVersion(after)) {
      const reason = `${tool} version check failed after update`;
      records.push({ tool, status: 'FAIL', startedAt, finishedAt: now(), beforeVersion: cleanVersion(before), updateExitCode: updated.code, reason });
      return { status: 'FAIL', reason, tools: records };
    }
    records.push({
      tool, status: 'PASS', startedAt, finishedAt: now(),
      beforeVersion: cleanVersion(before), afterVersion: cleanVersion(after), updateExitCode: updated.code,
    });
  }
  return { status: 'PASS', tools: records };
}
