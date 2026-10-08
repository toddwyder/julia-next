import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const workflows = resolve(import.meta.dirname, '../../.github/workflows');
const ci = readFileSync(resolve(workflows, 'ci.yml'), 'utf8');

test('focused CI gates retain current coverage without retired graph tests', () => {
  for (const file of ['health-route', 'dynamic-route', 'web-app', 'agent-docs', 'line-endings', 'no-personal-paths', 'personal-paths', 'framework-lint', 'merge-pr', 'publish-pr', 'publish-pr.real-git', 'publish-via-github-app', 'ci-routing']) {
    assert.ok(ci.includes(`scripts/${file}.test.mjs`), `missing ${file}`);
  }
  assert.doesNotMatch(ci, /node --test scripts\/\*\.test\.mjs|graph\/pydantic\/requirements\.txt|scripts\/independent-review\.test\.mjs/);
  for (const job of ['baseline', 'julia-init-windows', 'factory', 'database', 'web', 'docs-policy']) {
    assert.match(ci, new RegExp(`\\n  ${job}:`), `missing ${job} job`);
  }
  assert.match(ci, /run: npm run build/);
});

test('CI retains the trace retention tests but not retired Monday-note tests', () => {
  assert.ok(ci.includes('ops/factory/trace-retention.test.mjs'));
  assert.doesNotMatch(ci, /ops\/factory\/monday-note/);
});


test('CI runs the app DuckDB observability retention tests the repo-standard way', () => {
  // The app's TypeScript tests are runnable with Node's built-in type stripping
  // plus the repo's `.js` -> `.ts` resolve hook, the same mechanism CI already
  // uses for local-sandbox.test.mjs -- no extra tooling dependency (e.g. tsx) is
  // added just to run a test.
  assert.match(ci, /--experimental-strip-types/);
  assert.match(ci, /--import .\/register-typescript-esm\.mjs/);
  assert.match(ci, /observability-retention\.test\.mjs/);
  assert.match(ci, /observability-retention-schedule\.test\.mjs/);
  assert.doesNotMatch(ci, /--import tsx/);
});

test('CI cancels superseded runs and routes each focused job through changes', () => {
  assert.match(ci, /cancel-in-progress: true/);
  assert.match(ci, /changes:\s*\n(?:\s*#[^\n]*\n)*\s+runs-on: ubuntu-22\.04/);
  for (const gate of ['julia-init-windows', 'factory', 'database', 'web', 'docs-policy']) {
    assert.match(ci, new RegExp(`needs: changes[\\s\\S]*?if: needs\\.changes\\.outputs\\.${gate.replaceAll('-', '_')} == 'true'`), `${gate} is not routed through changes`);
  }
  assert.match(ci, /Changed paths:/);
  assert.match(ci, /Selected gates:/);
  const baselineStart = ci.indexOf('\n  baseline:\n');
  const baselineEnd = ci.indexOf('\n  julia-init-windows:', baselineStart);
  const baseline = ci.slice(baselineStart, baselineEnd);
  assert.ok(baseline, 'missing baseline job');
  assert.match(baseline, /scripts\/ci-routing\.test\.mjs/);
  assert.match(baseline, /scripts\/line-endings\.test\.mjs/);
});

test('the required checks context summarizes selected gates without hiding skipped jobs', () => {
  const checks = ci.match(/\n  checks:\n[\s\S]*$/)?.[0];
  assert.ok(checks, 'missing stable checks aggregation job');
  assert.match(checks, /if: always\(\)/);
  for (const job of ['changes', 'baseline', 'julia-init-windows', 'factory', 'database', 'web', 'docs-policy']) {
    assert.ok(checks.includes(job), `checks does not account for ${job}`);
  }
  assert.match(checks, /success\|skipped/, 'checks must reject a failed or cancelled gate');
  assert.match(checks, /not applicable/, 'checks must disclose skipped gates instead of presenting them as completed');
});
