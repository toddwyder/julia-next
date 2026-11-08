// The review of 8 Nov waited inside get_process_output for ten minutes on a
// server that never exits. These tests plant that call and pin the refusal.

import test from 'node:test';
import assert from 'node:assert/strict';

import { GET_PROCESS_OUTPUT, installBlockingWaitRefusal, refuseBlockingWait, stillRunning } from './tools.mjs';

const workspaceWith = processes => ({ sandbox: { processes } });

const manager = exits => ({
  async get(pid) {
    return exits === null ? null : { pid, exitCode: exits };
  },
});

test('a blocking wait on a running process is refused with the reason and the way on', async () => {
  const refusal = await refuseBlockingWait({
    workspaceToolName: GET_PROCESS_OUTPUT,
    toolName: 'get_process_output',
    input: { pid: '1284129', wait: true },
    context: { workspace: workspaceWith(manager(undefined)) },
  });
  assert.equal(refusal.proceed, false);
  assert.match(refusal.output, /process 1284129 is still running/);
  assert.match(refusal.output, /no wait/);
  assert.match(refusal.output, /bounded check instead/);
});

test('a blocking wait on a process that has already exited is allowed', async () => {
  const refusal = await refuseBlockingWait({
    workspaceToolName: GET_PROCESS_OUTPUT,
    input: { pid: '42', wait: true },
    context: { workspace: workspaceWith(manager(0)) },
  });
  assert.equal(refusal, undefined);
});

test('reading a running process without wait is allowed', async () => {
  const refusal = await refuseBlockingWait({
    workspaceToolName: GET_PROCESS_OUTPUT,
    input: { pid: '1284129', tail: 40 },
    context: { workspace: workspaceWith(manager(undefined)) },
  });
  assert.equal(refusal, undefined);
});

test('the refusal is only for the process output tool', async () => {
  const refusal = await refuseBlockingWait({
    workspaceToolName: 'mastra_workspace_execute_command',
    input: { command: 'npm test', wait: true },
    context: { workspace: workspaceWith(manager(undefined)) },
  });
  assert.equal(refusal, undefined);
});

test('a pid the process manager does not know is left to the tool to report', async () => {
  assert.equal(await stillRunning(manager(null), '999'), false);
  assert.equal(await stillRunning(undefined, '999'), false);
});

test('the refusal chains onto the workspace guide that is already installed', async () => {
  const calls = [];
  const installed = [];
  const workspace = {
    ...workspaceWith(manager(undefined)),
    getToolsConfig: () => ({
      mastra_workspace_execute_command: { name: 'execute_command', requireDescription: true },
      hooks: { beforeToolCall: async input => calls.push(input.workspaceToolName) },
    }),
    setToolsConfig: config => installed.push(config),
  };

  assert.equal(installBlockingWaitRefusal(workspace), true);
  const config = installed[0];
  assert.equal(config.mastra_workspace_execute_command.name, 'execute_command', 'the names mastracode set are kept');

  const refusal = await config.hooks.beforeToolCall({
    workspaceToolName: GET_PROCESS_OUTPUT,
    input: { pid: '7', wait: true },
    context: { workspace: workspaceWith(manager(undefined)) },
  });
  assert.equal(refusal.proceed, false);
  assert.deepEqual(calls, [], 'a refused wait never reaches the earlier guard as a pass-through');

  const passed = await config.hooks.beforeToolCall({
    workspaceToolName: 'mastra_workspace_read_file',
    input: { path: 'README.md' },
    context: { workspace: workspaceWith(manager(undefined)) },
  });
  assert.equal(passed, 1, 'every other tool still runs the earlier guard');
});
