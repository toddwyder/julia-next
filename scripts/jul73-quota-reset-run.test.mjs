import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSandboxProbeCommand, buildCodexAcceptanceCommand, buildCloserPrompt,
  runCodexSandboxProbe, findCoordinatorTerminal, waitForWakeAndWatchForClaude,
  checkForClaudeProcess, dispatchCodexAcceptanceRun, runCloser, main,
} from './jul73-quota-reset-run.mjs';

test('buildSandboxProbeCommand asks codex to run the probe script and relay raw output -- not a claimed sandbox bypass', () => {
  const command = buildSandboxProbeCommand();
  assert.match(command, /export ORCA_BIN=\/opt\/Orca\/orca-ide ORCA_ENVIRONMENT=ovh-local/);
  assert.match(command, /set -a; \. \/etc\/orchestrator-svc\/\.env\.publisher; set \+a/);
  assert.match(command, /codex exec -s danger-full-access/);
  assert.match(command, /node scripts\/jul73-codex-sandbox-probe\.mjs/);
  // No `--` execution form -- codex exec's only positional is a prompt.
  assert.doesNotMatch(command, /codex exec[^"]*-- /);
});

test('buildCodexAcceptanceCommand sets the codex vendor and targets JUL-76, with no PATH shim (a shim on this process cannot see the vendor terminal)', () => {
  const command = buildCodexAcceptanceCommand();
  assert.match(command, /export ORCHESTRATOR_VENDOR=codex/);
  assert.match(command, /node scripts\/julia-run\.mjs JUL-76/);
});

test('runCodexSandboxProbe dispatches, waits for the JSON result, and parses it', async () => {
  const calls = [];
  const terminalCreateImpl = async (args) => { calls.push(args); return { terminal: { handle: 'term_probe' } }; };
  const terminalReadImpl = async () => ({ terminal: { tail: ['some prompt$ ...', '{"publisherReadable":true,"orcaReachable":true}'] } });
  const result = await runCodexSandboxProbe({ terminalCreateImpl, terminalReadImpl, waitImpl: async () => {} });
  assert.equal(result.publisherReadable, true);
  assert.equal(result.orcaReachable, true);
  assert.equal(calls[0].environment, 'orchestrator-local');
});

test('runCodexSandboxProbe fails closed on no parseable JSON (e.g. codex itself walled, or it added commentary)', async () => {
  const terminalCreateImpl = async () => ({ terminal: { handle: 'term_probe' } });
  const terminalReadImpl = async () => ({ terminal: { tail: ['ERROR: usage limit'] } });
  const result = await runCodexSandboxProbe({ terminalCreateImpl, terminalReadImpl, waitImpl: async () => {}, maxPolls: 1 });
  assert.equal(result.publisherReadable, false);
  assert.equal(result.orcaReachable, false);
});

test('findCoordinatorTerminal picks the most recently active terminal titled julia-run-<issueId>', async () => {
  const execImpl = async () => ({
    stdout: JSON.stringify({
      result: {
        terminals: [
          { handle: 'term_old', title: 'julia-run-JUL-76', lastOutputAt: 100 },
          { handle: 'term_other', title: 'julia-run-JUL-44', lastOutputAt: 500 },
          { handle: 'term_new', title: 'julia-run-JUL-76', lastOutputAt: 300 },
        ],
      },
    }),
  });
  const found = await findCoordinatorTerminal({ issueId: 'JUL-76', execImpl });
  assert.equal(found.handle, 'term_new');
});

test('findCoordinatorTerminal returns null when the terminal has not appeared yet', async () => {
  const execImpl = async () => ({ stdout: JSON.stringify({ result: { terminals: [] } }) });
  const found = await findCoordinatorTerminal({ issueId: 'JUL-76', execImpl });
  assert.equal(found, null);
});

test('checkForClaudeProcess reports a real sighting', async () => {
  const execImpl = async (cmd, args) => {
    assert.equal(cmd, 'pgrep');
    assert.deepEqual(args, ['-u', 'orchestrator-svc', '-a', 'claude']);
    return { stdout: '12345 claude -p something\n' };
  };
  const sighting = await checkForClaudeProcess({ execImpl });
  assert.match(sighting, /claude -p something/);
});

test('checkForClaudeProcess treats pgrep\'s no-match exit as clean, not an error', async () => {
  const execImpl = async () => { const e = new Error('exit 1'); throw e; };
  const sighting = await checkForClaudeProcess({ execImpl });
  assert.equal(sighting, null);
});

test('waitForWakeAndWatchForClaude finishes once the coordinator terminal\'s shell prompt returns, and flags any claude sighting seen along the way', async () => {
  let reads = 0;
  const findCoordinatorTerminalImpl = async () => ({ handle: 'term_coord' });
  const terminalReadImpl = async () => {
    reads += 1;
    if (reads < 2) return { terminal: { tail: ['still running...'] } };
    return { terminal: { tail: ['...', 'orchestrator-svc@host:~$'] } };
  };
  let pgrepCalls = 0;
  const execImpl = async () => {
    pgrepCalls += 1;
    if (pgrepCalls === 1) return { stdout: '999 claude -p sneaky\n' };
    const e = new Error('no match'); throw e;
  };
  const result = await waitForWakeAndWatchForClaude({
    terminalReadImpl, execImpl, waitImpl: async () => {}, findCoordinatorTerminalImpl, maxPolls: 5,
  });
  assert.equal(result.finished, true);
  assert.equal(result.claudeSeen, true);
  assert.match(result.claudeSightings[0], /sneaky/);
});

test('waitForWakeAndWatchForClaude reports not-finished if the terminal never appears within the poll budget', async () => {
  const findCoordinatorTerminalImpl = async () => null;
  const execImpl = async () => { throw new Error('no match'); };
  const result = await waitForWakeAndWatchForClaude({
    terminalReadImpl: async () => ({ terminal: { tail: [] } }), execImpl, waitImpl: async () => {}, findCoordinatorTerminalImpl, maxPolls: 2,
  });
  assert.equal(result.finished, false);
  assert.equal(result.claudeSeen, false);
});

test('dispatchCodexAcceptanceRun dispatches into an isolated worktree and returns the terminal handle', async () => {
  const calls = [];
  const terminalCreateImpl = async (args) => { calls.push(args); return { terminal: { handle: 'term_dispatch' } }; };
  const handle = await dispatchCodexAcceptanceRun({ terminalCreateImpl });
  assert.equal(handle, 'term_dispatch');
  assert.equal(calls[0].environment, 'orchestrator-local');
  assert.match(calls[0].command, /ORCHESTRATOR_VENDOR=codex/);
});

test('buildCloserPrompt embeds the full mechanical evidence objects (not just booleans) and both branch instructions', () => {
  const prompt = buildCloserPrompt({
    sandboxProbe: { publisherReadable: true, orcaReachable: true, raw: '{}' },
    acceptanceRun: {
      finished: true, claudeSeen: false, claudeSightings: [], output: 'coordinator wake output here',
    },
    sinceIso: '2026-09-19T19:43:00.000Z',
  });
  assert.match(prompt, /"publisherReadable": true/);
  assert.match(prompt, /"finished": true/);
  assert.match(prompt, /"claudeSeen": false/);
  assert.match(prompt, /coordinator wake output here/);
  assert.match(prompt, /2026-09-19T19:43:00\.000Z/);
  assert.match(prompt, /JUL-76/);
  assert.match(prompt, /JUL-75/);
  assert.match(prompt, /JUL-73/);
  assert.match(prompt, /JUL-44/);
  assert.match(prompt, /No retry/i);
  assert.match(prompt, /SKILL\.md/);
});

test('runCloser passes maxBuffer and cwd, and checks for denial the way defaultPostCommentImpl did', async () => {
  let calledArgs;
  let calledOpts;
  const execImpl = async (cmd, args, opts) => {
    calledArgs = args;
    calledOpts = opts;
    return { stdout: JSON.stringify({ is_error: false, permission_denials: [], result: 'done' }) };
  };
  await runCloser({ execImpl, prompt: 'do the thing' });
  const allowedToolsIndex = calledArgs.indexOf('--allowedTools');
  assert.match(calledArgs[allowedToolsIndex + 1], /mcp__linear__\*/);
  assert.match(calledArgs[allowedToolsIndex + 1], /Bash\(orca \*\)/);
  assert.equal(calledOpts.maxBuffer, 10 * 1024 * 1024);
  assert.ok(calledOpts.cwd);
});

test('runCloser throws when the closer\'s tool call was denied, even though claude -p itself exits 0', async () => {
  const execImpl = async () => ({
    stdout: JSON.stringify({ is_error: false, permission_denials: [{ tool_name: 'mcp__linear__save_comment' }], result: 'blocked' }),
  });
  await assert.rejects(() => runCloser({ execImpl, prompt: 'x' }), /closer step failed: blocked/);
});

test('main: everything gathered successfully -> the closer is invoked with real evidence', async () => {
  const closerCalls = [];
  const result = await main({
    terminalCreateImpl: async () => ({ terminal: { handle: 'term_x' } }),
    terminalReadImpl: async () => ({ terminal: { tail: ['{"publisherReadable":true,"orcaReachable":true}'] } }),
    execImpl: async () => { throw new Error('no claude process'); },
    waitImpl: async () => {},
    runCloserImpl: async (prompt) => { closerCalls.push(prompt); return { result: 'posted' }; },
    prepareServerEnvironmentImpl: () => {},
  });
  assert.equal(closerCalls.length, 1);
  assert.equal(result.ranCloser, true);
});

test('main: a step that throws still reaches the closer, with the error folded into the evidence rather than aborting', async () => {
  const closerCalls = [];
  const result = await main({
    terminalCreateImpl: async () => { throw new Error('Orca daemon unreachable'); },
    terminalReadImpl: async () => ({ terminal: { tail: [] } }),
    execImpl: async () => { throw new Error('no claude process'); },
    waitImpl: async () => {},
    runCloserImpl: async (prompt) => { closerCalls.push(prompt); return { result: 'posted the failure' }; },
    prepareServerEnvironmentImpl: () => {},
  });
  assert.equal(closerCalls.length, 1);
  assert.match(closerCalls[0], /Orca daemon unreachable/);
  assert.equal(result.ranCloser, true);
});

test('main calls prepareServerEnvironment before anything else, so the process has ORCA_BIN/publisher creds (review finding #1)', async () => {
  let prepared = false;
  await main({
    terminalCreateImpl: async () => { assert.equal(prepared, true, 'env must be prepared before dispatch'); return { terminal: { handle: 'x' } }; },
    terminalReadImpl: async () => ({ terminal: { tail: ['{"publisherReadable":true,"orcaReachable":true}'] } }),
    execImpl: async () => { throw new Error('no claude process'); },
    waitImpl: async () => {},
    runCloserImpl: async () => ({ result: 'ok' }),
    prepareServerEnvironmentImpl: () => { prepared = true; },
  });
});
