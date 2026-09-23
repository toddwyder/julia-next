// bad-submissions.test.mjs -- JUL-116 Round 0: three deliberately bad
// submissions for the graph's gates. Proves each submission is bad in
// exactly the way it claims, and in no other way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkEvidence } from './acceptance-check.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPTS_DIR, '..');
const FIXTURES_DIR = resolve(REPO_ROOT, 'graph/fixtures/bad-submissions');
const CARD_PATH = resolve(FIXTURES_DIR, 'card-jul-45.md');

const ALLOWED_REFUSED_BY = new Set(['tests', 'acceptance-check', 'reviewer']);
const SUBMISSIONS = ['tests-fail', 'evidence-missing', 'work-mismatch'];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function runCheck(checkPath) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--test', checkPath], {
    encoding: 'utf8',
    env,
  });
}

test('each expected.json has a valid refusedBy and non-empty reason', () => {
  for (const name of SUBMISSIONS) {
    const expected = readJson(resolve(FIXTURES_DIR, name, 'expected.json'));
    assert.ok(
      ALLOWED_REFUSED_BY.has(expected.refusedBy),
      `${name}: refusedBy "${expected.refusedBy}" must be one of tests | acceptance-check | reviewer`,
    );
    assert.equal(
      typeof expected.reason,
      'string',
      `${name}: reason must be a string`,
    );
    assert.ok(
      expected.reason.trim().length > 0,
      `${name}: reason must not be empty`,
    );
  }
});

test('tests-fail: check fails in child process, evidence passes acceptance-check', () => {
  const dir = resolve(FIXTURES_DIR, 'tests-fail');
  const expected = readJson(resolve(dir, 'expected.json'));
  assert.equal(expected.refusedBy, 'tests');

  // Running its smoke-walk.check.mjs exits non-zero
  const checkPath = resolve(dir, 'smoke-walk.check.mjs');
  const checkRun = runCheck(checkPath);
  assert.notEqual(
    checkRun.status,
    0,
    `tests-fail check must fail, but exited with status ${checkRun.status}`,
  );

  // Its evidence is complete and passes checkEvidence
  const cardDescription = readFileSync(CARD_PATH, 'utf8');
  const evidence = readJson(resolve(dir, 'evidence.json'));
  const checkResult = checkEvidence({
    description: cardDescription,
    builder: evidence.builder,
    reviewer: evidence.reviewer,
  });
  assert.equal(
    checkResult.ok,
    true,
    `tests-fail evidence must pass acceptance-check: ${checkResult.missing.join('; ')}`,
  );
});

test('evidence-missing: check passes, acceptance-check fails naming AC5 and UAT3 only', () => {
  const dir = resolve(FIXTURES_DIR, 'evidence-missing');
  const expected = readJson(resolve(dir, 'expected.json'));
  assert.equal(expected.refusedBy, 'acceptance-check');

  // Its smoke-walk.check.mjs passes
  const checkPath = resolve(dir, 'smoke-walk.check.mjs');
  const checkRun = runCheck(checkPath);
  assert.equal(
    checkRun.status,
    0,
    `evidence-missing check must pass, but exited with status ${checkRun.status}: ${checkRun.stderr}`,
  );

  // checkEvidence fails and missing list names AC5 and UAT3 and nothing else
  const cardDescription = readFileSync(CARD_PATH, 'utf8');
  const evidence = readJson(resolve(dir, 'evidence.json'));
  const checkResult = checkEvidence({
    description: cardDescription,
    builder: evidence.builder,
    reviewer: evidence.reviewer,
  });
  assert.equal(checkResult.ok, false, 'evidence-missing must fail acceptance-check');
  assert.equal(
    checkResult.missing.length,
    2,
    `expected exactly 2 missing items, got: ${JSON.stringify(checkResult.missing)}`,
  );
  assert.ok(
    checkResult.missing.some((item) => item.startsWith('AC5 ')),
    `missing list must name AC5: ${JSON.stringify(checkResult.missing)}`,
  );
  assert.ok(
    checkResult.missing.some((item) => item.startsWith('UAT3 ')),
    `missing list must name UAT3: ${JSON.stringify(checkResult.missing)}`,
  );
});

test('work-mismatch: check passes, acceptance-check passes, module makes one request and no per-step results', async () => {
  const dir = resolve(FIXTURES_DIR, 'work-mismatch');
  const expected = readJson(resolve(dir, 'expected.json'));
  assert.equal(expected.refusedBy, 'reviewer');

  // Its smoke-walk.check.mjs passes
  const checkPath = resolve(dir, 'smoke-walk.check.mjs');
  const checkRun = runCheck(checkPath);
  assert.equal(
    checkRun.status,
    0,
    `work-mismatch check must pass, but exited with status ${checkRun.status}: ${checkRun.stderr}`,
  );

  // checkEvidence passes because it judges presence, not truth
  const cardDescription = readFileSync(CARD_PATH, 'utf8');
  const evidence = readJson(resolve(dir, 'evidence.json'));
  const checkResult = checkEvidence({
    description: cardDescription,
    builder: evidence.builder,
    reviewer: evidence.reviewer,
  });
  assert.equal(
    checkResult.ok,
    true,
    `work-mismatch evidence must pass acceptance-check: ${checkResult.missing.join('; ')}`,
  );

  // The module only fetches the address (exactly one request) and gives no per-step results
  const { smokeWalk } = await import(resolve(dir, 'smoke-walk.mjs'));
  const requests = [];
  const mockFetch = async (url) => {
    requests.push(url);
    return { ok: true, status: 200 };
  };
  const result = await smokeWalk('http://localhost:3000', { fetch: mockFetch });
  assert.equal(
    requests.length,
    1,
    `work-mismatch must make exactly one request, made ${requests.length}`,
  );
  assert.equal(
    result.steps,
    undefined,
    'work-mismatch must have no per-step results',
  );
});
