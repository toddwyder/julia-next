import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSandboxProbeCommand, buildCodexAcceptanceCommand, buildCloserPrompt,
  runCodexSandboxProbe, runCodexAcceptanceRun, runCloser, main,
} from './jul73-quota-reset-run.mjs';

test('buildSandboxProbeCommand runs the probe script directly under codex danger-full-access, with the shared env prefix', () => {
  const command = buildSandboxProbeCommand();
  assert.match(command, /export ORCA_BIN=\/opt\/Orca\/orca-ide ORCA_ENVIRONMENT=ovh-local/);
  assert.match(command, /set -a; \. \/etc\/orchestrator-svc\/\.env\.publisher; set \+a/);
  assert.match(command, /codex exec -s danger-full-access/);
  assert.match(command, /-- node scripts\/jul73-codex-sandbox-probe\.mjs/);
});

test('buildCodexAcceptanceCommand puts the shim dir first on PATH, sets the codex vendor, and targets JUL-76', () => {
  const command = buildCodexAcceptanceCommand('/tmp/some-shim-dir');
  assert.match(command, /export PATH=\/tmp\/some-shim-dir:\$PATH ORCHESTRATOR_VENDOR=codex/);
  assert.match(command, /node scripts\/julia-run\.mjs JUL-76/);
  assert.match(command, /JUL73_EXIT:\$\?/);
});

test('runCodexSandboxProbe dispatches, waits for the JSON result, and parses it', async () => {
  const calls = [];
  const terminalCreateImpl = async (args) => { calls.push(args); return { terminal: { handle: 'term_probe' } }; };
  const terminalReadImpl = async () => ({ terminal: { tail: ['some prompt$ ...', '{"publisherReadable":true,"orcaReachable":true}'] } });
  const result = await runCodexSandboxProbe({ terminalCreateImpl, terminalReadImpl, waitImpl: async () => {} });
  assert.deepEqual(result, { publisherReadable: true, orcaReachable: true, raw: '{"publisherReadable":true,"orcaReachable":true}' });
  assert.equal(calls[0].environment, 'orchestrator-local');
});

test('runCodexSandboxProbe treats no parseable JSON (e.g. codex itself walled) as a fail, not a crash', async () => {
  const terminalCreateImpl = async () => ({ terminal: { handle: 'term_probe' } });
  const terminalReadImpl = async () => ({ terminal: { tail: ['ERROR: usage limit'] } });
  const result = await runCodexSandboxProbe({ terminalCreateImpl, terminalReadImpl, waitImpl: async () => {}, maxPolls: 1 });
  assert.equal(result.publisherReadable, false);
  assert.equal(result.orcaReachable, false);
});

test('runCodexAcceptanceRun reports the exit code and whether the shim was ever invoked', async () => {
  const terminalCreateImpl = async () => ({ terminal: { handle: 'term_run' } });
  const terminalReadImpl = async () => ({ terminal: { tail: ['...', 'JUL73_EXIT:0'] } });
  const readFileImpl = () => '';
  const result = await runCodexAcceptanceRun({
    terminalCreateImpl, terminalReadImpl, waitImpl: async () => {}, readFileImpl, shimDir: '/tmp/shim', logPath: '/tmp/shim/claude-shim.log',
  });
  assert.equal(result.juliaRunExitCode, 0);
  assert.equal(result.shimInvoked, false);
});

test('runCodexAcceptanceRun flags a non-empty shim log as an Anthropic call happening (must not pass)', async () => {
  const terminalCreateImpl = async () => ({ terminal: { handle: 'term_run' } });
  const terminalReadImpl = async () => ({ terminal: { tail: ['JUL73_EXIT:0'] } });
  const readFileImpl = () => 'SHIM INVOKED: /tmp/shim/claude -p something\n';
  const result = await runCodexAcceptanceRun({
    terminalCreateImpl, terminalReadImpl, waitImpl: async () => {}, readFileImpl, shimDir: '/tmp/shim', logPath: '/tmp/shim/claude-shim.log',
  });
  assert.equal(result.shimInvoked, true);
});

