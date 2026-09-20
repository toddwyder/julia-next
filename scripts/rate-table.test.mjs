// rate-table.test.mjs -- re-runs graph/rate-table's tests under CI's existing
// `node --test scripts/*.test.mjs` invocation, same side-effect-import pattern
// as scripts/seat-table.test.mjs (see that file's header for why).
import '../graph/rate-table.test.mjs';
