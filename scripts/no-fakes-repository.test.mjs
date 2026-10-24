import assert from 'node:assert/strict';
import test from 'node:test';

import { checkNoFakes } from './check-no-fakes.mjs';

test('no test in the repository stands in for an outside service', () => {
  assert.deepEqual(checkNoFakes({ all: true }), []);
});
