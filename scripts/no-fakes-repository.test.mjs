import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { checkNoFakes } from './check-no-fakes.mjs';

function baseCommit() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && existsSync(eventPath)) {
    const event = JSON.parse(readFileSync(eventPath, 'utf8'));
    if (event.pull_request?.base?.sha) return event.pull_request.base.sha;
    if (event.before && !/^0+$/.test(event.before)) return event.before;
  }
  try {
    return execFileSync('git', ['rev-parse', '--verify', 'HEAD^'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function hasCommit(sha) {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    try {
      execFileSync('git', ['fetch', '--depth=1', 'origin', sha], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}

test('changed tests do not stand in for an outside service', () => {
  const base = baseCommit();
  if (!base) return;
  if (!hasCommit(base)) {
    if (process.env.CI) assert.fail(`Could not fetch base commit ${base} to check changed tests.`);
    return;
  }
  assert.deepEqual(checkNoFakes({ base }), []);
});
