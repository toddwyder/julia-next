// scripts/independent-review.test.mjs
// JUL-128 (independent review), AC 6: the graph's own test step runs only
// `node --test scripts/*.test.mjs`, so this file runs the Python graph-run
// tests (pretend workers, real git) and fails the suite if they fail or if any
// of the five review cases the card names is missing from them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GRAPH = resolve(process.cwd(), 'graph/pydantic');
// The server's graph environment when it is there, else the machine's Python.
const PYTHON = existsSync('/srv/julia-runner/graph-venv/bin/python') ? '/srv/julia-runner/graph-venv/bin/python' : 'python3';

// One graph-run test per review outcome AC 6 names.
const CASES = {
  approve: 'test_1_approval_is_posted_with_the_reviewer_and_its_company',
  'findings then approve': 'test_2_findings_go_back_to_the_builder_on_top_of_its_commit_then_approval',
  'two failed rounds': 'test_3_two_rounds_of_findings_stop_the_card_with_both_reasons_in_one_comment',
  'crashed reviewer': 'test_4_a_crashed_reviewer_is_never_an_approval_even_after_writing_approve',
  'tampering reviewer': 'test_5_a_reviewer_that_changed_the_candidate_is_voided_and_the_candidate_put_back',
};

test('AC 6: the graph-run tests name approve, findings then approve, two failed rounds, a crashed and a tampering reviewer', () => {
  const tests = readFileSync(resolve(GRAPH, 'tests/test_graph.py'), 'utf8');
  for (const [outcome, name] of Object.entries(CASES)) {
    assert.match(tests, new RegExp(`async def ${name}\\(self\\)`), `no graph-run test for "${outcome}"`);
  }
});

test('AC 6: the Python graph-run tests pass', () => {
  const run = spawnSync(PYTHON, ['-m', 'unittest', 'discover', '-t', '.', '-s', 'tests', '-v'], {
    cwd: GRAPH, encoding: 'utf8', env: { ...process.env, PYTHONPATH: GRAPH },
  });
  assert.equal(run.error, undefined, `could not start ${PYTHON}: ${run.error?.message}`);
  assert.equal(run.status, 0, `the graph-run tests failed:\n${run.stderr.slice(-4000)}`);
  // each of the five cases really ran and passed, not skipped
  for (const name of Object.values(CASES)) {
    assert.match(run.stderr, new RegExp(`${name} \\(.*\\) \\.\\.\\. ok`), `${name} did not pass`);
  }
});