test('buildCloserPrompt embeds the mechanical evidence and both branch instructions', () => {
  const prompt = buildCloserPrompt({
    sandboxProbe: { publisherReadable: true, orcaReachable: true },
    acceptanceRun: { juliaRunExitCode: 0, shimInvoked: false },
    sinceIso: '2026-09-19T19:43:00.000Z',
  });
  assert.match(prompt, /publisherReadable.*true/s);
  assert.match(prompt, /orcaReachable.*true/s);
  assert.match(prompt, /shimInvoked.*false/s);
  assert.match(prompt, /2026-09-19T19:43:00\.000Z/);
  assert.match(prompt, /JUL-76/);
  assert.match(prompt, /JUL-75/);
  assert.match(prompt, /JUL-73/);
  assert.match(prompt, /JUL-44/);
  assert.match(prompt, /No retry/i);
});

test('runCloser allows both Linear tool names and the scripts the closer needs, and checks for denial the way defaultPostCommentImpl did', async () => {
  let calledArgs;
  const execImpl = async (cmd, args) => {
    calledArgs = args;
    return { stdout: JSON.stringify({ is_error: false, permission_denials: [], result: 'done' }) };
  };
  await runCloser({ execImpl, prompt: 'do the thing' });
  const allowedToolsIndex = calledArgs.indexOf('--allowedTools');
  assert.match(calledArgs[allowedToolsIndex + 1], /mcp__linear__\*/);
  assert.match(calledArgs[allowedToolsIndex + 1], /mcp__claude_ai_Linear__\*/);
  assert.match(calledArgs[allowedToolsIndex + 1], /Bash\(orca \*\)/);
  assert.deepEqual(calledArgs.slice(-2), ['--output-format', 'json']);
});

test('runCloser throws when the closer\'s tool call was denied, even though claude -p itself exits 0', async () => {
  const execImpl = async () => ({
    stdout: JSON.stringify({ is_error: false, permission_denials: [{ tool_name: 'mcp__linear__save_comment' }], result: 'blocked' }),
  });
  await assert.rejects(() => runCloser({ execImpl, prompt: 'x' }), /closer step failed: blocked/);
});

test('main: sandbox probe and codex acceptance both pass -> the closer is invoked and its result returned', async () => {
  const closerCalls = [];
  const impls = {
    runCodexSandboxProbeImpl: async () => ({ publisherReadable: true, orcaReachable: true, raw: '{}' }),
    runCodexAcceptanceRunImpl: async () => ({ juliaRunExitCode: 0, shimInvoked: false, output: 'ok' }),
    runCloserImpl: async (prompt) => { closerCalls.push(prompt); return { result: 'posted' }; },
    makeShimImpl: () => ({ dir: '/tmp/shim', logPath: '/tmp/shim/claude-shim.log' }),
  };
  const result = await main(impls);
  assert.equal(closerCalls.length, 1);
  assert.equal(result.ranCloser, true);
});

test('main: a failing sandbox probe still runs the closer (which reports the failure), never silently exits without a Linear post', async () => {
  const closerCalls = [];
  const impls = {
    runCodexSandboxProbeImpl: async () => ({ publisherReadable: false, orcaReachable: true, raw: 'ERROR: usage limit' }),
    runCodexAcceptanceRunImpl: async () => ({ juliaRunExitCode: 0, shimInvoked: false, output: 'ok' }),
    runCloserImpl: async (prompt) => { closerCalls.push(prompt); return { result: 'posted the failure' }; },
    makeShimImpl: () => ({ dir: '/tmp/shim', logPath: '/tmp/shim/claude-shim.log' }),
  };
  const result = await main(impls);
  assert.equal(closerCalls.length, 1);
  assert.match(closerCalls[0], /publisherReadable.*false/s);
  assert.equal(result.ranCloser, true);
});
