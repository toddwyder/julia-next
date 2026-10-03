import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  selectReviewer,
  updateMastraSettingsFile,
  updateFactoryProjectModel,
  pickBuilder,
} from './pick-builder.mjs';

test('selectReviewer chooses the first reviewer with a different declared company', () => {
  const builder = { model: 'route-x/invented-maker-a/builder-alpha', company: 'maker-a' };
  const reviewers = [
    { model: 'gateway-y/invented-maker-a/rev-same', company: 'maker-a' },
    { model: 'direct/invented-maker-b/rev-beta', company: 'maker-b' },
    { model: 'direct/invented-maker-c/rev-gamma', company: 'maker-c' },
  ];

  const selected = selectReviewer(builder, reviewers);
  assert.equal(selected, 'direct/invented-maker-b/rev-beta');
});

test('selectReviewer refuses same company across different route spellings', () => {
  const builder = { model: 'alias-one/company-a/model-alpha', company: 'company-a' };
  const reviewers = [
    { model: 'alias-two/company-a/model-beta', company: 'company-a' },
    { model: 'direct-company-a-model-gamma', company: 'company-a' },
    { model: 'provider-z/company-b/model-delta', company: 'company-b' },
  ];

  const selected = selectReviewer(builder, reviewers);
  assert.equal(selected, 'provider-z/company-b/model-delta');
});

test('selectReviewer refuses a builder with undeclared company', () => {
  const reviewers = [
    { model: 'prov/maker-b/rev-1', company: 'maker-b' },
  ];

  assert.throws(
    () => selectReviewer({ model: 'prov/maker-a/builder-1' }, reviewers),
    /no declared company/i,
  );
  assert.throws(
    () => selectReviewer({ model: 'prov/maker-a/builder-1', company: '' }, reviewers),
    /no declared company/i,
  );
});

test('selectReviewer refuses a reviewer with undeclared company', () => {
  const builder = { model: 'maker-a/builder-1', company: 'maker-a' };
  const reviewers = [
    { model: 'maker-b/rev-1' }, // missing company declaration
  ];

  assert.throws(
    () => selectReviewer(builder, reviewers),
    /no declared company/i,
  );
});

test('selectReviewer refuses when no eligible reviewer from a different company exists', () => {
  const builder = { model: 'maker-a/builder-1', company: 'maker-a' };
  const reviewers = [
    { model: 'alias-1/maker-a/rev-1', company: 'maker-a' },
    { model: 'alias-2/maker-a/rev-2', company: 'maker-a' },
  ];

  assert.throws(
    () => selectReviewer(builder, reviewers),
    /no eligible reviewer.*different company/i,
  );

  assert.throws(
    () => selectReviewer(builder, []),
    /no eligible reviewer.*different company/i,
  );
});

test('updateFactoryProjectModel updates one named project via FactoryProjectsStorage', async () => {
  let updatedRecord = null;
  const mockProjectsStorage = {
    async get({ orgId, id }) {
      if (orgId === 'org-test' && id === 'proj-test-123') {
        return { id: 'proj-test-123', orgId: 'org-test', defaultModelId: 'maker-old/model-old' };
      }
      return null;
    },
    async update({ orgId, id, input }) {
      if (orgId === 'org-test' && id === 'proj-test-123') {
        updatedRecord = { id, orgId, defaultModelId: input.defaultModelId };
        return updatedRecord;
      }
      return null;
    },
  };

  const prev = await updateFactoryProjectModel('maker-new/model-new', {
    orgId: 'org-test',
    projectId: 'proj-test-123',
    projectsStorage: mockProjectsStorage,
  });

  assert.equal(prev, 'maker-old/model-old');
  assert.deepEqual(updatedRecord, {
    id: 'proj-test-123',
    orgId: 'org-test',
    defaultModelId: 'maker-new/model-new',
  });
});

test('updateFactoryProjectModel errors on missing or unknown project', async () => {
  const mockProjectsStorage = {
    async get() { return null; },
    async update() { return null; },
  };

  await assert.rejects(
    async () => updateFactoryProjectModel('maker-new/model-new', {
      orgId: 'org-test',
      projectId: '', // missing
      projectsStorage: mockProjectsStorage,
    }),
    /missing.*project/i,
  );

  await assert.rejects(
    async () => updateFactoryProjectModel('maker-new/model-new', {
      orgId: 'org-test',
      projectId: 'proj-nonexistent',
      projectsStorage: mockProjectsStorage,
    }),
    /project not found/i,
  );
});

