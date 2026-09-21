// Guards the repo's line-ending rule (.gitattributes). Without the rule,
// Windows checkouts (autocrlf) show hundreds of files as changed when only their
// line endings differ, and a file can be committed with CRLF (the coordinator
// skill was) -- which then rewrites the whole file on the next edit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('.gitattributes sets LF for every text file, and for the files installed on the server', () => {
  const rules = readFileSync(new URL('../.gitattributes', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
    .map((line) => line.trim().split(/\s+/));
  const has = (pattern, ...attrs) => rules.some(([p, ...a]) => p === pattern && attrs.every((x) => a.includes(x)));
  assert.ok(has('*', 'text=auto', 'eol=lf'), 'the catch-all rule must be `* text=auto eol=lf`');
  assert.ok(has('*.sh', 'text', 'eol=lf'), 'shell scripts installed on the server must be LF');
  assert.ok(has('ops/sudoers/*', 'text', 'eol=lf'), 'sudoers rules must be LF');
});

test('no tracked text file is committed with CRLF line endings', (t) => {
  let listing;
  try {
    listing = execFileSync('git', ['ls-files', '--eol'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return t.skip('not inside a git checkout');
  }
  const offenders = listing
    .split(/\r?\n/)
    .filter((line) => /^i\/(crlf|mixed)\b/.test(line))
    .map((line) => line.split('\t')[1]);
  assert.deepEqual(offenders, [], `committed with CRLF (renormalize with \`git add --renormalize <file>\`): ${offenders.join(', ')}`);
});
