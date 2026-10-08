// One discovery boundary for the laptop and JUL-197's Windows CI gate.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNNER_TEST = /(?:^|\/)julia-(?:init|delivery|graph-model|minimal-runner|runner).*\.test\.mjs$/;
const SHARED_TESTS = new Set([
  'acceptance-check', 'delivery-tool-settings', 'effort', 'linear-cli',
  'no-personal-paths', 'personal-paths', 'line-endings', 'verify-reviewer-worktree',
  'seat-labels', 'seat-table', 'service-dropbox-run-agy-seat',
  'service-dropbox-run-pi-seat', 'service-dropbox-read-secret', 'ci-routing',
].map((name) => `scripts/${name}.test.mjs`));
// Evidence and generated/vendor trees are never executable source. In particular,
// do not recurse into .julia's saved copies or mutate them to make discovery pass.
const GENERATED = new Set(['.git', '.julia', '.next', '.mastra', '.artifacts', 'node_modules', 'test-results', 'playwright-report']);
const RUNNER_IMPORT = /(?:from\s*|import\s*\(?\s*)['"][^'"]*(?:julia-(?:init|delivery|graph-model|minimal-runner|runner)|delivery-tool-settings|ops\/julia-runner\/)[^'"]*['"]/;

export function discoverRunnerTests(root = process.cwd()) {
  const files = [];
  function walk(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        if (!GENERATED.has(entry.name)) walk(join(directory, entry.name), `${path}/`);
      } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        // Factory keeps its own JUL-197 gate; a shared import cannot pull its
        // Linux sandbox/dependency setup into the Windows runner gate.
        if (path.startsWith('ops/factory/')) continue;
        if (RUNNER_TEST.test(path) || path.startsWith('ops/julia-runner/') || SHARED_TESTS.has(path)
          || RUNNER_IMPORT.test(readFileSync(join(root, path), 'utf8'))) files.push(path);
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
