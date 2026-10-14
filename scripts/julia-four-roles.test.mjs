import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runInit } from './julia-init.mjs';

function cardFixture(id = 'JUL-200', {
  state = { name: 'Ready', type: 'unstarted' },
  acceptanceCriteria = '- [ ] criteria 1\n- [ ] criteria 2',
  testSeams = '- seam 1: auth seam\n- seam 2: runner seam',
} = {}) {
  return {
    identifier: id,
    title: `Card ${id} title`,
    state,
    acceptanceCriteria,
    testSeams,
    description: `## Acceptance criteria\n${acceptanceCriteria}\n\n## Test seams\n${testSeams}`,
  };
}

test('Criterion 6: Builder and reviewer are always from different companies; override allows same service, never same company', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'jul225-c6-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const stateDirectory = join(dir, 'runs');

  const inventory = [
    // Anthropic models on two different services
    { id: 'claude-sonnet-acp', name: 'Claude Sonnet', route: 'acp', service: 'ClaudeCode', maker: 'Anthropic', connectionId: 'claude-acp', thinking: { supported: ['low', 'high'], default: 'high' } },
    { id: 'claude-sonnet-cmd', name: 'Claude Sonnet via CommandCode', route: 'api', service: 'CommandCode', maker: 'Anthropic', connectionId: 'cmd-api', thinking: { supported: false, default: null } },
    // DeepSeek model on CommandCode
    { id: 'deepseek-flash-cmd', name: 'DeepSeek Flash', route: 'api', service: 'CommandCode', maker: 'DeepSeek', connectionId: 'cmd-api', thinking: { supported: false, default: null } },
    // Google Gemini on Antigravity
    { id: 'gemini-flash-agy', name: 'Gemini Flash', route: 'acp', service: 'Antigravity', maker: 'Google', connectionId: 'agy-acp', thinking: { supported: ['medium'], default: 'medium' } },
  ];

  // 1. Same company (Anthropic + Anthropic) across different services without override: REFUSED
  await assert.rejects(
    runInit('$init JUL-201 --builder claude-sonnet-acp high --reviewer claude-sonnet-cmd none', {
      stateDirectory, inventory, card: cardFixture('JUL-201'), decision: 'Start',
    }),
    /from the same company/,
  );

  // 2. Same company (Anthropic + Anthropic) WITH --allow-same-service override: STILL REFUSED!
  // Todd's governing rule: override allows them to share a service; it NEVER allows the same company.
  await assert.rejects(
    runInit('$init JUL-202 --builder claude-sonnet-acp high --reviewer claude-sonnet-cmd none --allow-same-service', {
      stateDirectory, inventory, card: cardFixture('JUL-202'), decision: 'Start',
    }),
    /from the same company/,
  );

  // 3. Different company but same service (Anthropic + DeepSeek on CommandCode) WITHOUT override: REFUSED
  await assert.rejects(
    runInit('$init JUL-203 --builder claude-sonnet-cmd none --reviewer deepseek-flash-cmd none', {
      stateDirectory, inventory, card: cardFixture('JUL-203'), decision: 'Start',
    }),
    /from the same service; using the same service requires an explicit per-run decision \(--allow-same-service\)/,
  );

  // 4. Different company AND same service WITH --allow-same-service override: ACCEPTED!
  const resSameServiceAllowed = await runInit('$init JUL-204 --builder claude-sonnet-cmd none --reviewer deepseek-flash-cmd none --allow-same-service --decision Start', {
    stateDirectory, inventory, card: cardFixture('JUL-204'),
  });
  assert.equal(resSameServiceAllowed.issueId, 'JUL-204');
  assert.equal(resSameServiceAllowed.configuration.builder.maker, 'Anthropic');
  assert.equal(resSameServiceAllowed.configuration.reviewer.maker, 'DeepSeek');
  assert.equal(resSameServiceAllowed.configuration.builder.service, 'CommandCode');
  assert.equal(resSameServiceAllowed.configuration.reviewer.service, 'CommandCode');

  // 5. Different company and different service (Anthropic via ACP + DeepSeek via CommandCode API): ACCEPTED without override
  const resNormal = await runInit('$init JUL-205 --builder claude-sonnet-acp high --reviewer deepseek-flash-cmd none --decision Start', {
    stateDirectory, inventory, card: cardFixture('JUL-205'),
  });
  assert.equal(resNormal.issueId, 'JUL-205');
  assert.equal(resNormal.configuration.builder.maker, 'Anthropic');
  assert.equal(resNormal.configuration.reviewer.maker, 'DeepSeek');
});

