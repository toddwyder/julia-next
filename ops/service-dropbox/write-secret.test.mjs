// write-secret.test.mjs -- write-secret.sh runs as root on the server via a
// narrow sudo rule (see README.md); it isn't exec'd here (that would need
// root and the real destination directory). Instead this is a static check,
// the same style as ci.yml's own grep-based hardening checks, asserting the
// script's field->group routing matches dropbox.mjs's FIELD_GROUPS exactly
// -- the two must never drift apart (see dropbox.test.mjs's own comment on
// FIELD_GROUPS for why this pairing exists).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { FIELDS, FIELD_GROUPS } from './dropbox.mjs';

function scriptText() {
  // Normalize CRLF -> LF: this file is committed as LF (a shell script run
  // on Linux), but a Windows checkout with core.autocrlf can materialize it
  // locally as CRLF, which would otherwise break the [^;]* regexes below.
  return readFileSync(new URL('./write-secret.sh', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

test('write-secret.sh routes every FIELD_GROUPS field to its exact destination file and group', () => {
  const text = scriptText();
  for (const [field, group] of Object.entries(FIELD_GROUPS)) {
    const caseRe = new RegExp(`\\b${field}\\)[^\\n]*DEST="\\$DEST_DIR/${field}\\.env"[^\\n]*GROUP=${group}\\b`);
    assert.match(text, caseRe, `write-secret.sh must route field '${field}' to ${field}.env owned by group ${group}`);
  }
});

test('write-secret.sh chowns the temp file to root:$GROUP, never a hard-coded group', () => {
  const text = scriptText();
  assert.match(text, /chown root:"\$GROUP" "\$TMP"/, 'the chown must use the per-field $GROUP variable, not a fixed group');
});

// A replacement (Todd pastes a new value over a saved one) must leave exactly
// one copy: the new value written to a temp file, then moved over the old file.
// mv -n or noclobber would silently keep the old value; a second file name
// would leave the old value lying around.
test('write-secret.sh replaces the destination in place, so a new value overwrites the old one', () => {
  const text = scriptText();
  assert.match(text, /mv -f "\$TMP" "\$DEST"/, 'the temp file is moved over the destination');
  assert.doesNotMatch(text, /noclobber|mv -n|mv -i|cp -n/, 'nothing may refuse to overwrite an existing file');
});

// Tripwire (JUL-62): the script is a root-run helper, so what matters as much
// as "every field is routed" is that NOTHING ELSE is. It names exactly the
// fixed destination files below the fixed directory, takes no path from its
// caller, and refuses any field it does not know. (The 17 Sep CI step checked
// four names; the set is now every entry in FIELDS, so this follows FIELDS.)
test('write-secret.sh names exactly the fixed destination files for FIELDS, and no others', () => {
  const text = scriptText();
  const assigned = [...text.matchAll(/\bDEST="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(
    assigned.sort(),
    FIELDS.map((f) => `$DEST_DIR/${f}.env`).sort(),
    'every DEST assignment must be $DEST_DIR/<field>.env for a field in FIELDS, one each',
  );
});

test('write-secret.sh writes only below one fixed directory and never takes a path from its caller', () => {
  const text = scriptText();
  assert.match(text, /^DEST_DIR=\/etc\/orca-runner\/dropbox-secrets$/m, 'DEST_DIR must be the one fixed literal path');
  assert.equal((text.match(/^DEST_DIR=/gm) ?? []).length, 1, 'DEST_DIR must be set once');
  // The caller's argument is read once, into FIELD, and only ever selects a case arm.
  assert.equal((text.match(/\$\{?[1-9@*]/g) ?? []).length, 1, 'the script may read its argument in exactly one place');
  assert.match(text, /^FIELD="\$\{1:-\}"$/m);
  for (const line of text.split('\n').filter((l) => /\bDEST=/.test(l))) {
    assert.doesNotMatch(line, /\$FIELD|\$\{FIELD|\$1|\$\{1|\$\(|`/, `DEST must not be built from caller input: ${line}`);
  }
  assert.doesNotMatch(text, /^\s*(DEST|DEST_DIR|TMP)=.*\$(FIELD|1)\b/m);
});

test('write-secret.sh refuses any field it does not know', () => {
  const text = scriptText();
  assert.match(text, /^\s*\*\)\s*\n[^\n]*unknown field[^\n]*\n\s*exit 1\s*\n\s*;;/m, 'the default case arm must refuse with exit 1');
});
