import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createExplorationGate } from './exploration.mjs';

const FULL = 'Graph: graphify-out/graph.json (12 nodes) | 2 nodes found\nNODE example\nEDGE example --calls--> next';
const PARTIAL = '[!] TRUNCATED: showing 2 of 12 nodes (~100-token budget). Raise --budget or narrow the query.\n' + FULL;
const shell = command => ({ toolName: 'mastra_workspace_execute_command', input: { command } });
const query = shell('graphify query "Where is the runner?"');
const read = path => ({ toolName: 'mastra_workspace_read_file', input: { path } });
const grep = { toolName: 'mastra_workspace_grep', input: { pattern: 'runner', path: '.' } };

function fixture(t, options = {}) {
  const parent = join(homedir(), '.local/state/julia-scratch');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'exploration-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'graphify-out'));
  writeFileSync(join(root, 'graphify-out/graph.json'), JSON.stringify({ nodes: [{ id: 'runner' }], links: [] }));
  return { root, ...createExplorationGate({ root, ...options }) };
}

function answer(gate, text = FULL, call = query) {
  assert.equal(gate.hooks.beforeToolCall(call), undefined);
  gate.hooks.afterToolCall({ ...call, output: text });
}

for (const call of [
  grep,
  { toolName: 'mastra_workspace_list_files', input: { path: '.', pattern: '**/*.mjs' } },
  read('machine/flow/agents.mjs'),
  ...['grep runner machine/flow', 'rg runner .', 'find . -name "*.mjs"', 'git grep runner',
    '/usr/bin/grep runner src', 'env FOO=bar rg runner .', 'sudo -n rg runner .',
    'bash -lc "rg runner machine/flow"', "sh -c 'find . -name *.mjs'",
    'node -e "require(\'child_process\').execSync(\'rg runner .\')"',
    'cat machine/flow/agents.mjs', 'ls src/*.mjs', 'echo src/**/*.mjs',
    'npm test; rg runner src', 'graphify query "runner"; rg runner src',
  ].map(shell),
]) {
  test(`first exploration refused once: ${call.input.command ?? call.toolName}`, t => {
    const gate = fixture(t);
    const denied = gate.hooks.beforeToolCall(call);
    assert.equal(denied?.proceed, false);
    assert.match(denied.output, /graphify query/);
    assert.deepEqual(Object.keys(denied).sort(), ['output', 'proceed']);
    assert.equal(gate.hooks.beforeToolCall(call), undefined);
    assert.equal(gate.snapshot().refusedCalls, 1);
    assert.equal(gate.snapshot().nudges.length, 1);
  });
}

for (const graph of [null, '{broken', '{"nodes":[]}', '{}', '{"nodes":"fake"}']) {
  test(`no usable graph means no exploration refusal: ${graph}`, t => {
    const gate = fixture(t);
    const path = join(gate.root, 'graphify-out/graph.json');
    if (graph === null) rmSync(path); else writeFileSync(path, graph);
    assert.equal(gate.hooks.beforeToolCall(grep), undefined);
    assert.equal(gate.snapshot().refusedCalls, 0);
  });
}

for (const command of ['npm test', 'node --test machine/flow/exploration.test.mjs',
  'npm run build', "sed -i 's/old/new/' src/example.mjs", 'git diff --check',
  'graphify --help', 'graphify explain "runner"', 'graphify affected "runner"',
]) {
  test(`leaves non-exploration alone: ${command}`, t => {
    const gate = fixture(t);
    assert.equal(gate.hooks.beforeToolCall(shell(command)), undefined);
    assert.equal(gate.snapshot().refusedCalls, 0);
  });
}

test('graph answer first permits targeted verification and sends nudges', t => {
  const nudges = [];
  const gate = fixture(t, { onNudge: message => nudges.push(message) });
  answer(gate);
  assert.equal(gate.hooks.beforeToolCall(read('machine/flow/agents.mjs')), undefined);
  assert.equal(gate.hooks.beforeToolCall(grep), undefined);
  assert.equal(gate.hooks.beforeToolCall(shell('npm test')), undefined);
  assert.equal(gate.snapshot().graphQueries, 1);
  assert.equal(gate.snapshot().allowedReads, 1);
  assert.equal(gate.snapshot().allowedSearches, 1);
  assert.equal(gate.snapshot().refusedCalls, 0);
  assert.equal(nudges.length, 2);
});

test('partial answer latches all other actions until a full retry', t => {
  const gate = fixture(t);
  answer(gate, PARTIAL);
  for (const call of [grep, read('src/example.mjs'), shell('npm test'),
    { toolName: 'write_file', input: { path: 'example', content: 'x' } },
  ]) assert.equal(gate.hooks.beforeToolCall(call)?.proceed, false);
  answer(gate, PARTIAL, shell('graphify query "runner narrower" --budget 200'));
  assert.equal(gate.snapshot().resolutions, 0);
  answer(gate, FULL, shell('graphify query "runner narrower" --budget 6000'));
  assert.equal(gate.hooks.beforeToolCall(shell('npm test')), undefined);
  assert.equal(gate.snapshot().graphQueries, 3);
  assert.equal(gate.snapshot().graphRetries, 2);
  assert.equal(gate.snapshot().truncatedAnswers, 2);
  assert.equal(gate.snapshot().resolutions, 1);
  assert.equal(gate.snapshot().refusedCalls, 4);
  assert.equal(gate.snapshot().awaitingAnswer, false);
});

