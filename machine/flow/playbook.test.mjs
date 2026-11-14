import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  createChoosePlaybookTool,
  listPlaybooks,
  normalizePlaybookName,
  parsePlaybookSteps,
  resolvePlaybook,
  seedPlaybookTasks,
} from './playbook.mjs';

const repo = resolve(import.meta.dirname, '..', '..');

test('normalizePlaybookName normalizes paths, extensions, spaces, and aliases', () => {
  assert.equal(normalizePlaybookName('Feature'), 'feature');
  assert.equal(normalizePlaybookName('playbooks/bug-fix.md'), 'bug-fix');
  assert.equal(normalizePlaybookName('Multi-phase or multi-PR plan'), 'multi-phase-plan');
  assert.equal(normalizePlaybookName('`investigation`'), 'investigation');
});

test('parsePlaybookSteps extracts numbered steps and indented continuations word for word', () => {
  const featureMd = readFileSync(resolve(repo, '.agents/skills/poteto-mode/playbooks/feature.md'), 'utf8');
  const steps = parsePlaybookSteps(featureMd);
  assert.equal(steps.length, 8);
  assert.equal(steps[0], '`how` over the affected subsystem.');
  assert.match(steps[2], /^Write the throughput checkpoint as four todo items\./);
  assert.match(steps[2], /- \*\*Blocking first steps\.\*\* Gates run before fan-out\./);
  assert.equal(steps[7], 'Run **Opening a PR**.');
});

test('resolvePlaybook finds valid playbooks and returns null for unknown ones', () => {
  assert.ok(listPlaybooks(repo).has('investigation'));
  const inv = resolvePlaybook(repo, 'investigation');
  assert.equal(inv.slug, 'investigation');
  assert.equal(inv.steps.length, 4);
  assert.equal(resolvePlaybook(repo, 'not-a-playbook'), null);
});

test('seedPlaybookTasks puts playbook steps ahead of existing custom tasks', () => {
  const seeded = seedPlaybookTasks(
    [{ id: 'custom_1', content: 'Custom item', status: 'pending', activeForm: 'Custom' }],
    ['Step one', 'Step two'],
  );
  assert.deepEqual(seeded.map(t => [t.id, t.content]), [
    ['playbook_1', 'Step one'],
    ['playbook_2', 'Step two'],
    ['custom_1', 'Custom item'],
  ]);
});

test('createChoosePlaybookTool writes playbook steps to threadState and rejects unknown playbooks', async () => {
  let stored = [];
  let chosen = null;
  let invalid = null;
  const store = {
    getState: async () => stored,
    setState: async ({ value }) => { stored = value; },
  };
  const tool = createChoosePlaybookTool({
    repo,
    onChosen: (info) => { chosen = info; },
    onInvalid: (info) => { invalid = info; },
  });
  const ctx = {
    mastra: { getStorage: () => ({ getStore: async () => store }) },
    agent: { threadId: 't-1' },
    requestContext: new Map(),
  };

  const bad = await tool.execute({ playbook: 'no-such-playbook' }, ctx);
  assert.equal(bad.ok, false);
  assert.equal(bad.isError, true);
  assert.equal(invalid.playbook, 'no-such-playbook');
  assert.equal(chosen, null);

  const ok = await tool.execute({ playbook: 'investigation' }, ctx);
  assert.equal(ok.ok, true);
  assert.equal(ok.playbook, 'investigation');
  assert.equal(ok.steps.length, 4);
  assert.equal(stored.length, 4);
  assert.equal(chosen.playbook, 'investigation');
  assert.equal(ctx.requestContext.get('mastra:tasks').length, 4);
});
