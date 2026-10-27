import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ON_PROOF_PROJECT, PROOF_PROJECT_ID, resolveConfig, usesProofProject } from './firebase-project.js';

const HOUSEHOLD = { apiKey: 'k', authDomain: 'julia-household.firebaseapp.com', projectId: 'julia-household', appId: '1:1:web:1' };
const FROM_ENV = { apiKey: 'env-k', authDomain: 'env.firebaseapp.com', projectId: PROOF_PROJECT_ID, appId: '1:1:web:2' };

test('the emulators win over every config, so a local run never touches a real project', () => {
  const config = resolveConfig({ emulated: true, envConfig: FROM_ENV, household: HOUSEHOLD });
  assert.equal(config.projectId, 'demo-julia');
});

test('a complete set of environment values points the build at that project', () => {
  assert.deepEqual(resolveConfig({ emulated: false, envConfig: FROM_ENV, household: HOUSEHOLD }), FROM_ENV);
});

test('without environment values the household project in the repo is used', () => {
  assert.deepEqual(resolveConfig({ emulated: false, envConfig: null, household: HOUSEHOLD }), HOUSEHOLD);
});

test('with no project anywhere the build says so instead of pretending', () => {
  assert.equal(resolveConfig({ emulated: false, envConfig: null, household: null }), null);
});

test('the test-user door opens only on the proof project', () => {
  assert.equal(usesProofProject(FROM_ENV), true);
  assert.equal(usesProofProject(HOUSEHOLD), false);
  assert.equal(usesProofProject({ projectId: 'demo-julia' }), false);
  assert.equal(usesProofProject(null), false);
});

test('this working tree is not a proof build', () => {
  assert.equal(ON_PROOF_PROJECT, false);
});
