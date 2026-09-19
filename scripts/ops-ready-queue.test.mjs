// ops-ready-queue.test.mjs -- re-runs ops/ready-queue's unit-file tests under CI's
// existing `node --test scripts/*.test.mjs` invocation (see
// scripts/service-dropbox-run-pi-seat.test.mjs for why the wrapper is needed).
import '../ops/ready-queue/units.test.mjs';
