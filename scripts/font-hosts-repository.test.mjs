import assert from 'node:assert/strict';
import test from 'node:test';

import { checkFontHosts } from './check-font-hosts.mjs';

test('no font in either app comes from outside the repository', () => {
  assert.deepEqual(checkFontHosts({ root: new URL('..', import.meta.url).pathname }), []);
});
