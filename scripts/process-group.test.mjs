import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { scratchDir } from './scratch-dir.mjs';

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('runWithFreshToken terminates its child when the parent receives SIGTERM', { skip: process.platform === 'win32' }, async () => {
  mkdirSync(scratchDir, { recursive: true });
  const dir = mkdtempSync(join(scratchDir, 'pg-token-'));
  const marker = join(dir, 'child.pid');
  try {
    const runner = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
        import { runWithFreshToken } from ${JSON.stringify(new URL('./linear-token.mjs', import.meta.url).href)};
        await runWithFreshToken(
          [process.execPath, '-e', 'require("node:fs").writeFileSync(process.env.TEST_MARKER, String(process.pid)); setInterval(() => {}, 1000);'],
          {
            env: { ...process.env, TEST_MARKER: ${JSON.stringify(marker)}, LINEAR_CLIENT_ID: 'id', LINEAR_CLIENT_SECRET: 'secret' },
            fetchImpl: async () => new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 }),
          }
        );
        `,
      ],
      { stdio: 'ignore' }
    );

    let childPid = null;
    for (let i = 0; i < 40; i++) {
      if (existsSync(marker)) {
        childPid = Number(readFileSync(marker, 'utf8').trim());
        if (childPid) break;
      }
      await delay(100);
    }
    assert.ok(childPid, 'child process should start and write its pid');

    runner.kill('SIGTERM');
    await delay(1000);
    const alive = pidAlive(childPid);
    if (alive) {
      try { process.kill(childPid, 'SIGKILL'); } catch {}
    }
    assert.equal(alive, false, 'child process should not survive SIGTERM to runWithFreshToken');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('terminateProcessGroup escalates to SIGKILL when a child ignores SIGTERM', async () => {
  const { terminateProcessGroup } = await import('./process-group.mjs');
  const child = spawn(
    process.execPath,
    ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'],
    { detached: process.platform !== 'win32', stdio: 'ignore' }
  );
  await delay(200);
  assert.equal(pidAlive(child.pid), true);
  await terminateProcessGroup(child.pid, { graceMs: 250 });
  await delay(100);
  assert.equal(pidAlive(child.pid), false, 'child ignoring SIGTERM should be killed by SIGKILL escalation');
});
