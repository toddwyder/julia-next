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

import { FIELD_GROUPS } from './dropbox.mjs';

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
