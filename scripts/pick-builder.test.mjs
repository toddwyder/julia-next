import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getMaker,
  selectReviewer,
  pickBuilder,
  updateMastraSettingsFile,
} from './pick-builder.mjs';

test('getMaker extracts company from 2-part and multi-part model identifiers', () => {
  assert.equal(getMaker('acme/model-alpha'), 'acme');
  assert.equal(getMaker('gateway-x/brand-b/model-beta'), 'brand-b');
  assert.equal(getMaker('custom-prov/company-c/sub/model-gamma'), 'company-c');
  assert.equal(getMaker('SoloModel'), 'solomodel');
});

test('selectReviewer chooses the first reviewer from a different company than the builder', () => {
  const builder = 'company-a/builder-x';
  const reviewerList = [
    'company-b/reviewer-1',
    'company-c/reviewer-2',
  ];

  const selected = selectReviewer(builder, reviewerList);
  assert.equal(selected, 'company-b/reviewer-1');
});

test('selectReviewer skips same-company reviewers regardless of provider gateway prefixes', () => {
  const builder = 'company-a/builder-x';
  const reviewerList = [
    'company-a/reviewer-same',
    'gateway-z/company-a/reviewer-also-same',
    'gateway-y/company-b/reviewer-different',
    'company-c/reviewer-third',
  ];

  const selected = selectReviewer(builder, reviewerList);
  assert.equal(selected, 'gateway-y/company-b/reviewer-different');
});

test('selectReviewer throws if all reviewers are from the same company as builder', () => {
  const builder = 'company-a/builder-x';
  const reviewerList = [
    'company-a/reviewer-1',
    'gateway-z/company-a/reviewer-2',
  ];

  assert.throws(
    () => selectReviewer(builder, reviewerList),
    /no reviewer.*different company/i,
  );
});

test('selectReviewer throws if reviewer list is empty', () => {
  assert.throws(
    () => selectReviewer('company-a/builder-x', []),
    /no reviewer.*different company/i,
  );
});

test('pickBuilder updates both project model and Mastra reviewer helper setting', async () => {
  let updatedProjectModel = null;
  let updatedReviewerHelper = null;

  const mockProjectUpdater = async (model) => {
    updatedProjectModel = model;
  };

  const mockSettingsUpdater = async (model) => {
    updatedReviewerHelper = model;
  };

  const result = await pickBuilder('company-a/builder-x', {
    reviewerList: ['company-a/rev-1', 'company-b/rev-2'],
    projectUpdater: mockProjectUpdater,
    settingsUpdater: mockSettingsUpdater,
  });

  assert.equal(result.builder, 'company-a/builder-x');
  assert.equal(result.reviewer, 'company-b/rev-2');
  assert.equal(updatedProjectModel, 'company-a/builder-x');
  assert.equal(updatedReviewerHelper, 'company-b/rev-2');
});

test('updateMastraSettingsFile modifies models.subagentModels.default preserving other settings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pick-builder-test-'));
  const settingsPath = join(dir, 'settings.json');

  try {
    const initialSettings = {
      models: {
        activeModelPackId: null,
        subagentModels: {
          existing: 'some-model',
        },
      },
      preferences: {
        theme: 'dark',
      },
    };
    writeFileSync(settingsPath, JSON.stringify(initialSettings, null, 2), 'utf8');

    updateMastraSettingsFile(settingsPath, 'company-b/rev-2');

    const updated = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(updated.models.subagentModels.default, 'company-b/rev-2');
    assert.equal(updated.models.subagentModels.existing, 'some-model');
    assert.equal(updated.preferences.theme, 'dark');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
