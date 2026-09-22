// service-dropbox-run-agy-seat.test.mjs -- re-runs ops/service-dropbox's
// run-agy-seat tests under CI's existing `node --test scripts/*.test.mjs`
// invocation, the same side-effect-import pattern as
// service-dropbox-run-pi-seat.test.mjs (the publisher's App lacks the
// `workflows` permission, so the ops test file can never be added to
// ci.yml's glob directly). Without this wrapper the seat tests would only
// ever run when someone remembered to invoke them by hand.
import '../ops/service-dropbox/run-agy-seat.test.mjs';
