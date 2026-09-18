// service-dropbox-read-secret.test.mjs -- re-runs ops/service-dropbox's
// read-secret tests under CI's existing `node --test scripts/*.test.mjs`
// invocation, same side-effect-import pattern as service-dropbox.test.mjs
// (see that file's own header for why: the publisher App deliberately
// lacks the `workflows` permission, JUL-61 retro decision, so this repo's
// tests reach CI by living under scripts/*.test.mjs, never by editing
// .github/workflows/ci.yml).
import '../ops/service-dropbox/read-secret.test.mjs';
