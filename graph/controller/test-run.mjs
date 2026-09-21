// test-run.mjs -- JUL-98 step 3, item 4: the test suite runs ONCE, run by the
// controller, and one result goes to both seats.
//
// THE RULE. Not the builder, not the reviewer, and never twice. The builder may
// run tests while it works -- its skill says so -- but the run that COUNTS is
// this one, and neither seat's word for it is ever accepted. `createSuiteRunner`
// makes that mechanical: the run is keyed by step, a second `runOnce` for the
// same step returns the first result (marked `replayed`) without executing
// anything, and `resultFor` hands both seats the very same object.
//
// It is a plain command in the candidate worktree, not a supervised agent and
// not an Orca call: `node --test scripts/*.test.mjs`, run through a shell
// because the glob is the shell's. That is the same command CI runs and the
// same one this repo's contributors run.
//
// WHAT IS RECORDED, because the card asks for it beside the cost line: the
// start time, the end time and the pass/fail counts, read out of the run's own
// TAP summary. Output with no summary is a refusal, never a silent pass -- a
// suite that failed to start prints no counts at all, and calling that "0 fail"
// would be the worst possible lie to put on a card.

export const SUITE_COMMAND = 'node --test scripts/*.test.mjs';

const COUNT_LINE = /^#\s+(tests|pass|fail|skipped|todo|cancelled)\s+(\d+)\s*$/gm;

// The TAP summary node's test runner prints at the end of a run.
export function parseTapSummary(output) {
  const counts = {};
  for (const match of String(output ?? '').matchAll(COUNT_LINE)) {
    counts[match[1]] = Number(match[2]);
  }
  if (counts.tests === undefined || counts.pass === undefined || counts.fail === undefined) {
    throw new Error(`the test run printed no TAP summary (no "# tests"/"# pass"/"# fail" lines), so this step has no test result: ${String(output ?? '').slice(-300)}`);
  }
  return {
    total: counts.tests,
    pass: counts.pass,
    fail: counts.fail,
    skipped: counts.skipped ?? 0,
    todo: counts.todo ?? 0,
    cancelled: counts.cancelled ?? 0,
    ok: counts.fail === 0,
  };
}

function shortStamp(iso) {
  // 2026-09-21T14:00:03.110Z -> 14:00:03Z, the form the card's other lines use.
  return String(iso ?? '').slice(11, 19) + 'Z';
}

// The line the controller posts on the card, next to that step's cost lines.
export function testRunLine(result) {
  const counts = `${result.pass} pass, ${result.fail} fail, ${result.skipped} skipped of ${result.total}`;
  const seconds = (result.durationMs / 1000).toFixed(1);
  return `**Tests** (run once by the controller): ${shortStamp(result.startedAt)}-${shortStamp(result.endedAt)}, ${seconds}s -- ${counts}. \`${result.command}\` in \`${result.worktree}\`.`;
}

// The default runner: a plain shell command in the worktree. Injected in every
// test; nothing here spawns anything when the caller supplies its own.
async function defaultExecImpl({ command, cwd }) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  return execFileAsync('sh', ['-c', command], { cwd, maxBuffer: 64 * 1024 * 1024 });
}

export function createSuiteRunner({
  execImpl = defaultExecImpl,
  command = SUITE_COMMAND,
  now = () => new Date().toISOString(),
} = {}) {
  const results = new Map();

  return {
    async runOnce({ key, worktree }) {
      if (results.has(key)) {
        // The suite must never run twice for one step. A repeat says so rather
        // than quietly handing back a result that looks freshly measured.
        return { ...results.get(key), replayed: true };
      }
      const startedAt = now();
      let stdout;
      let exitCode = 0;
      try {
        ({ stdout } = await execImpl({ command, cwd: worktree }));
      } catch (error) {
        // `node --test` exits non-zero when a test fails: that is a RESULT, not
        // a crash, and its TAP is on stdout. Only output with no summary at all
        // is treated as a failure to run.
        stdout = error.stdout ?? '';
        exitCode = error.code ?? 1;
      }
      const endedAt = now();
      const summary = parseTapSummary(stdout);
      const result = {
        key,
        worktree,
        command,
        startedAt,
        endedAt,
        durationMs: Date.parse(endedAt) - Date.parse(startedAt),
        exitCode,
        output: stdout,
        replayed: false,
        ...summary,
      };
      results.set(key, result);
      return result;
    },

    // The one result, handed to whoever asks. Both seats get the same object.
    resultFor(key) {
      return results.get(key) ?? null;
    },

    ran(key) {
      return results.has(key);
    },
  };
}
