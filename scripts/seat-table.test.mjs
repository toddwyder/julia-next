// seat-table.test.mjs -- re-runs graph/seat-table's tests under CI's existing
// `node --test scripts/*.test.mjs` invocation, same side-effect-import pattern
// as scripts/service-dropbox-run-pi-seat.test.mjs (see that file's own header
// for why: the publisher App deliberately lacks the `workflows` permission,
// JUL-61 retro decision, so this repo's tests reach CI by living under
// scripts/*.test.mjs, never by editing .github/workflows/ci.yml). Without this
// wrapper the seat-table family guard -- the safety-critical part of the
// seat-selection change -- would only ever run by hand.
import '../graph/seat-table.test.mjs';
