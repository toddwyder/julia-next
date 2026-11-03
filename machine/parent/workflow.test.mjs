import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadMastra, missingProgram } from '../shipping/harness.mjs';
import { createStore, readRunFile } from './store.mjs';
import { createMachineWorkflow } from './workflow.mjs';

const missing = missingProgram();
const reason = missing ? `the Mastra program is not installed here: ${missing}` : false;

async function machine(runStage) {
  const { Mastra, LibSQLStore } = await loadMastra();
  const dir = mkdtempSync(path.join(tmpdir(), 'machine-workflow-'));
  const mastra = new Mastra({ storage: new LibSQLStore({ id: 'machine-test', url: `file:${path.join(dir, 'state.db')}` }), logger: false });
  const store = createStore(path.join(dir, 'runs'), { idleLimit: 60_000 });
  const holder = { record: store.start({ card: 'JUL-330', now: new Date('2026-11-03T06:41:22Z') }) };
  const { workflow } = await createMachineWorkflow({ mastra, store, holder, runStage, log: () => {} });
  const run = await workflow.createRun();
  let result;
  let failure;
  try {
    result = await run.start({ inputData: { card: 'JUL-330', pr: null } });
  } catch (error) {
    failure = error;
  }
  const saved = readRunFile(path.join(store.folder, `${holder.record.id}.json`));
  return { result, failure, saved };
}

test('one workflow runs the build, then the review loop, then the landing, and records each', { skip: reason }, async () => {
  const seen = [];
  const { result, failure, saved } = await machine(async (stage, { pr }) => {
    seen.push({ stage, pr });
    return stage === 'build'
      ? { status: 'succeeded', pr: 431, detail: 'the builder opened pull request #431' }
      : { status: 'succeeded', pr, detail: `${stage} finished` };
  });

  assert.equal(failure, undefined);
  assert.equal(result.status, 'success');
  assert.deepEqual(seen, [
    { stage: 'build', pr: null },
    { stage: 'remediation', pr: 431 },
    { stage: 'landing', pr: 431 },
  ]);
  assert.equal(saved.error, '');
  assert.equal(saved.record.card, 'JUL-330');
  assert.equal(saved.record.pr, 431);
  assert.deepEqual(saved.record.steps.map(step => [step.id, step.status]), [
    ['build', 'succeeded'],
    ['remediation', 'succeeded'],
    ['landing', 'succeeded'],
  ]);
  for (const step of saved.record.steps) {
    assert.ok(step.startedAt && step.endedAt);
  }
});

test('a build that fails stops the run, and the later stages never start', { skip: reason }, async () => {
  const seen = [];
  const { result, failure, saved } = await machine(async (stage, { pr }) => {
    seen.push(stage);
    return { status: 'failed', pr, detail: 'the builder left no open pull request for JUL-330' };
  });

  assert.ok(failure || result.status !== 'success', 'the run does not report success');
  assert.deepEqual(seen, ['build']);
  assert.equal(saved.record.steps[0].status, 'failed');
  assert.match(saved.record.steps[0].detail, /left no open pull request/);
  assert.equal(saved.record.steps[1].status, 'pending');
});

test('a stage that throws is recorded as failed with its reason', { skip: reason }, async () => {
  const { result, saved } = await machine(async stage => {
    if (stage === 'remediation') throw new Error('the review loop stopped the card');
    return { status: 'succeeded', pr: 431, detail: 'opened' };
  });

  assert.equal(result.status, 'failed');
  assert.equal(saved.record.steps[1].status, 'failed');
  assert.match(saved.record.steps[1].detail, /the review loop stopped the card/);
  assert.equal(saved.record.steps[2].status, 'pending');
});
