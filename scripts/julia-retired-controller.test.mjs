import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';

const retiredPaths = [
  '../graph/controller',
  '../graph/pydantic',
  '../graph/julia-next.project.mjs',
  '../graph/rate-table.mjs',
  '../graph/rate-table.test.mjs',
  '../ops/controller',
  '../ops/sudoers',
  '../ops/orca-daemons',
  '../ops/service-dropbox/dropbox.mjs',
  '../ops/service-dropbox/dropbox.test.mjs',
  '../ops/service-dropbox/dropbox.service',
  '../ops/service-dropbox/dropbox.env.example',
  '../ops/service-dropbox/write-secret.sh',
  '../ops/service-dropbox/write-secret.test.mjs',
  '../delivery-tools.json',
  '../ops/service-dropbox/pi-models.commandcode.json',
  '../ops/service-dropbox/run-pi-seat.mjs',
  '../ops/service-dropbox/read-secret.mjs',
  '../ops/julia-runner/run-reviewer.mjs',
  '../ops/julia-runner/run-codex-builder.mjs',
  '../ops/julia-runner/run-gemini.mjs',
  '../ops/julia-runner/run-tests.mjs',
  '../ops/julia-runner/reap.py',
  '../ops/julia-runner/sudoers',
  '../graph/board-spec.mjs',
  '../graph/seat-table.mjs',
  './controller-stand-in.mjs',
  './julia-run.mjs',
  './ready-queue.mjs',
  './ready-queue.test.mjs',
  './rate-table.test.mjs',
  './check-readiness.mjs',
  './check-readiness.test.mjs',
  './orca-cli.mjs',
  './orca-cli.test.mjs',
  './orca-cli-cli.test.mjs',
  './collect-worker-result.mjs',
  './collect-worker-result.test.mjs',
  './ops-controller.test.mjs',
  './ops-sudoers.test.mjs',
  './service-dropbox.test.mjs',
  './service-dropbox-write-secret.test.mjs',
  './run-seat.mjs',
  './run-seat.test.mjs',
  './stand-in-seat.mjs',
  './stand-in-seat.test.mjs',
  './julia-minimal-runner.mjs',
  './julia-minimal-runner-adapters.mjs',
  './julia-delivery-interrupt-runner.mjs',
  './julia-review-only.mjs',
  './delivery-tool-settings.ts',
  './seat-labels.mjs',
  './julia-graph-model.mjs',
  './board-setup.mjs',
  './effort.mjs',
];

test('retired controller and OVH-only routes are not executable source or deployable config', () => {
  for (const path of retiredPaths) assert.equal(existsSync(new URL(path, import.meta.url)), false, path);
});

test('the active suite has no retired controller or OVH-only registration', () => {
  const suite = readFileSync(new URL('./julia-runner-suite.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(suite, /HISTORICAL_TESTS|controller-(?:board|carry)\.test|ops-controller|ops-sudoers|check-readiness|collect-worker-result|orca-cli|ready-queue|service-dropbox(?:-write-secret)?\.test/);
  assert.doesNotMatch(suite, /stand-in-seat\.test/);
});

test('only worker support used by the Mastra delivery path remains available', () => {
  for (const path of [
    '../ops/service-dropbox/run-agy-seat.mjs',
    '../ops/julia-runner/time-limit.mjs',
  ]) assert.equal(existsSync(new URL(path, import.meta.url)), true, path);
});

test('$init and the Mastra workflow are the only delivery start route', () => {
  const root = resolve(new URL('..', import.meta.url).pathname.slice(process.platform === 'win32' ? 1 : 0));
  const files = [];
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(?:mjs|ts)$/.test(entry.name) && !entry.name.endsWith('.test.mjs')) files.push(path);
    }
  };
  for (const directory of ['scripts', 'ops', 'graph']) walk(join(root, directory));
  const sources = files.map(path => [relative(root, path).replaceAll('\\', '/'), readFileSync(path, 'utf8')]);
  for (const [name, source] of sources) assert.doesNotMatch(source, /\b(?:runDelivery|startDelivery|startReviewOnly)\b/, name);
  const starters = sources.filter(([, source]) => /\bstartMastraDelivery\b/.test(source)).map(([name]) => name).sort();
  assert.equal(existsSync(new URL('./julia-init.mjs', import.meta.url)), false);
  assert.deepEqual(starters, ['scripts/julia-mastra-delivery.mjs']);
  assert.match(sources.find(([name]) => name === 'scripts/julia-mastra-delivery.mjs')[1], /createDeliveryWorkflowRuntime/);
});
