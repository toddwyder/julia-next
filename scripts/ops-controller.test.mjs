// ops-controller.test.mjs -- re-runs ops/controller's unit-file tests under CI's
// existing `node --test scripts/*.test.mjs` invocation (see
// scripts/test-wrappers.test.mjs for why the wrapper is needed).
import '../ops/controller/units.test.mjs';
