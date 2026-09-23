// scripts/framework-lint.test.mjs -- JUL-116: framework-first check rebuilt on ESLint
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPTS_DIR, '..');

// Helper to calculate total code lines in a directory excluding test files
export function countFolderCodeLines(dirPath) {
  if (!existsSync(dirPath)) return 0;
  let total = 0;
  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += countFolderCodeLines(fullPath);
    } else if (entry.isFile()) {
      const isTest = /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name);
      const isCode = /\.[cm]?[jt]sx?$/.test(entry.name);
      if (isCode && !isTest) {
        const content = readFileSync(fullPath, 'utf8');
        const lines = content.split(/\r\n|\r|\n/);
        if (lines.length > 1 && lines.at(-1) === '') {
          lines.pop();
        }
        total += lines.length;
      }
    }
  }
  return total;
}

// CI runs without installing npm packages, so dynamically import ESLint
let ESLint = null;
let frameworkConfig = null;
let eslintInstalled = false;

try {
  const eslintModule = await import('eslint');
  const configModule = await import('../eslint.config.mjs');
  ESLint = eslintModule.ESLint;
  frameworkConfig = configModule.frameworkConfig;
  eslintInstalled = true;
} catch {
  eslintInstalled = false;
}

const skipMessage = eslintInstalled ? false : 'eslint not installed; run npm ci';

// Helper to lint a fixture file using ESLint Node API with the framework rules
async function lintFixture(fixtureRelativePath) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        ...frameworkConfig,
        files: ['**/*'],
      },
    ],
  });
  const fullPath = join(REPO_ROOT, fixtureRelativePath);
  const results = await eslint.lintFiles([fullPath]);
  return results[0];
}

// 1. max-lines rule test
test('max-lines: fails with rule name max-lines when file exceeds 400 lines', { skip: skipMessage }, async () => {
  const result = await lintFixture('graph/fixtures/framework-first/bad-max-lines/controller.mjs');
  assert.ok(result.errorCount > 0, 'bad-max-lines fixture should produce errors');
  const maxLinesError = result.messages.find((m) => m.ruleId === 'max-lines');
  assert.ok(maxLinesError, 'expected error with ruleId "max-lines"');
});

// 2. no-restricted-globals rule test
test('no-restricted-globals: fails with rule name no-restricted-globals when setTimeout/setInterval are used', { skip: skipMessage }, async () => {
  const result = await lintFixture('graph/fixtures/framework-first/bad-restricted-globals/controller.mjs');
  assert.ok(result.errorCount > 0, 'bad-restricted-globals fixture should produce errors');
  const errors = result.messages.filter((m) => m.ruleId === 'no-restricted-globals');
  assert.ok(errors.length >= 2, 'expected errors for setTimeout and setInterval under ruleId "no-restricted-globals"');
});

// 3. no-restricted-syntax rule test
test('no-restricted-syntax: fails with rule name no-restricted-syntax when while (true) or for (;;) are used', { skip: skipMessage }, async () => {
  const result = await lintFixture('graph/fixtures/framework-first/bad-restricted-syntax/controller.mjs');
  assert.ok(result.errorCount > 0, 'bad-restricted-syntax fixture should produce errors');
  const errors = result.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
  assert.ok(errors.length >= 2, 'expected errors for while(true) and for(;;) under ruleId "no-restricted-syntax"');
});

// 3a. no-restricted-syntax bypass: while (1) and literal while loops
test('no-restricted-syntax: fails with rule name no-restricted-syntax when while (1) is used', { skip: skipMessage }, async () => {
  const result = await lintFixture('graph/fixtures/framework-first/bad-while-literal/controller.mjs');
  assert.ok(result.errorCount > 0, 'bad-while-literal fixture should produce errors');
  const errors = result.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
  assert.ok(errors.length >= 1, 'expected error for while (1) under ruleId "no-restricted-syntax"');
});

// 3b. no-restricted-syntax bypass: do ... while (true) loops
test('no-restricted-syntax: fails with rule name no-restricted-syntax when do { } while (true) is used', { skip: skipMessage }, async () => {
  const result = await lintFixture('graph/fixtures/framework-first/bad-do-while/controller.mjs');
  assert.ok(result.errorCount > 0, 'bad-do-while fixture should produce errors');
  const errors = result.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
  assert.ok(errors.length >= 1, 'expected error for do { } while (true) under ruleId "no-restricted-syntax"');
});

// 4. no-restricted-imports rule test
test('no-restricted-imports: fails with rule name no-restricted-imports when file write functions are imported', { skip: skipMessage }, async () => {
  const result = await lintFixture('graph/fixtures/framework-first/bad-restricted-imports/controller.mjs');
  assert.ok(result.errorCount > 0, 'bad-restricted-imports fixture should produce errors');
  const errors = result.messages.filter((m) => m.ruleId === 'no-restricted-imports');
  assert.ok(errors.length >= 2, 'expected errors for writeFile and appendFile imports under ruleId "no-restricted-imports"');
});

