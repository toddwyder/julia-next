import test from 'node:test';
import assert from 'node:assert/strict';

import { updateWorkerTools } from './delivery-tool-updates.mjs';

test('updates every configured worker CLI and records the resulting versions', async () => {
  const calls = [];
  const versions = new Map([['codex', ['codex-cli 1.0.0', 'codex-cli 1.1.0']], ['agy', ['1.2.0', '1.3.0']]]);
  const result = await updateWorkerTools(['codex', 'agy'], {
    run: async (command, args) => {
      calls.push([command, ...args]);
      if (args[0] === '--version') return { code: 0, stdout: versions.get(command).shift(), stderr: '' };
      return { code: 0, stdout: `${command} updated`, stderr: '' };
    },
    now: (() => { let tick = 0; return () => `time-${++tick}`; })(),
  });

  assert.equal(result.status, 'PASS');
  assert.deepEqual(calls, [
    ['codex', '--version'], ['codex', 'update'], ['codex', '--version'],
    ['agy', '--version'], ['agy', 'update'], ['agy', '--version'],
  ]);
  assert.deepEqual(result.tools.map(tool => ({ tool: tool.tool, before: tool.beforeVersion, after: tool.afterVersion })), [
    { tool: 'codex', before: 'codex-cli 1.0.0', after: 'codex-cli 1.1.0' },
    { tool: 'agy', before: '1.2.0', after: '1.3.0' },
  ]);
});

test('a failed update stops before any later tool or worker can launch', async () => {
  const calls = [];
  const result = await updateWorkerTools(['codex', 'agy'], {
    run: async (command, args) => {
      calls.push([command, ...args]);
      if (args[0] === '--version') return { code: 0, stdout: 'old', stderr: '' };
      return { code: 7, stdout: '', stderr: 'network unavailable' };
    },
  });

  assert.equal(result.status, 'FAIL');
  assert.match(result.reason, /codex update failed/);
  assert.deepEqual(calls, [['codex', '--version'], ['codex', 'update']]);
});

test('rejects an unapproved executable instead of constructing an update command', async () => {
  await assert.rejects(updateWorkerTools(['claude'], { run: async () => assert.fail('must not launch') }), /unsupported worker CLI/);
});