test('Criterion 7: Crash-fixer and fix reviewer must be from different companies', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'jul225-c7-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const stateDirectory = join(dir, 'runs');

  const inventory = [
    { id: 'codex', name: 'OpenAI Codex', route: 'acp', service: 'Codex', maker: 'OpenAI', connectionId: 'codex-acp', thinking: { supported: ['high'], default: 'high' } },
    { id: 'gpt-4o', name: 'OpenAI GPT-4o', route: 'api', service: 'OpenAI-API', maker: 'OpenAI', connectionId: 'openai-api', thinking: { supported: false, default: null } },
    { id: 'deepseek', name: 'DeepSeek Chat', route: 'api', service: 'CommandCode', maker: 'DeepSeek', connectionId: 'cmd-api', thinking: { supported: false, default: null } },
    { id: 'gemini', name: 'Google Gemini', route: 'acp', service: 'Antigravity', maker: 'Google', connectionId: 'agy-acp', thinking: { supported: ['medium'], default: 'medium' } },
  ];

  // 1. Crash-fixer and fix reviewer from same company (OpenAI Codex + OpenAI GPT-4o): REFUSED
  await assert.rejects(
    runInit('$init JUL-210 --builder gemini medium --reviewer deepseek none --crash-fixer codex high --fix-reviewer gpt-4o none', {
      stateDirectory, inventory, card: cardFixture('JUL-210'), decision: 'Start',
    }),
    /crash-fixer \(OpenAI\) and fix reviewer \(OpenAI\) must be from different companies/,
  );

  // 2. Crash-fixer and fix reviewer from different companies (OpenAI Codex + Google Gemini): ACCEPTED
  const res = await runInit('$init JUL-211 --builder deepseek none --reviewer codex high --crash-fixer codex high --fix-reviewer gemini medium --decision Start', {
    stateDirectory, inventory, card: cardFixture('JUL-211'),
  });
  assert.equal(res.issueId, 'JUL-211');
  assert.equal(res.configuration.crashFixer.maker, 'OpenAI');
  assert.equal(res.configuration.fixReviewer.maker, 'Google');
});

