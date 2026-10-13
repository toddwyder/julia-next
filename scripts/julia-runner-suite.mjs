// One discovery boundary for the laptop and JUL-197's Windows CI gate.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNNER_TEST = /(?:^|\/)julia-(?:init|delivery|graph-model|minimal-runner|runner).*\.test\.mjs$/;
const SHARED_TESTS = new Set([
  'acceptance-check', 'delivery-tool-settings', 'effort', 'linear-cli',
  'no-personal-paths', 'personal-paths', 'line-endings', 'verify-reviewer-worktree',
  'seat-labels', 'ci-routing',
].map((name) => `scripts/${name}.test.mjs`).concat([
  'graph/seat-table.test.mjs', 'ops/service-dropbox/run-agy-seat.test.mjs',
  'ops/service-dropbox/run-pi-seat.test.mjs', 'ops/service-dropbox/read-secret.test.mjs',
]));
// Explicitly inventoried non-runner tests retain their existing CI/manual owner.
// Unknown tests default to execution so a new subprocess-only regression cannot
// trigger the Windows job and then silently disappear from its file list.
const NON_RUNNER_TESTS = new Set([
  'scripts/agent-docs.test.mjs',
  'scripts/board-setup.test.mjs', 'scripts/board-spec.test.mjs',
  'scripts/dynamic-route.test.mjs', 'scripts/framework-lint.test.mjs', 'scripts/health-route.test.mjs',
  'scripts/merge-pr.test.mjs',
  'scripts/publish-pr.real-git.test.mjs', 'scripts/publish-pr.test.mjs',
  'scripts/publish-via-github-app.test.mjs',
  'scripts/seat-table.test.mjs', 'scripts/service-dropbox-read-secret.test.mjs',
  'scripts/service-dropbox-run-agy-seat.test.mjs', 'scripts/service-dropbox-run-pi-seat.test.mjs',
  'scripts/web-app.test.mjs',
]);
// Evidence and generated/vendor trees are never executable source. In particular,
// do not recurse into .julia's saved copies or mutate them to make discovery pass.
const GENERATED = new Set(['.git', '.julia', '.next', '.mastra', '.artifacts', 'node_modules', 'test-results', 'playwright-report']);
const IMPORT_SPECIFIER = /(?:from\s*|import\s*\(?\s*)['"]([^'"]+)['"]/g;
const RUNNER_MODULE = /julia-(?:init|delivery|graph-model|minimal-runner|runner)|delivery-tool-settings|acceptance-check|linear-cli|effort|seat-labels|seat-table|verify-reviewer-worktree|line-endings|no-personal-paths|personal-paths|ops\/julia-runner\/|run-agy-seat|run-pi-seat|read-secret/;

function importsRunnerModule(text) {
  return [...text.matchAll(IMPORT_SPECIFIER)].some(([, path]) => !path.endsWith('.test.mjs') && RUNNER_MODULE.test(path));
}

export function discoverRunnerTests(root = process.cwd()) {
  const files = [];
  function walk(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        if (!GENERATED.has(entry.name)) walk(join(directory, entry.name), `${path}/`);
      } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        if (RUNNER_TEST.test(path) || path.startsWith('ops/julia-runner/') || SHARED_TESTS.has(path)
          || importsRunnerModule(readFileSync(join(root, path), 'utf8')) || !NON_RUNNER_TESTS.has(path)) files.push(path);
      }
    }
  }
  walk(root);
  return files.sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = discoverRunnerTests();
  if (!files.length) {
    console.error('runner suite: no active runner tests discovered; refusing an empty gate');
    process.exitCode = 1;
  } else {
    console.log(`Runner suite: ${files.length} files\n${files.join('\n')}`);
    if (process.argv[2] !== '--list') {
      // A nested Node test invocation must not inherit NODE_TEST_CONTEXT; it
      // otherwise returns success without running tests. No shell/glob expansion.
      const { NODE_TEST_CONTEXT: _context, ...env } = process.env;
      const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { stdio: 'inherit', env });
      if (result.error) console.error(`runner suite: unable to start tests: ${result.error.message}`);
      process.exitCode = result.status ?? 1;
    }
  }
}