test('complete over-budget answer is not mistaken for truncation', t => {
  const gate = fixture(t);
  answer(gate, '[i] Complete answer over budget: all 12 nodes and 10 edges shown.\n' + FULL);
  assert.equal(gate.snapshot().truncatedAnswers, 0);
  assert.equal(gate.snapshot().answered, true);
});

test('shell transport truncation and metadata latch the gate', t => {
  const gate = fixture(t);
  answer(gate, '[output truncated — showing first 200 lines]\n' + FULL);
  assert.equal(gate.snapshot().truncated, true);
  gate.hooks.afterToolCall({ ...query, output: { stdout: FULL, truncated: true } });
  assert.equal(gate.snapshot().truncatedAnswers, 2);
});

test('failed, empty and unrecognized graph results cannot resolve a latch', t => {
  const gate = fixture(t);
  answer(gate, PARTIAL);
  for (const output of ['', 'No result', { stdout: FULL, exitCode: 1 }]) {
    answer(gate, output);
    assert.equal(gate.snapshot().awaitingAnswer, true);
  }
  gate.hooks.afterToolCall({ ...query, output: FULL, error: new Error('failed') });
  assert.equal(gate.snapshot().awaitingAnswer, true);
  answer(gate);
  assert.equal(gate.snapshot().resolutions, 1);
});

test('reading a graph output is allowed and can resolve a redirected answer', t => {
  const gate = fixture(t);
  const redirected = shell('graphify query "runner" > answer.txt');
  answer(gate, '', redirected);
  const outputRead = read('answer.txt');
  assert.equal(gate.hooks.beforeToolCall(outputRead), undefined);
  gate.hooks.afterToolCall({ ...outputRead, output: PARTIAL });
  assert.equal(gate.hooks.beforeToolCall(shell('npm test'))?.proceed, false);
  answer(gate, '', shell('graphify query "runner narrowed" --budget 6000 > answer.txt'));
  assert.equal(gate.hooks.beforeToolCall(outputRead), undefined);
  gate.hooks.afterToolCall({ ...outputRead, output: FULL });
  assert.equal(gate.snapshot().resolutions, 1);
});

test('reading graph output cannot smuggle other commands through a pending latch', t => {
  const gate = fixture(t);
  answer(gate, PARTIAL);
  for (const command of [
    'cat graphify-out/graph.json; npm test',
    'cat graphify-out/graph.json > src/example.mjs',
    'npm test; bash -lc \'graphify query "runner"\'',
    'graphify query "runner"; npm test',
  ]) assert.equal(gate.hooks.beforeToolCall(shell(command))?.proceed, false);
  assert.equal(gate.hooks.beforeToolCall(shell('cat graphify-out/graph.json')), undefined);
  assert.equal(gate.hooks.beforeToolCall(shell('bash -lc \'graphify query "runner"\'')), undefined);
});

test('graph files do not consume the first-exploration refusal', t => {
  const gate = fixture(t);
  assert.equal(gate.hooks.beforeToolCall(read('graphify-out/graph.json')), undefined);
  assert.equal(gate.hooks.beforeToolCall(grep)?.proceed, false);
});

test('shared hooks share a session; new gates start fresh; snapshots are copies', t => {
  const gate = fixture(t);
  const leadHooks = gate.hooks;
  const helperHooks = gate.hooks;
  assert.equal(leadHooks.beforeToolCall(grep)?.proceed, false);
  assert.equal(helperHooks.beforeToolCall(grep), undefined);
  const snapshot = gate.snapshot();
  snapshot.nudges.length = 0;
  snapshot.refusedCalls = 100;
  assert.equal(gate.snapshot().nudges.length, 1);
  assert.equal(gate.snapshot().refusedCalls, 1);
  const fresh = createExplorationGate({ root: gate.root });
  assert.equal(fresh.hooks.beforeToolCall(grep)?.proceed, false);
  assert.match(fresh.snapshot().shellInspectionLimit, /does not resolve aliases/);
});

for (const command of ['env -u X grep foo x', 'echo done\ngrep foo x',
  '/usr/bin/env --unset X /usr/bin/rg x .', 'timeout 3s env -u X grep x .',
  'bash -lc "env -u X grep x ."', 'sudo -u ubuntu grep x .', 'exec -a name rg x .', 'timeout -s TERM 2s grep x .', 'nice -n 5 rg x .' ]) {
  test('literal launcher/newline cannot hide exploration: ' + command, t => {
    const gate = fixture(t);
    assert.equal(gate.hooks.beforeToolCall(shell(command))?.proceed, false);
    assert.equal(typeof gate.hooks.beforeToolCall(read('x')), 'undefined');
  });
}

