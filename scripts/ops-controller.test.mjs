// ops-controller.test.mjs -- re-runs ops/controller's unit-file tests under CI's
// existing `node --test scripts/*.test.mjs` invocation (see
// retained historical controller checks; the active runner gate is separate).
import '../ops/controller/units.test.mjs';
