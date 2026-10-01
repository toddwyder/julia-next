import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('coding standards seed reflects the framework-first rules and is linked from AGENTS.md', () => {
  const standards = read('CODING_STANDARDS.md');
  assert.match(standards, /official (framework )?docs/i);
  assert.match(standards, /framework map/i);
  assert.match(standards, /framework.*example/i);
  assert.match(standards, /npm run lint:framework/);
  assert.match(standards, /progress files/i);
  assert.match(standards, /retry or wait loops/i);
  assert.match(standards, /controller code over 400 lines/i);
  assert.match(standards, /built-in feature/i);
  assert.match(read('AGENTS.md'), /\[CODING_STANDARDS\.md\]\(CODING_STANDARDS\.md\)/);
});

test('agent instructions use GitHub issues and Factory boards, with live UAT after merge', () => {
  for (const path of ['CLAUDE.md', 'AGENTS.md']) {
    const text = read(path);
    assert.match(text, /GitHub issues/);
    assert.match(text, /Factory/);
    assert.match(text, /Todd/);
    assert.doesNotMatch(text, /Tick as you go|Finish the card/);
    assert.match(text, /publisher App/);
    assert.match(text, /\.claude\/skills\/tdd\/SKILL\.md/);
  }
  assert.match(read('CLAUDE.md'), /reviewer merges the PR/);
  assert.doesNotMatch(read('CLAUDE.md'), /close a Linear feature card|throwaway Linear card|Default label vocabulary \(/);
  assert.match(read('AGENTS.md'), /reviewer merges the PR/);
  assert.match(read('CLAUDE.md'), /outside the Factory sandbox/);
  assert.match(read('AGENTS.md'), /outside the Factory sandbox/);
  assert.match(read('docs/agents/work-execution.md'), /Needs attention/);
});

test('the Factory README documents the Monday note and the supported bounded-trace procedure', () => {
  const readme = read('ops/factory/README.md');
  // The note and its exclusion: costs come from Mastra traces, never agent reports,
  // and hand-run Codex/GPT/Claude sessions are outside Factory and never counted.
  assert.match(readme, /## Monday note/);
  assert.match(readme, /Mastra's trace cost data/);
  assert.match(readme, /outside Factory/);
  assert.match(readme, /Codex, GPT, or Claude/);
  assert.match(readme, /Discussion.*Monday notes/);
  // Bounded storage: name the supported retention (DEFAULT_RETENTION on the
  // storage backends) and the operator check that reads the DuckDB store.
  assert.match(readme, /## Bounded trace storage/);
  assert.match(readme, /DEFAULT_RETENTION/);
  assert.match(readme, /observability\.duckdb/);
  assert.match(readme, /never deletes|does not delete/);
  assert.doesNotMatch(readme, /enforceRetention/);
  assert.doesNotMatch(readme, /selectExpiredSpans|runTraceCleanup/);
});

test('the Factory README carries a framework map with local sources and states the gaps', () => {
  const readme = read('ops/factory/README.md');
  assert.match(readme, /## Framework map/);
  // Real, local sources (repository docs and installed package paths), not
  // invented web citations.
  assert.match(readme, /docs\/research\/mastra-intended-use-audit\.md/);
  assert.match(readme, /@mastra\/duckdb|DuckDBStore/);
  assert.match(readme, /storage-maintenance/);
  // The gaps this card could not close through supported config are named, with
  // what is missing, rather than a fabricated citation.
  assert.match(readme, /gap|not configured|missing/i);
  assert.match(readme, /no supported|not supported|cannot be configured|fail(s)? closed/i);
});

test('the exceptions list marks the #140 entry approved by Todd, citing GitHub #140', () => {
  const readme = read('ops/factory/README.md');
  assert.match(readme, /Only\s+Todd adds or removes an entry/);
  // Issue #140: Todd approved this entry (2026-09-30); the row must name the
  // approval and the card, and must no longer read as merely proposed.
  const row = readme.split('\n').find((line) => line.includes('#140') || (line.includes('Monday note') && line.startsWith('|')));
  assert.ok(row, 'expected a row mentioning the Monday note / #140');
  assert.match(row, /approved/i);
  assert.match(row, /#140/);
  assert.doesNotMatch(row, /proposed|awaiting Todd|pending Todd/i);
});

test('post-build reviewer checks and the plan-answers/park policy replace stop-and-ask builder gates', () => {
  const standards = read('CODING_STANDARDS.md');
  const checks = [
    'unit tests',
    'integration tests at affected boundaries',
    'end-to-end for the changed journey',
    'a clean browser console',
    'logging good enough to find a root cause',
  ];
  for (const name of checks) {
    assert.ok(standards.includes(name), `CODING_STANDARDS.md must name the reviewer check: "${name}"`);
  }
  const we = read('docs/agents/work-execution.md');
  assert.match(we, /approved plan|plan supplies|agreed seams/i);
  assert.match(we, /park the card|park.*with one line/i);
  assert.doesNotMatch(we, /ask Todd for an exception|ask Todd for.*workaround/i);
});
