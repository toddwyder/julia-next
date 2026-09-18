import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSandboxProbeCommand, buildCodexAcceptanceCommand, buildCloserPrompt,
  runCodexSandboxProbe, dispatchCodexAcceptanceRun, findFreshRun,
  checkForClaudeProcess, waitForWakeAndWatchForClaude, runCloser, main,
} from './jul73-quota-reset-run.mjs';

test('buildSandboxProbeCommand asks codex to run the probe script and relay raw output -- not a claimed sandbox bypass', () => {
  const command = buildSandboxProbeCommand();
  assert.match(command, /export ORCA_BIN=\/opt\/Orca\/orca-ide ORCA_ENVIRONMENT=ovh-local/);
  assert.match(command, /set -a; \. \/etc\/orchestrator-svc\/\.env\.publisher; set \+a/);
  assert.match(command, /codex exec -s danger-full-access/);
  assert.match(command, /node scripts\/jul73-codex-sandbox-probe\.mjs/);
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

test('dispatchCodexAcceptanceRun waits for its own dispatch terminal to finish and reports the dispatch output', async () => {
  let reads = 0;
  const terminalCreateImpl = async () => ({ terminal: { handle: 'term_dispatch' } });
  const terminalReadImpl = async () => {
    reads += 1;
    if (reads < 2) return { terminal: { tail: ['still starting...'] } };
    return { terminal: { tail: ['still starting...', 'run_abc123', 'orchestrator-svc@host:~$'] } };
  };
  const result = await dispatchCodexAcceptanceRun({ terminalCreateImpl, terminalReadImpl, waitImpl: async () => {}, maxPolls: 5 });
  assert.equal(result.dispatchFinished, true);
  assert.match(result.dispatchOutput, /run_abc123/);
  assert.equal(result.dispatchTerminalHandle, 'term_dispatch');
});

test('dispatchCodexAcceptanceRun reports not-finished (never a crash) if the dispatch never returns within budget', async () => {
  const terminalCreateImpl = async () => ({ terminal: { handle: 'term_dispatch' } });
  const terminalReadImpl = async () => ({ terminal: { tail: ['still starting...'] } });
  const result = await dispatchCodexAcceptanceRun({ terminalCreateImpl, terminalReadImpl, waitImpl: async () => {}, maxPolls: 2 });
  assert.equal(result.dispatchFinished, false);
});

test('findFreshRun matches by exact issue id and only accepts a run created at or after sinceIso -- a stale run from an earlier attempt at the same issue must not be picked up', async () => {
  const runListImpl = async () => ({
    runs: [
      { id: 'run_stale', objective: 'JUL-76', coordinator_handle: 'term_stale', created_at: '2026-09-18T00:00:00Z' },
      { id: 'run_fresh', objective: 'JUL-76', coordinator_handle: 'term_fresh', created_at: '2026-09-19T19:44:00Z' },
      { id: 'run_other', objective: 'JUL-44', coordinator_handle: 'term_other', created_at: '2026-09-19T19:44:00Z' },
    ],
  });
  const found = await findFreshRun({ issueId: 'JUL-76', sinceIso: '2026-09-19T19:43:00Z', runListImpl });
  assert.equal(found.id, 'run_fresh');
});

test('findFreshRun keeps polling until a fresh run appears, then stops', async () => {
  let calls = 0;
  const runListImpl = async () => {
    calls += 1;
    if (calls < 3) return { runs: [] };
    return { runs: [{ id: 'run_fresh', objective: 'JUL-76', coordinator_handle: 'term_fresh', created_at: '2026-09-19T19:50:00Z' }] };
  };
  const found = await findFreshRun({
    issueId: 'JUL-76', sinceIso: '2026-09-19T19:43:00Z', runListImpl, waitImpl: async () => {}, maxPolls: 5,
  });
  assert.equal(found.id, 'run_fresh');
  assert.equal(calls, 3);
});

test('findFreshRun returns null (not a crash) if nothing fresh ever appears', async () => {
  const runListImpl = async () => ({ runs: [] });
  const found = await findFreshRun({
    issueId: 'JUL-76', sinceIso: '2026-09-19T19:43:00Z', runListImpl, waitImpl: async () => {}, maxPolls: 2,
  });
  assert.equal(found, null);
});

test('checkForClaudeProcess reports a real sighting', async () => {
  const execImpl = async (cmd, args) => {
    assert.equal(cmd, 'pgrep');
    assert.deepEqual(args, ['-u', 'orchestrator-svc', '-a', 'claude']);
    return { stdout: '12345 claude -p something\n' };
  };
  const { sighting, checkError } = await checkForClaudeProcess({ execImpl });
  assert.match(sighting, /claude -p something/);
  assert.equal(checkError, null);
});

test('checkForClaudeProcess treats pgrep exit 1 (no match) as clean, not an error', async () => {
  const execImpl = async () => { const e = new Error('exit 1'); e.code = 1; throw e; };
  const { sighting, checkError } = await checkForClaudeProcess({ execImpl });
  assert.equal(sighting, null);
  assert.equal(checkError, null);
});

test('checkForClaudeProcess surfaces any OTHER pgrep failure as evidence, never silently reading it as "no claude" (review finding: this failure class must not support a PASS)', async () => {
  const execImpl = async () => { const e = new Error('pgrep: command not found'); e.code = 127; throw e; };
  const { sighting, checkError } = await checkForClaudeProcess({ execImpl });
  assert.equal(sighting, null);
  assert.match(checkError, /pgrep failed unexpectedly/);
});

test('waitForWakeAndWatchForClaude finishes once the coordinator terminal\'s shell prompt returns, and flags any claude sighting seen along the way', async () => {
  let reads = 0;
  const terminalReadImpl = async () => {
    reads += 1;
    if (reads < 2) return { terminal: { tail: ['still running...'] } };
    return { terminal: { tail: ['still running...', 'orchestrator-svc@host:~$'] } };
  };
  let pgrepCalls = 0;
  const execImpl = async () => {
    pgrepCalls += 1;
    if (pgrepCalls === 1) return { stdout: '999 claude -p sneaky\n' };
    const e = new Error('no match'); e.code = 1; throw e;
  };
  const result = await waitForWakeAndWatchForClaude({
    coordinatorHandle: 'term_coord', terminalReadImpl, execImpl, waitImpl: async () => {}, maxPolls: 5,
  });
  assert.equal(result.finished, true);
  assert.equal(result.claudeSeen, true);
  assert.match(result.claudeSightings[0], /sneaky/);
  assert.deepEqual(result.checkErrors, []);
});

test('waitForWakeAndWatchForClaude reports not-finished if the terminal never returns to its prompt within budget', async () => {
  const execImpl = async () => { const e = new Error('no match'); e.code = 1; throw e; };
  const result = await waitForWakeAndWatchForClaude({
    coordinatorHandle: 'term_coord', terminalReadImpl: async () => ({ terminal: { tail: ['still going'] } }), execImpl, waitImpl: async () => {}, maxPolls: 2,
  });
  assert.equal(result.finished, false);
  assert.equal(result.claudeSeen, false);
});

test('buildCloserPrompt embeds the full mechanical evidence objects (not just booleans) and both branch instructions', () => {
  const prompt = buildCloserPrompt({
    sandboxProbe: { publisherReadable: true, orcaReachable: true, raw: '{}' },
    acceptanceRun: {
      finished: true, claudeSeen: false, claudeSightings: [], checkErrors: [], output: 'coordinator wake output here', runId: 'run_abc',
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
  assert.match(prompt, /\/opt\/Orca\/orca-ide/);
});

test('runCloser resolves claude through a login shell (bash -lc), passing every claude argument through argv, not string interpolation', async () => {
  let calledCmd;
  let calledArgs;
  let calledOpts;
  const execImpl = async (cmd, args, opts) => {
    calledCmd = cmd;
    calledArgs = args;
    calledOpts = opts;
    return { stdout: JSON.stringify({ is_error: false, permission_denials: [], result: 'done' }) };
  };
  await runCloser({ execImpl, prompt: 'do the "tricky" thing\nwith a newline' });
  assert.equal(calledCmd, 'bash');
  assert.equal(calledArgs[0], '-lc');
  assert.match(calledArgs[1], /exec claude/);
  assert.equal(calledArgs[2], '--');
  const promptIndex = calledArgs.indexOf('-p');
  assert.equal(calledArgs[promptIndex + 1], 'do the "tricky" thing\nwith a newline');
  const allowedToolsIndex = calledArgs.indexOf('--allowedTools');
  assert.match(calledArgs[allowedToolsIndex + 1], /mcp__linear__\*/);
  assert.match(calledArgs[allowedToolsIndex + 1], /Bash\(\/opt\/Orca\/orca-ide terminal create \*\)/);
  assert.equal(calledOpts.maxBuffer, 10 * 1024 * 1024);
  assert.ok(calledOpts.cwd);
});

test('the JUL-44 launch command in the closer prompt is covered by the closer\'s own --allowedTools grant -- built from one shared prefix so they cannot drift apart (review finding: an export-prefixed command silently failed to match its own grant)', async () => {
  const prompt = buildCloserPrompt({
    sandboxProbe: { publisherReadable: true, orcaReachable: true },
    acceptanceRun: { finished: true, claudeSeen: false, checkErrors: [] },
    sinceIso: '2026-09-19T19:43:00.000Z',
  });
  const commandMatch = prompt.match(/launch the real next work by running exactly this command, verbatim, with no modification \(it is pre-authorized exactly as written\): `([^`]+)`/);
  assert.ok(commandMatch, 'expected to find the JUL-44 launch command embedded in the prompt');
  const launchCommand = commandMatch[1];

  let calledArgs;
  const execImpl = async (cmd, args) => { calledArgs = args; return { stdout: JSON.stringify({ is_error: false, permission_denials: [], result: 'ok' }) }; };
  await runCloser({ execImpl, prompt: 'x' });
  const grant = calledArgs[calledArgs.indexOf('--allowedTools') + 1];
  const grantPrefix = grant.match(/Bash\(([^)]+) \*\)/)[1];
  assert.ok(launchCommand.startsWith(grantPrefix), `launch command "${launchCommand}" must start with the grant prefix "${grantPrefix}"`);
});

test('runCloser parses the last JSON-looking line, tolerating a login shell\'s own banner/motd output before it', async () => {
  const execImpl = async () => ({ stdout: 'Welcome to Ubuntu\nsome motd line\n{"is_error":false,"permission_denials":[],"result":"posted"}\n' });
  const result = await runCloser({ execImpl, prompt: 'x' });
  assert.equal(result.result, 'posted');
});

test('runCloser throws a clear error, not a raw JSON.parse crash, when stdout has no parseable JSON at all', async () => {
  const execImpl = async () => ({ stdout: 'claude: command not found\n' });
  await assert.rejects(() => runCloser({ execImpl, prompt: 'x' }), /closer step produced no parseable JSON output/);
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
    terminalReadImpl: async () => ({ terminal: { tail: [] } }),
    waitImpl: async () => {},
    runCloserImpl: async (prompt) => { closerCalls.push(prompt); return { result: 'posted' }; },
    prepareServerEnvironmentImpl: () => {},
    runCodexSandboxProbeImpl: async () => ({ publisherReadable: true, orcaReachable: true, raw: '{}' }),
    gatherAcceptanceRunImpl: async () => ({
      runId: 'run_x', finished: true, claudeSeen: false, claudeSightings: [], checkErrors: [], output: 'ok',
    }),
  });
  assert.equal(closerCalls.length, 1);
  assert.equal(result.ranCloser, true);
});

test('main: a step that throws still reaches the closer, with the error folded into the evidence rather than aborting', async () => {
  const closerCalls = [];
  const result = await main({
    terminalCreateImpl: async () => { throw new Error('Orca daemon unreachable'); },
    terminalReadImpl: async () => ({ terminal: { tail: [] } }),
    waitImpl: async () => {},
    runCloserImpl: async (prompt) => { closerCalls.push(prompt); return { result: 'posted the failure' }; },
    prepareServerEnvironmentImpl: () => {},
  });
  assert.equal(closerCalls.length, 1);
  assert.match(closerCalls[0], /Orca daemon unreachable/);
  assert.equal(result.ranCloser, true);
});

test('main: even a failing prepareServerEnvironment still reaches the closer, with the error as evidence, rather than crashing before Linear is ever reached', async () => {
  const closerCalls = [];
  const result = await main({
    terminalCreateImpl: async () => ({ terminal: { handle: 'x' } }),
    terminalReadImpl: async () => ({ terminal: { tail: [] } }),
    waitImpl: async () => {},
    runCloserImpl: async (prompt) => { closerCalls.push(prompt); return { result: 'ok' }; },
    prepareServerEnvironmentImpl: () => { throw new Error('cannot load publisher env file'); },
  });
  assert.equal(closerCalls.length, 1);
  assert.match(closerCalls[0], /cannot load publisher env file/);
  assert.equal(result.ranCloser, true);
});

test('main calls prepareServerEnvironment before anything else, so the process has ORCA_BIN/publisher creds', async () => {
  let prepared = false;
  await main({
    terminalCreateImpl: async () => { assert.equal(prepared, true, 'env must be prepared before dispatch'); return { terminal: { handle: 'x' } }; },
    terminalReadImpl: async () => ({ terminal: { tail: [] } }),
    waitImpl: async () => {},
    runCloserImpl: async () => ({ result: 'ok' }),
    prepareServerEnvironmentImpl: () => { prepared = true; },
  });
});