// 4a. no-restricted-imports bypass: timer module imports
test('no-restricted-imports: fails with rule name no-restricted-imports when timer functions are imported from node:timers/promises, timers/promises, timers, node:timers', { skip: skipMessage }, async () => {
  const result = await lintFixture('graph/fixtures/framework-first/bad-timer-imports/controller.mjs');
  assert.ok(result.errorCount > 0, 'bad-timer-imports fixture should produce errors');
  const errors = result.messages.filter((m) => m.ruleId === 'no-restricted-imports');
  assert.ok(errors.length >= 4, 'expected errors for timer imports under ruleId "no-restricted-imports"');
});

// 5. no-restricted-properties rule test
test('no-restricted-properties: fails with rule name no-restricted-properties when fs write methods are called', { skip: skipMessage }, async () => {
  const result = await lintFixture('graph/fixtures/framework-first/bad-restricted-properties/controller.mjs');
  assert.ok(result.errorCount > 0, 'bad-restricted-properties fixture should produce errors');
  const errors = result.messages.filter((m) => m.ruleId === 'no-restricted-properties');
  assert.ok(errors.length >= 2, 'expected errors for writeFileSync and createWriteStream calls under ruleId "no-restricted-properties"');
});

// 5a. no-restricted-properties bypass: globalThis/global/window timers
test('no-restricted-properties: fails with rule name no-restricted-properties when setTimeout/setInterval are called on globalThis, global, or window', { skip: skipMessage }, async () => {
  const result = await lintFixture('graph/fixtures/framework-first/bad-global-timers/controller.mjs');
  assert.ok(result.errorCount > 0, 'bad-global-timers fixture should produce errors');
  const errors = result.messages.filter((m) => m.ruleId === 'no-restricted-properties');
  assert.ok(errors.length >= 6, 'expected errors for globalThis/global/window setTimeout/setInterval under ruleId "no-restricted-properties"');
});

// 6. eslint-comments/no-unlimited-disable rule test
test('eslint-comments/no-unlimited-disable: fails with rule name eslint-comments/no-unlimited-disable when unlimited disable is used', { skip: skipMessage }, async () => {
  const result = await lintFixture('graph/fixtures/framework-first/bad-unlimited-disable/controller.mjs');
  assert.ok(result.errorCount > 0, 'bad-unlimited-disable fixture should produce errors');
  const error = result.messages.find((m) => m.ruleId === 'eslint-comments/no-unlimited-disable');
  assert.ok(error, 'expected error with ruleId "eslint-comments/no-unlimited-disable"');
});

// 7. eslint-comments/require-description rule test (skip without reason fails)
test('eslint-comments/require-description: fails with rule name eslint-comments/require-description when skip has no reason', { skip: skipMessage }, async () => {
  const result = await lintFixture('graph/fixtures/framework-first/bad-skip-no-reason/controller.mjs');
  assert.ok(result.errorCount > 0, 'bad-skip-no-reason fixture should produce errors');
  const error = result.messages.find((m) => m.ruleId === 'eslint-comments/require-description');
  assert.ok(error, 'expected error with ruleId "eslint-comments/require-description"');
});