for (const nodes of [[null], [{}], [{ id: '' }], [{ id: 'x' }, { id: 'x' }]]) {
  test('malformed nodes do not activate the gate: ' + JSON.stringify(nodes), t => {
    const gate = fixture(t);
    writeFileSync(join(gate.root, 'graphify-out/graph.json'), JSON.stringify({ nodes, links: [] }));
    assert.equal(gate.hooks.beforeToolCall(grep), undefined);
  });
}

test('excessive nested shells and unsupported env splitting fail closed', t => {
  const gate = fixture(t);
  let command = 'grep runner .';
  for (let depth = 0; depth < 7; depth += 1) command = 'bash -c ' + JSON.stringify(command);
  for (const text of [command, 'env -S "grep runner ."']) {
    assert.equal(gate.hooks.beforeToolCall(shell(text))?.proceed, false);
    assert.equal(gate.hooks.beforeToolCall(shell(text))?.proceed, false);
  }
});

test('Mastra tail truncation and string failure cannot unlock partial answers', t => {
  const gate = fixture(t);
  answer(gate, '[showing last 200 of 300 lines]\n' + FULL);
  assert.equal(gate.snapshot().awaitingAnswer, true);
  answer(gate, FULL + '\nExit code: 1');
  assert.equal(gate.snapshot().awaitingAnswer, true);
  answer(gate, FULL + '\nExit code: -1');
  assert.equal(gate.snapshot().awaitingAnswer, true);
  answer(gate, FULL + '\nExit code: 0');
  assert.equal(gate.snapshot().awaitingAnswer, false);
});

test('every truncation retains the complete-answer remedy in persisted snapshots', t => {
  const updates = [];
  const gate = fixture(t, { onUpdate: snapshot => updates.push(snapshot) });
  answer(gate, PARTIAL);
  answer(gate, PARTIAL, shell('graphify query "narrower" --budget 200'));
  const pending = gate.snapshot();
  assert.equal(pending.truncations.filter(item => !item.resolved).length, 2);
  answer(gate, FULL, shell('graphify query "narrower" --budget 6000'));
  assert.equal(gate.snapshot().truncations.every(item => item.resolved && item.resolvedBy.includes('--budget 6000')), true);
  assert.equal(pending.truncations.every(item => !item.resolved), true);
  assert.equal(updates.at(-1).truncations.every(item => item.resolved), true);
  gate.snapshot().truncations[0].resolved = false;
  assert.equal(gate.snapshot().truncations[0].resolved, true);
});

test('native workspace tools all receive schema-valid string refusals', t => {
  for (const call of [grep, read('src/x'), shell('grep x .'), { toolName: 'mastra_workspace_list_files', input: { path: '.' } }]) {
    const gate = fixture(t);
    const result = gate.hooks.beforeToolCall(call);
    assert.equal(result.proceed, false);
    assert.equal(typeof result.output, 'string');
    assert.match(result.output, /graphify query/);
  }
});

for (const toolName of ['julia_query_graph', 'mastra_query_graph']) {
  test(`native MCP graph results are counted and complete: ${toolName}`, t => {
    const gate = fixture(t);
    const call = { toolName, input: { question: 'Where is the runner?' } };
    assert.equal(gate.hooks.beforeToolCall(call), undefined);
    gate.hooks.afterToolCall({ ...call, output: { content: [{ type: 'text', text: FULL }] } });
    assert.equal(gate.snapshot().graphQueries, 1);
    assert.equal(gate.snapshot().awaitingAnswer, false);
  });
}

test('native MCP partial answers block actions until a complete answer arrives', t => {
  const gate = fixture(t);
  const call = { toolName: 'julia_query_graph', input: { question: 'Where is the runner?' } };
  gate.hooks.beforeToolCall(call);
  gate.hooks.afterToolCall({ ...call, output: { content: [{ type: 'text', text: PARTIAL }] } });
  assert.equal(gate.snapshot().awaitingAnswer, true);
  assert.equal(gate.hooks.beforeToolCall(shell('npm test')).proceed, false);
  gate.hooks.beforeToolCall(call);
  gate.hooks.afterToolCall({ ...call, output: { content: [{ type: 'text', text: FULL }] } });
  assert.equal(gate.snapshot().awaitingAnswer, false);
  assert.equal(gate.snapshot().resolutions, 1);
});

test('native MCP errors cannot clear the incomplete-answer latch', t => {
  const gate = fixture(t);
  const call = { toolName: 'mastra_query_graph', input: { question: 'Where is the runner?' } };
  gate.hooks.beforeToolCall(call);
  gate.hooks.afterToolCall({ ...call, output: { isError: true, content: [{ type: 'text', text: FULL }] } });
  assert.equal(gate.snapshot().awaitingAnswer, true);
});
