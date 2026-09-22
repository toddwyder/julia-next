// agent-trust.test.mjs -- JUL-98 step 6: the agent trust list, the thing that
// has to be written BEFORE a worker is started into a brand-new worktree.
//
// MEASURED, not assumed. On 2026-09-22 a fresh folder was opened with `agy` on
// this host and the TUI asked "Do you trust the contents of this project?"
// before it would do anything. Answering yes wrote exactly one file:
//
//   /home/runner/.gemini/antigravity-cli/settings.json
//   {"trustedWorkspaces":["<the folder's absolute path>"]}
//
// That is the same failure shape as Claude Code's folder-trust screen, which
// held a builder for about eight hours on 19-20 September: Orca reports
// `input_accepted`, no turn ever begins, and nothing says why.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TRUST_STORES, trustStoreFor, hasTrustStore, addTrustedWorkspace } from '../graph/controller/agent-trust.mjs';

const WORKTREE = '/home/runner/orca/workspaces/julia-next/jul98-step-6-a1';

test('the agy trust store is the file and key the live probe wrote', () => {
  assert.deepEqual(TRUST_STORES.agy, { file: '.gemini/antigravity-cli/settings.json', key: 'trustedWorkspaces' });
  assert.equal(trustStoreFor('agy'), TRUST_STORES.agy);
});

test('an agent with no known trust store is refused by name, never silently skipped', () => {
  assert.throws(() => trustStoreFor('potato'), /potato/);
});

// Pi ran in fresh worktrees throughout JUL-109 and never asked a folder-trust
// question, so it has no trust list -- and "no list" is a fact to be asked for,
// not a throw to be caught.
test('an agent that asks no folder-trust question is said to have no store, rather than throwing', () => {
  assert.equal(hasTrustStore('agy'), true);
  assert.equal(hasTrustStore('pi'), false);
  assert.equal(hasTrustStore('potato'), false);
});

test('a worktree is added to an empty store', () => {
  const { text, added } = addTrustedWorkspace({ agent: 'agy', text: '', worktreePath: WORKTREE });
  assert.equal(added, true);
  assert.deepEqual(JSON.parse(text), { trustedWorkspaces: [WORKTREE] });
});

test('it is idempotent, so a second attempt on the same card writes nothing new', () => {
  const first = addTrustedWorkspace({ agent: 'agy', text: '{}', worktreePath: WORKTREE });
  const second = addTrustedWorkspace({ agent: 'agy', text: first.text, worktreePath: WORKTREE });
  assert.equal(second.added, false);
  assert.deepEqual(JSON.parse(second.text).trustedWorkspaces, [WORKTREE]);
});

test('everything else in the settings file survives -- this file is the agent\'s, not ours', () => {
  const existing = JSON.stringify({ trustedWorkspaces: ['/some/other/place'], statusline: true });
  const { text } = addTrustedWorkspace({ agent: 'agy', text: existing, worktreePath: WORKTREE });
  const parsed = JSON.parse(text);
  assert.deepEqual(parsed.trustedWorkspaces, ['/some/other/place', WORKTREE]);
  assert.equal(parsed.statusline, true);
});

test('a settings file that will not parse is REFUSED, never overwritten', () => {
  assert.throws(
    () => addTrustedWorkspace({ agent: 'agy', text: '{ not json', worktreePath: WORKTREE }),
    /could not be read as JSON/,
  );
});

test('a relative path is refused: the trust entry is keyed by the exact absolute path', () => {
  assert.throws(
    () => addTrustedWorkspace({ agent: 'agy', text: '{}', worktreePath: 'jul98-step-6-a1' }),
    /absolute/,
  );
});
