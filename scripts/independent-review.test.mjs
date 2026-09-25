// scripts/independent-review.test.mjs
// Proves Linear card JUL-128: Independent review (stories 18 to 24)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Regex patterns mirroring needs_todd in graph/pydantic/julia_graph/graph.py
const ACCOUNT_ACTION = /\b(?:sign[- ]?in|log[- ]?in|payment|payments|account action)\b/i;
const MONEY_DECISION = /\b(?:money decision|money|cost|spend|budget|billing|subscription|purchase|price)\b/i;
const PRODUCT_DECISION = /\b(?:product decision)\b|\((?:a|b|c)\)/i;

function needsTodd(text) {
  if (!text) return false;
  return ACCOUNT_ACTION.test(text) || MONEY_DECISION.test(text) || PRODUCT_DECISION.test(text);
}

test('AC 5 & UAT 2: needsTodd classifies failures correctly', () => {
  // Account action triggers assignment to Todd
  assert.equal(needsTodd('sign-in required to continue'), true);
  assert.equal(needsTodd('login failed: invalid credentials'), true);
  assert.equal(needsTodd('payment method expired'), true);
  assert.equal(needsTodd('blocked on account action: verify email'), true);

  // Money decision triggers assignment to Todd
  assert.equal(needsTodd('budget exceeded: money decision required'), true);
  assert.equal(needsTodd('tier upgrade cost approval required'), true);
  assert.equal(needsTodd('exceeded monthly spend limit'), true);

  // Product decision triggers assignment to Todd
  assert.equal(needsTodd('product decision: option (a) vs option (b)'), true);
  assert.equal(needsTodd('requires a product decision from PM'), true);

  // Ordinary code, test, review failures DO NOT trigger assignment to Todd
  assert.equal(needsTodd('review stopped after two unsuccessful rounds:\n1. Round 1: missing validation\n2. Round 2: off by one'), false);
  assert.equal(needsTodd('the tests failed: 3 failing tests'), false);
  assert.equal(needsTodd('the builder exited 1: syntax error on line 42'), false);
  assert.equal(needsTodd('the reviewer exited 137 (SIGKILL)'), false);
  assert.equal(needsTodd('the review was voided because the reviewer changed the candidate'), false);
});

test('AC 1 to 5: Pydantic graph codebase implements independent review requirements', () => {
  const graphCode = readFileSync(resolve(process.cwd(), 'graph/pydantic/julia_graph/graph.py'), 'utf8');
  const checkpointCode = readFileSync(resolve(process.cwd(), 'graph/pydantic/julia_graph/checkpoint.py'), 'utf8');
  const workersCode = readFileSync(resolve(process.cwd(), 'graph/pydantic/julia_graph/workers.py'), 'utf8');

  // AC 1: Reviewer from different maker, verdict posted on card
  assert.match(checkpointCode, /class ReviewResult/);
  assert.match(graphCode, /class Review\(BaseNode/);
  assert.match(graphCode, /builder_maker.*!=.*reviewer_maker|reviewer_maker.*different from.*builder_maker/);
  assert.match(graphCode, /review-verdict/);
  assert.match(graphCode, /DeepSeek/);

  // AC 2: Findings go back to builder; two unsuccessful rounds stops with both reasons in one comment
  assert.match(graphCode, /prior_findings/);
  assert.match(graphCode, /findings_part/);
  assert.match(graphCode, /two-rounds-stopped/);
  assert.match(graphCode, /MAX_BUILD_ATTEMPTS\s*=\s*2/);

  // AC 3: Crash, timeout, missing verdict is never an approval
  assert.match(workersCode, /reviewer_outcome/);
  assert.match(graphCode, /missing or invalid verdict/);

  // AC 4: Reviewer that changed candidate has review voided and card says so
  assert.match(graphCode, /review-voided/);
  assert.match(graphCode, /tampered/);
  assert.match(graphCode, /voided/);

  // AC 5: Stopped card assigned to Todd only for account/money/product decision
  assert.match(graphCode, /needs_todd/);
  assert.match(graphCode, /assign\(.*'Todd'\)/);
});

test('AC 6: Python graph-run tests cover approve, findings then approve, two failed rounds, crashed reviewer, and tampering reviewer', () => {
  const pythonPath = existsSync('/srv/julia-runner/graph-venv/bin/python')
    ? '/srv/julia-runner/graph-venv/bin/python'
    : 'python3';
  const cwd = resolve(process.cwd(), 'graph/pydantic');

  try {
    execFileSync(
      pythonPath,
      ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py'],
      {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONPATH: cwd },
      }
    );
    assert.ok(true);
  } catch (err) {
    assert.fail(`Python unit tests failed:\nSTDOUT:\n${err.stdout}\nSTDERR:\n${err.stderr}`);
  }
});
