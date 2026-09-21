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

// THE OWNERSHIP BOUNDARY, for the one boundary that cannot take a `-c` flag.
//
// The controller runs as `orchestrator-svc`; the candidate worktree is owned by
// `runner` (JUL-98 step 5, and the constant block at the top of ./wiring.mjs).
// Git's dubious-ownership guard is about the owning UID, not file permissions,
// so ANY git command run inside that directory is refused with "fatal: detected
// dubious ownership in repository at ...". The suite is
// `node --test scripts/*.test.mjs` -- not git, so there is no `-c` to add -- but
// tests inside it shell out to git in the repo root: scripts/line-endings.test.mjs
// line 27 runs `git ls-files --eol` with `cwd: ROOT`, and its own catch turns a
// failure into `t.skip('not inside a git checkout')`. So without this the repo's
// line-ending guard would SILENTLY SKIP on every controller-run suite, and the
// controller would report it as a pass.
//
// `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` is git's own
// documented environment form of `-c key=value`, and it is inherited by every
// git process the suite starts. It is the SAME fix as scripts/publish-pr.mjs
// (pushBranch) and scripts/verify-reviewer-worktree.mjs: one entry, the value is
// exactly the worktree path the caller passed in, and it is never read from
// repo-local config -- only the spelling differs, because a shell command has no
// argv position to put `-c` in.
//
// An inherited count is appended to rather than overwritten: writing index 0
// unconditionally would silently drop a `-c` an outer caller had already set.
export function gitSafeDirectoryEnv(worktree, env = process.env) {
  const base = Number.parseInt(env.GIT_CONFIG_COUNT ?? '', 10);
  const at = Number.isInteger(base) && base >= 0 ? base : 0;
  return {
    ...env,
    [`GIT_CONFIG_KEY_${at}`]: 'safe.directory',
    [`GIT_CONFIG_VALUE_${at}`]: String(worktree),
    GIT_CONFIG_COUNT: String(at + 1),
  };
}

// The default runner: a plain shell command in the worktree. Injected in every
// test; nothing here spawns anything when the caller supplies its own.
async function defaultExecImpl({ command, cwd, env }) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  return execFileAsync('sh', ['-c', command], { cwd, env, maxBuffer: 64 * 1024 * 1024 });
}

export function createSuiteRunner({
  execImpl = defaultExecImpl,
  command = SUITE_COMMAND,
  env = process.env,
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
        ({ stdout } = await execImpl({ command, cwd: worktree, env: gitSafeDirectoryEnv(worktree, env) }));
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
