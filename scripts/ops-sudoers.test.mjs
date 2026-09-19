// ops-sudoers.test.mjs -- re-runs ops/sudoers's tests under CI's existing
// `node --test scripts/*.test.mjs` invocation, same pattern as
// scripts/service-dropbox-run-pi-seat.test.mjs (the publisher's App cannot edit
// ci.yml's glob). Without this wrapper the sudoers-rule guard would only run by hand.
import '../ops/sudoers/orchestrator-svc-ops.test.mjs';
