import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
];

test('retired controller and OVH-only routes are not executable source or deployable config', () => {
  for (const path of retiredPaths) assert.equal(existsSync(new URL(path, import.meta.url)), false, path);
});

test('the active suite has no retired controller or OVH-only registration', () => {
  const suite = readFileSync(new URL('./julia-runner-suite.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(suite, /HISTORICAL_TESTS|controller-(?:board|carry)\.test|stand-in-seat\.test|ops-controller|ops-sudoers|check-readiness|collect-worker-result|orca-cli|ready-queue|service-dropbox(?:-write-secret)?\.test/);
});

test('worker support that does not orchestrate delivery remains available', () => {
  for (const path of [
    '../ops/service-dropbox/run-pi-seat.mjs',
    '../ops/service-dropbox/run-agy-seat.mjs',
    '../ops/service-dropbox/read-secret.mjs',
    '../graph/seat-table.mjs',
    './seat-labels.mjs',
    './julia-graph-model.mjs',
    './board-setup.mjs',
    '../ops/julia-runner/run-reviewer.mjs',
  ]) assert.equal(existsSync(new URL(path, import.meta.url)), true, path);
});

test('$init and the Mastra workflow are the only delivery start route', () => {
  const directory = new URL('.', import.meta.url);
  const sources = readdirSync(directory).filter(name => name.endsWith('.mjs') && !name.endsWith('.test.mjs'))
    .map(name => [name, readFileSync(new URL(name, directory), 'utf8')]);
  for (const [name, source] of sources) assert.doesNotMatch(source, /\b(?:runDelivery|startDelivery|startReviewOnly)\b/, name);
  assert.match(sources.find(([name]) => name === 'julia-init.mjs')[1], /startMastraDelivery/);
  assert.match(sources.find(([name]) => name === 'julia-mastra-delivery.mjs')[1], /createDeliveryWorkflowRuntime/);
});
