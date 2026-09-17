// service-dropbox.test.mjs -- re-runs ops/service-dropbox's own tests under
// CI's existing `node --test scripts/*.test.mjs` invocation.
//
// The publisher's GitHub App deliberately lacks the `workflows` permission
// (JUL-61 retro decision: the machine must not be able to edit its own CI),
// so ops/service-dropbox/*.test.mjs can never be added directly to
// .github/workflows/ci.yml's own glob. This file is a side-effect import
// instead: node:test's `test()` calls in dropbox.test.mjs register against
// the same global runner regardless of which file triggered the import, so
// CI picks them up without the workflow file ever changing.
import '../ops/service-dropbox/dropbox.test.mjs';