test('Criterion 8: $init admits only Ready cards and refuses every other state or incomplete card, unavailable models, disconnected services, and missing authorization', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'jul225-c8-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const stateDirectory = join(dir, 'runs');

  const inventory = [
    { id: 'codex', name: 'Codex', route: 'acp', service: 'Codex', maker: 'OpenAI', connectionId: 'codex-acp', thinking: { supported: ['high'], default: 'high' } },
    { id: 'deepseek', name: 'DeepSeek', route: 'api', service: 'CommandCode', maker: 'DeepSeek', connectionId: 'commandcode-api', thinking: { supported: false, default: null } },
  ];
  const connections = [
    { id: 'codex-acp', service: 'Codex', status: 'enabled' },
    { id: 'commandcode-api', service: 'CommandCode', status: 'enabled' },
  ];

  // 1. Refuses Backlog card
  const backlogCard = {
    identifier: 'JUL-301',
    state: { name: 'Backlog', type: 'backlog' },
    description: '## Acceptance criteria\n- one\n## Test seams\n- seam 1',
  };
  await assert.rejects(
    runInit('$init JUL-301 --builder codex high --reviewer deepseek none', {
      stateDirectory, inventory, connections, card: backlogCard, decision: 'Start',
    }),
    /card JUL-301 is in Backlog; only Ready cards may be admitted to \$init/,
  );

  // 2. Refuses Incomplete card (missing acceptance criteria)
  const incompleteCriteriaCard = {
    identifier: 'JUL-302',
    state: { name: 'Ready', type: 'unstarted' },
    description: '## Test seams\n- seam 1',
  };
  await assert.rejects(
    runInit('$init JUL-302 --builder codex high --reviewer deepseek none', {
      stateDirectory, inventory, connections, card: incompleteCriteriaCard, decision: 'Start',
    }),
    /has no approved acceptance criteria; incomplete cards are refused/,
  );

  // 3. Refuses Incomplete card (missing test seams)
  const incompleteSeamsCard = {
    identifier: 'JUL-303',
    state: { name: 'Ready', type: 'unstarted' },
    description: '## Acceptance criteria\n- one',
  };
  await assert.rejects(
    runInit('$init JUL-303 --builder codex high --reviewer deepseek none', {
      stateDirectory, inventory, connections, card: incompleteSeamsCard, decision: 'Start',
    }),
    /has no agreed test seams; incomplete cards are refused/,
  );

  // 4. Refuses Unavailable model
  const readyCard = {
    identifier: 'JUL-304',
    state: { name: 'Ready', type: 'unstarted' },
    description: '## Acceptance criteria\n- one\n## Test seams\n- seam 1',
  };
  await assert.rejects(
    runInit('$init JUL-304 --builder nonexistent-model high --reviewer deepseek none', {
      stateDirectory, inventory, connections, card: readyCard, decision: 'Start',
    }),
    /model reference "nonexistent-model" is unknown/,
  );

  // 5. Refuses Disconnected service
  const disabledConnections = [
    { id: 'codex-acp', service: 'Codex', status: 'disabled' },
    { id: 'commandcode-api', service: 'CommandCode', status: 'enabled' },
  ];
  await assert.rejects(
    runInit('$init JUL-305 --builder codex high --reviewer deepseek none', {
      stateDirectory, inventory, connections: disabledConnections, card: { ...readyCard, identifier: 'JUL-305' }, decision: 'Start',
    }),
    /connection "codex-acp" for model "codex" is disconnected or disabled/,
  );

  // 6. Refuses Missing authorization on dispatch
  await assert.rejects(
    runInit('$init JUL-306 --builder codex high --reviewer deepseek none', {
      stateDirectory, inventory, connections, card: { ...readyCard, identifier: 'JUL-306' }, decision: 'Start',
      dispatch: async () => 'dispatched',
      authorization: null,
    }),
    /authorization/,
  );

  // 7. Refuses when card is completely missing (fail-closed preflight)
  await assert.rejects(
    runInit('$init JUL-399 --builder codex high --reviewer deepseek none', {
      stateDirectory, inventory, connections, card: null, decision: 'Start',
    }),
    /preflight failed; only verified Ready cards may be admitted to \$init/,
  );
});