// 8. clean fixture passes using ordinary LangGraph code (checkpointer, interrupt, Command resume, retryPolicy, recursionLimit)
test('clean LangGraph fixture: passes lint with checkpointer, interrupt(), new Command({ resume }), retryPolicy, and recursionLimit', { skip: skipMessage }, async () => {
  const fixturePath = 'graph/fixtures/framework-first/clean/controller.mjs';
  const content = readFileSync(join(REPO_ROOT, fixturePath), 'utf8');

  // Verify it contains ordinary LangGraph code constructs
  assert.match(content, /checkpointer/i, 'clean fixture should use a checkpointer');
  assert.match(content, /interrupt\s*\(/, 'clean fixture should use interrupt()');
  assert.match(content, /new\s+Command\(\s*\{\s*resume/, 'clean fixture should use new Command({ resume })');
  assert.match(content, /retryPolicy/, 'clean fixture should use retryPolicy');
  assert.match(content, /recursionLimit/, 'clean fixture should use recursionLimit');

  const result = await lintFixture(fixturePath);
  assert.equal(result.errorCount, 0, `clean fixture must have 0 errors, got: ${JSON.stringify(result.messages)}`);
  assert.equal(result.warningCount, 0, `clean fixture must have 0 warnings, got: ${JSON.stringify(result.messages)}`);
});

// 9. skip with reason passes and is listed
test('skip with reason: passes lint and records justification for listing', { skip: skipMessage }, async () => {
  const result = await lintFixture('graph/fixtures/framework-first/skip-with-reason/controller.mjs');
  assert.equal(result.errorCount, 0, `skip-with-reason fixture must have 0 errors, got: ${JSON.stringify(result.messages)}`);
  assert.equal(result.warningCount, 0, `skip-with-reason fixture must have 0 warnings, got: ${JSON.stringify(result.messages)}`);

  assert.ok(result.suppressedMessages && result.suppressedMessages.length > 0, 'must have suppressed messages');
  const suppression = result.suppressedMessages[0].suppressions?.[0];
  assert.ok(suppression, 'must have a suppression object');
  assert.match(suppression.justification, /JUL-115/, 'justification must contain the reason');
  assert.match(suppression.justification, /https?:\/\//, 'justification should contain a docs link');
});

// 10. Folder total code lines (not counting tests) is at most 400 lines
test("graph/langgraph folder total lines, not counting tests, is at most 400 lines", () => {
  const langgraphDir = join(REPO_ROOT, 'graph/langgraph');
  const totalLines = countFolderCodeLines(langgraphDir);
  assert.ok(
    totalLines <= 400,
    `graph/langgraph total non-test code lines must be <= 400, found ${totalLines}`,
  );
});

// 11. Folder code line counter excludes test files and counts accurately
test('countFolderCodeLines: excludes test files and correctly sums non-test lines', () => {
  const cleanDir = join(REPO_ROOT, 'graph/fixtures/framework-first/clean');
  const cleanLines = countFolderCodeLines(cleanDir);
  assert.ok(cleanLines > 0 && cleanLines < 400, `clean fixture lines should be > 0 and < 400, got ${cleanLines}`);

  const badLinesDir = join(REPO_ROOT, 'graph/fixtures/framework-first/bad-max-lines');
  const badLines = countFolderCodeLines(badLinesDir);
  assert.ok(badLines > 400, `bad-max-lines fixture should exceed 400 lines, got ${badLines}`);
});

// 11b. Folder code line counter: 400 passes, 401 fails, matches max-lines without trailing newline discrepancy
test('countFolderCodeLines: a folder of exactly 400 lines passes, 401 fails', () => {
  const dir400 = join(REPO_ROOT, 'graph/fixtures/framework-first/folder-400-lines');
  const lines400 = countFolderCodeLines(dir400);
  assert.equal(lines400, 400, `expected exactly 400 lines for folder-400-lines, got ${lines400}`);
  assert.ok(lines400 <= 400, 'folder of exactly 400 lines must pass <= 400 limit');

  const dir401 = join(REPO_ROOT, 'graph/fixtures/framework-first/folder-401-lines');
  const lines401 = countFolderCodeLines(dir401);
  assert.equal(lines401, 401, `expected exactly 401 lines for folder-401-lines, got ${lines401}`);
  assert.ok(lines401 > 400, 'folder of 401 lines must fail <= 400 limit');

  // Verify that the 406-line fixture is counted as 406 (matching max-lines), not 407
  const badLinesDir = join(REPO_ROOT, 'graph/fixtures/framework-first/bad-max-lines');
  const badLines = countFolderCodeLines(badLinesDir);
  assert.equal(badLines, 406, `bad-max-lines fixture should count as 406 lines matching max-lines, got ${badLines}`);
});

// 12. Normal use: eslint.config.mjs applies only to graph/langgraph/** and ignores everything else
test('eslint.config.mjs: normal configuration ignores files outside graph/langgraph/**', { skip: skipMessage }, async () => {
  const eslint = new ESLint();
  assert.equal(await eslint.isPathIgnored('graph/controller/controller.mjs'), true, 'graph/controller must be ignored');
  assert.equal(await eslint.isPathIgnored('app/page.jsx'), true, 'app/ must be ignored');
  assert.equal(await eslint.isPathIgnored('scripts/linear-cli.mjs'), true, 'scripts/ must be ignored');
  assert.equal(await eslint.isPathIgnored('graph/langgraph/controller.mjs'), false, 'graph/langgraph/** must not be ignored');
});

// 13. lintFramework script passes when graph/langgraph does not exist
test('lintFramework: passes and reports folder does not exist yet when graph/langgraph is absent', { skip: skipMessage }, async () => {
  const { runFrameworkLint } = await import('./lint-framework.mjs');
  const res = await runFrameworkLint('graph/non-existent-langgraph');
  assert.equal(res.passed, true);
  assert.equal(res.skippedFolder, true);
});

// 14. lintFramework script correctly collects and reports skips
test('lintFramework: correctly extracts skips from fixture folder', { skip: skipMessage }, async () => {
  const { runFrameworkLint } = await import('./lint-framework.mjs');
  const res = await runFrameworkLint('graph/fixtures/framework-first/skip-with-reason');
  assert.equal(res.passed, true);
  assert.equal(res.skips.length, 1);
  assert.equal(res.skips[0].ruleId, 'no-restricted-globals');
  assert.match(res.skips[0].reason, /JUL-115/);
});