test('updateMastraSettingsFile modifies only named helper type, refusing default', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pick-builder-helper-'));
  const settingsPath = join(dir, 'settings.json');

  try {
    const initialSettings = {
      models: {
        subagentModels: {
          default: 'initial-default-model',
          existingHelper: 'initial-helper-model',
        },
      },
    };
    writeFileSync(settingsPath, JSON.stringify(initialSettings, null, 2), 'utf8');

    // Refuses "default" as helper type
    assert.throws(
      () => updateMastraSettingsFile(settingsPath, 'default', 'maker-b/rev-1'),
      /never "default"/i,
    );

    // Updates named helper type
    const prev = updateMastraSettingsFile(settingsPath, 'reviewer-helper', 'maker-b/rev-1');
    assert.equal(prev, undefined);

    const updated = JSON.parse(readFileSync(settingsPath, 'utf8'));
    assert.equal(updated.models.subagentModels['reviewer-helper'], 'maker-b/rev-1');
    assert.equal(updated.models.subagentModels.default, 'initial-default-model'); // Unchanged!
    assert.equal(updated.models.subagentModels.existingHelper, 'initial-helper-model');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pickBuilder rolls back project model if settings update fails, identifying failed setting and project', async () => {
  let projectModel = 'maker-initial/builder-initial';
  const projectId = 'proj-target-456';
  const orgId = 'org-target-789';

  const mockProjectsStorage = {
    async get({ id }) {
      if (id === projectId) return { id, orgId, defaultModelId: projectModel };
      return null;
    },
    async update({ id, input }) {
      if (id === projectId) {
        projectModel = input.defaultModelId;
        return { id, orgId, defaultModelId: projectModel };
      }
      return null;
    },
  };

  const failingSettingsUpdater = () => {
    throw new Error('Simulated settings disk failure');
  };

  await assert.rejects(
    async () => pickBuilder('maker-a/builder-new', {
      orgId,
      projectId,
      helperType: 'adversarial-reviewer',
      builderCatalog: [{ model: 'maker-a/builder-new', company: 'maker-a' }],
      reviewerList: [{ model: 'maker-b/reviewer-new', company: 'maker-b' }],
      projectsStorage: mockProjectsStorage,
      settingsUpdater: failingSettingsUpdater,
    }),
    (err) => {
      assert.match(err.message, /proj-target-456/);
      assert.match(err.message, /adversarial-reviewer/);
      assert.match(err.message, /rolled back/i);
      return true;
    },
  );

  // Verified that project model was rolled back to initial value
  assert.equal(projectModel, 'maker-initial/builder-initial');
});

test('pickBuilder succeeds with readback verification across project and settings', async () => {
  let projectModel = 'maker-initial/builder-initial';
  let settingsState = { 'reviewer-helper': 'maker-initial/reviewer-initial' };
  const projectId = 'proj-target-456';
  const orgId = 'org-target-789';

  const mockProjectsStorage = {
    async get({ id }) {
      if (id === projectId) return { id, orgId, defaultModelId: projectModel };
      return null;
    },
    async update({ id, input }) {
      if (id === projectId) {
        projectModel = input.defaultModelId;
        return { id, orgId, defaultModelId: projectModel };
      }
      return null;
    },
  };

  const mockSettingsUpdater = async (type, model) => {
    settingsState[type] = model;
    return 'maker-initial/reviewer-initial';
  };

  const mockSettingsReader = (type) => settingsState[type];

  const result = await pickBuilder('maker-a/builder-new', {
    orgId,
    projectId,
    helperType: 'reviewer-helper',
    builderCatalog: [{ model: 'maker-a/builder-new', company: 'maker-a' }],
    reviewerList: [
      { model: 'maker-a/rev-same', company: 'maker-a' },
      { model: 'maker-b/reviewer-new', company: 'maker-b' },
    ],
    projectsStorage: mockProjectsStorage,
    settingsUpdater: mockSettingsUpdater,
    settingsReader: mockSettingsReader,
  });

  assert.equal(result.builder, 'maker-a/builder-new');
  assert.equal(result.reviewer, 'maker-b/reviewer-new');
  assert.equal(result.helperType, 'reviewer-helper');
  assert.equal(result.projectId, projectId);
  assert.equal(projectModel, 'maker-a/builder-new');
  assert.equal(settingsState['reviewer-helper'], 'maker-b/reviewer-new');
});
