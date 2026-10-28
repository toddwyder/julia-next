import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { guardWrite } from './guarded-write.mjs';
import { retryTurn } from './retry.mjs';
import { classifyEvent, mapStatus } from './run-state.mjs';
import { prepareRun } from './run-build.mjs';
import { reportHTML } from '../scripts/effort-report.mjs';

for (const [bytes, decision] of [[23999, 'allow'], [24000, 'allow'], [24001, 'block'], [60000, 'block']]) test(`write guard ${bytes} bytes`, () => {
  const result = guardWrite({ tool_name: 'write_file', tool_input: { content: 'x'.repeat(bytes) } });
  assert.equal(result.decision, decision);
  if (decision === 'block') assert.equal(result.reason, 'write this in parts');
});
test('guard counts UTF-8 bytes rather than characters', () => assert.equal(guardWrite({ tool_name: 'write_file', tool_input: { content: '🙂'.repeat(6001) } }).decision, 'block'));
test('guard CLI speaks the installed hook protocol', () => {
  const result = spawnSync(process.execPath, ['guarded-write.mjs'], { cwd: import.meta.dirname, input: JSON.stringify({ tool_name: 'write_file', tool_input: { content: 'x'.repeat(60000) } }), encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).reason, 'write this in parts');
});
for (const failures of [1, 3, 5]) test(`retry after ${failures} real-shaped reset results`, async () => {
  const waits = [], notes = [];
  let calls = 0;
  const run = retryTurn(async () => {
    calls++;
    return calls <= failures ? { exitCode: 1, status: 'error', error: { message: 'read ECONNRESET' } } : { exitCode: 0, status: 'completed' };
  }, { sleep: async ms => waits.push(ms), note: event => notes.push(event) });
  if (failures === 5) await assert.rejects(run, /ECONNRESET/);
  else assert.equal((await run).exitCode, 0);
  assert.equal(calls, Math.min(failures + 1, 5));
  assert.deepEqual(waits, [2000, 4000, 8000, 16000].slice(0, Math.min(failures, 4)));
  assert.equal(notes.length, waits.length);
});
test('nested transport reset retries but authentication does not', async () => {
  let calls = 0;
  await retryTurn(async () => { if (++calls === 1) throw new Error('terminated', { cause: { code: 'ECONNRESET' } }); return { exitCode: 0 }; }, { sleep: async () => {} });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(retryTurn(async () => { calls++; throw new Error('Unauthorized'); }), /Unauthorized/);
  assert.equal(calls, 1);
});
test('abort interrupts retry sleep without starting another turn', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(retryTurn(async () => { calls++; controller.abort(); throw new Error('ECONNRESET'); }, { signal: controller.signal }));
  assert.equal(calls, 1);
});
test('observer error is a note and cannot change status', () => {
  assert.deepEqual(classifyEvent({ type: 'error', error: new Error('memory: observe read ECONNRESET') }), { type: 'observer_note', message: 'memory: observe read ECONNRESET', statusChanged: false });
  assert.equal(mapStatus({ phase: 'running' }), 'running');
  assert.equal(classifyEvent({ type: 'error', error: new Error('main model read ECONNRESET') }).type, 'turn_error');
});
test('status mapping preserves stopped over a failed SDK abort', () => {
  assert.equal(mapStatus({}), 'starting');
  assert.equal(mapStatus({ phase: 'running' }), 'running');
  assert.equal(mapStatus({ stopped: true, result: { exitCode: 1 }, error: new Error('aborted') }), 'stopped');
  assert.equal(mapStatus({ result: { exitCode: 0 } }), 'exited');
  assert.equal(mapStatus({ result: { exitCode: 1 } }), 'failed');
});
test('each run copies credentials and installs its own pack and global hook', () => {
  const root = mkdtempSync(join(tmpdir(), 'worker-test-'));
  try {
    assert.equal(spawnSync('git', ['init', '--quiet', root]).status, 0);
    const source = join(root, 'source'); mkdirSync(source);
    writeFileSync(join(source, 'settings.json'), JSON.stringify({ models: { activeModelPackId: 'custom:wrong', subagentModels: { explore: 'wrong' } } }));
    writeFileSync(join(source, 'auth.json'), '{"test":"fixture-only"}');
    const config = { id: 'unit', runDir: join(root, 'run'), sourceAppData: source, cwd: root, model: 'main/model', helperModel: 'helper/model', effort: 'Large', prompt: 'test', deadlineMs: 1000 };
    const paths = prepareRun(config);
    const settings = JSON.parse(readFileSync(join(paths.app, 'settings.json'), 'utf8'));
    assert.equal(settings.models.activeModelPackId, 'custom:unit');
    assert.equal(settings.customModelPacks[0].models.plan, 'main/model');
    assert.equal(settings.customModelPacks[0].models.build, 'main/model');
    assert.equal(settings.customModelPacks[0].models.fast, 'helper/model');
    assert.deepEqual(settings.models.subagentModels, {});
    assert.equal(readFileSync(join(paths.app, 'auth.json'), 'utf8'), '{"test":"fixture-only"}');
    assert.ok(existsSync(join(paths.home, '.mastracode/hooks.json')));
    assert.ok(!existsSync(join(root, '.mastracode')));
    assert.throws(() => prepareRun(config), /EEXIST/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('report escapes provider strings and never calls absent reset proof passed', () => {
  const html = reportHTML({ mode: '<script>', runs: [] });
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Unverified. No real reset retry observed.'));
  for (const id of ['small', 'medium', 'large', 'unlimited', 'packs', 'helpers', 'cost', 'guard', 'reset', 'observer']) assert.ok(html.includes(`id="${id}"`));
});

test('suspended SDK results never report a completed build', async () => {
  const result = { exitCode: 0, status: 'completed', finishReason: 'suspended' };
  assert.equal(mapStatus({ result }), 'failed');
  await assert.rejects(retryTurn(async () => result));
});
