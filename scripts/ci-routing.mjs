import { execFileSync, spawnSync } from 'node:child_process';

const GATES = ['baseline', 'julia-init-windows', 'factory', 'database', 'web', 'docs-policy'];

const GATE_PATHS = {
  'julia-init-windows': [
    /^scripts\/(?:.*\/)?julia-(?:init|delivery|graph-model|minimal-runner|runner)/,
    /^scripts\/(?:delivery-tool-settings|acceptance-check|linear-cli|effort|seat-labels|seat-table|verify-reviewer-worktree|line-endings|no-personal-paths|personal-paths|service-dropbox-(?:run-agy-seat|run-pi-seat|read-secret))\./,
    /^ops\/julia-runner\//, /^ops\/service-dropbox\/(?:run-agy-seat|run-pi-seat|read-secret)\./,
    /^graph\/seat-table\./, /^delivery-tools\.json$/, /^\.(?:agents|claude)\/skills\/implement\//,
    /^docs\/agents\/(?:init|work-execution|runner-tests)\.md$/,
  ],
  factory: [/^ops\/factory\//, /^scripts\/factory-/],
  database: [/^ops\/factory\/model-face-values\./],
  web: [/^(?:app|lib)\//, /^(?:next\.config|playwright\.config)/, /^tests\//, /^scripts\/(?:health-route|dynamic-route|web-app|framework-lint)\./],
  'docs-policy': [/^docs\//, /^scripts\/(?:agent-docs|line-endings|no-personal-paths|personal-paths|merge-pr|publish-pr|publish-via-github-app)\./],
};

const HIGH_RISK_PATHS = [/^\.github\/workflows\//, /^(?:package(?:-lock)?\.json|scripts\/ci-routing(?:\.test)?\.mjs)$/];

export function selectCIGates(paths) {
  const selected = new Set(['baseline']);
  if (paths.some((path) => HIGH_RISK_PATHS.some((pattern) => pattern.test(path)))) return GATES;
  for (const [gate, patterns] of Object.entries(GATE_PATHS)) {
    if (paths.some((path) => patterns.some((pattern) => pattern.test(path)))) selected.add(gate);
  }
  // New/unwrapped MJS regressions may import runner behavior without adopting
  // its filename prefix. Conservatively run Windows for those paths, including
  // deletions. Existing focused Factory, web-script and policy owners stay put.
  if (paths.some((path) => path.endsWith('.test.mjs')
    && !GATE_PATHS.factory.some((pattern) => pattern.test(path))
    && !GATE_PATHS['docs-policy'].some((pattern) => pattern.test(path))
    && !(/^scripts\//.test(path) && GATE_PATHS.web.some((pattern) => pattern.test(path))))) selected.add('julia-init-windows');
  return GATES.filter((gate) => selected.has(gate));
}

function changedPaths(base, head, diffFilter = '') {
  const args = ['diff', '--name-only', '--no-renames'];
  if (diffFilter) args.push(`--diff-filter=${diffFilter}`);
  return execFileSync('git', [...args, base, head], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
}

function syntaxCheckChangedModules(base, head) {
  for (const file of changedPaths(base, head, 'd').filter((path) => /^(?:scripts|ops)\/.*\.mjs$/.test(path))) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

function writeGitHubOutput(gates) {
  for (const gate of GATES) console.log(`${gate.replaceAll('-', '_')}=${gates.includes(gate)}`);
}

const [command, base, head] = process.argv.slice(2);
if (command === '--github-output') writeGitHubOutput(selectCIGates(changedPaths(base, head)));
if (command === '--syntax-check') syntaxCheckChangedModules(base, head);