test('Criterion 9: $init shows four role choices and ADR 0021 limits, then accepts exactly Start or Cancel', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'jul225-c9-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const stateDirectory = join(dir, 'runs');

  const inventory = [
    { id: 'codex', name: 'Codex', route: 'acp', service: 'Codex', maker: 'OpenAI', connectionId: 'codex-acp', thinking: { supported: ['high'], default: 'high' } },
    { id: 'deepseek', name: 'DeepSeek', route: 'api', service: 'CommandCode', maker: 'DeepSeek', connectionId: 'cmd-api', thinking: { supported: false, default: null } },
    { id: 'gemini', name: 'Gemini', route: 'api', service: 'CommandCode', maker: 'Google', connectionId: 'cmd-api', thinking: { supported: ['medium'], default: 'medium' } },
  ];

  const logged = [];
  const logger = msg => logged.push(typeof msg === 'string' ? msg : JSON.stringify(msg));

  // 1. Cancel choice cleanly terminates without saving run or dispatching
  const cancelResult = await runInit('$init JUL-401 --builder codex high --reviewer deepseek none --crash-fixer codex high --fix-reviewer gemini medium', {
    stateDirectory, inventory, card: cardFixture('JUL-401'), decision: 'Cancel', logger,
  });
  assert.equal(cancelResult.cancelled, true);
  assert.equal(cancelResult.status, 'CANCELLED');
  assert.ok(logged.some(l => l.includes('ADR 0021 Limits')));
  assert.ok(logged.some(l => l.includes('$2.00 paid API limit')));
  assert.ok(logged.some(l => l.includes('init-cancelled')));

  // Run file must NOT exist after cancellation
  const runFileExists = await readFile(join(stateDirectory, 'JUL-401.json'), 'utf8').catch(() => null);
  assert.equal(runFileExists, null);

  // 2. Invalid decision is rejected
  await assert.rejects(
    runInit('$init JUL-402 --builder codex high --reviewer deepseek none --crash-fixer codex high --fix-reviewer gemini medium --decision Maybe', {
      stateDirectory, inventory, card: cardFixture('JUL-402'), logger,
    }),
    /expected exactly Start or Cancel; got "Maybe"/,
  );

  // 3. Missing decision is rejected
  await assert.rejects(
    runInit('$init JUL-404 --builder codex high --reviewer deepseek none --crash-fixer codex high --fix-reviewer gemini medium', {
      stateDirectory, inventory, card: cardFixture('JUL-404'), logger,
    }),
    /\$init requires an explicit decision: Start or Cancel/,
  );

  // 4. Start choice persists immutable snapshot with ADR 0021 limits
  const startResult = await runInit('$init JUL-403 --builder codex high --reviewer deepseek none --crash-fixer codex high --fix-reviewer gemini medium --decision Start', {
    stateDirectory, inventory, card: cardFixture('JUL-403'), logger,
  });
  assert.equal(startResult.issueId, 'JUL-403');
  assert.equal(startResult.resumed, false);

  const savedRun = JSON.parse(await readFile(join(stateDirectory, 'JUL-403.json'), 'utf8'));
  assert.equal(savedRun.issueId, 'JUL-403');
  assert.equal(savedRun.limits.builder.maxTotalUsd, 2.00);
  assert.equal(savedRun.limits.reviewer.maxTotalUsd, 1.00);
  assert.equal(savedRun.limits.crashFixer.maxTotalUsd, 0.50);
  assert.equal(savedRun.limits.fixReviewer.maxTotalUsd, 0.25);
  assert.equal(savedRun.configuration.builder.identity, 'codex');
  assert.equal(savedRun.configuration.reviewer.identity, 'deepseek');
  assert.equal(savedRun.configuration.crashFixer.identity, 'codex');
  assert.equal(savedRun.configuration.fixReviewer.identity, 'gemini');
});

test('Criterion 10: Restart uses saved configuration without silent substitution even after defaults or inventory change', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'jul225-c10-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const stateDirectory = join(dir, 'runs');

  const initialInventory = [
    { id: 'codex', name: 'Codex', route: 'acp', service: 'Codex', maker: 'OpenAI', connectionId: 'codex-acp', thinking: { supported: ['high'], default: 'high' } },
    { id: 'deepseek', name: 'DeepSeek', route: 'api', service: 'CommandCode', maker: 'DeepSeek', connectionId: 'cmd-api', thinking: { supported: false, default: null } },
  ];

  await runInit('$init JUL-501 --builder codex high --reviewer deepseek none --decision Start', {
    stateDirectory, inventory: initialInventory, card: cardFixture('JUL-501'),
  });

  // Now change defaults in state directory to something different
  await writeFile(join(stateDirectory, 'defaults.json'), `${JSON.stringify({
    builder: { model: 'other-builder', thinking: 'low' },
    reviewer: { model: 'other-reviewer', thinking: null },
  })}\n`);

  // Restart without flags: resumes exact original choices
  const resumed = await runInit('$init JUL-501', { stateDirectory });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.configuration.builder.identity, 'codex');
  assert.equal(resumed.configuration.reviewer.identity, 'deepseek');

  // Attempting to change flags on a saved run is refused
  await assert.rejects(
    runInit('$init JUL-501 --builder codex low', { stateDirectory }),
    /already has a saved configuration; resume without role flags/,
  );
});
