// board-spec.test.mjs -- re-runs graph/board-spec's tests under CI's existing
// `node --test scripts/*.test.mjs` invocation, same side-effect-import pattern
// as scripts/seat-table.test.mjs (see that file's header for why: the publisher
// App deliberately lacks the `workflows` permission, JUL-61 retro decision, so
// tests outside scripts/ reach CI through a one-line wrapper here, never by
// editing .github/workflows/ci.yml). Without this wrapper the board spec's own
// tests, added with the board setup (JUL-97), never ran on GitHub (JUL-98).
import '../graph/board-spec.test.mjs';
