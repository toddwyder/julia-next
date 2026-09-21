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

// ---------------------------------------------------------------------------
// WHICH TEST FAILED -- JUL-98 step 5, sixth fix.
//
// THE INCIDENT, 2026-09-21. The controller carried a real card the whole way:
// builder, suite, cost, seat fallback, an independent reviewer, a cost line for
// each. The step did not pass because the reviewer reported failed, and the
// reviewer had been handed "720 pass, 1 fail, 0 skipped of 721" -- counts and
// nothing else. Nobody could tell WHICH test failed. Afterwards the coordinator
// re-ran the suite at the very commit the builder produced, with the
// controller's own environment reproduced, and got 721 of 721 green. The
// worktree the controller had actually measured was already cleaned up, so the
// difference can never now be recovered. A number on a card is not a result a
// reader can act on; a name and the error text is.
//
// The cap: at most MAX_REPORTED_FAILURES failures, each with at most
// MAX_FAILURE_TEXT characters of error text. Five is chosen because a suite with
// more than five distinct failures has a cause, not five causes -- the first few
// names are enough to find it -- and 500 characters is about one assertion
// failure's diff with its header, which is the unit a reader actually reads.
// Worst case on the card is therefore ~2.5KB, a paragraph, not a novel. What was
// cut is always stated, so nobody mistakes the cap for the whole story; the full
// output stays on `result.output` for anyone who needs it.
export const MAX_REPORTED_FAILURES = 5;
export const MAX_FAILURE_TEXT = 500;

const NOT_OK_LINE = /^(\s*)not ok (\d+)\s*-\s*(.*)$/;

// One failing test out of a run's TAP: the `not ok` line, the test's name, and
// the error node's test runner prints under it in the YAML diagnostic block.
function readFailureBlock(lines, from) {
  // The diagnostic block is `---` ... `...`, indented under the `not ok` line.
  let at = from;
  while (at < lines.length && lines[at].trim() === '') at += 1;
  if (at >= lines.length || lines[at].trim() !== '---') return { error: '', failureType: null, next: from };
  at += 1;
  const body = [];
  while (at < lines.length && lines[at].trim() !== '...') { body.push(lines[at]); at += 1; }

  let failureType = null;
  let error = '';
  for (let i = 0; i < body.length; i += 1) {
    const typeMatch = /^\s*failureType:\s*'?"?([A-Za-z]+)'?"?\s*$/.exec(body[i]);
    if (typeMatch) failureType = typeMatch[1];
    const errorMatch = /^(\s*)error:\s*(.*)$/.exec(body[i]);
    if (!errorMatch || error) continue;
    const [, indent, head] = errorMatch;
    if (/^[|>][-+]?$/.test(head.trim())) {
      // A YAML block scalar: every following line indented past the key.
      const block = [];
      for (let j = i + 1; j < body.length; j += 1) {
        const line = body[j];
        if (line.trim() !== '' && !line.startsWith(indent + ' ')) break;
        block.push(line.slice(indent.length + 2));
      }
      error = block.join('\n').trim();
    } else {
      error = head.trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return { error, failureType, next: at + 1 };
}

// Every failing test in a run's TAP, with the text each one printed, capped.
export function parseTapFailures(output, { maxFailures = MAX_REPORTED_FAILURES, maxText = MAX_FAILURE_TEXT } = {}) {
  const lines = String(output ?? '').split('\n');
  const all = [];
  for (let at = 0; at < lines.length; at += 1) {
    const match = NOT_OK_LINE.exec(lines[at]);
    if (!match) continue;
    const [, , number, rawName] = match;
    const { error, failureType, next } = readFailureBlock(lines, at + 1);
    all.push({
      name: rawName.replace(/\s+#\s.*$/, '').trim(),
      tapLine: `not ok ${number} - ${rawName.trim()}`,
      error,
      failureType,
    });
    at = Math.max(at, next - 1);
  }

  // A file whose only complaint is that something inside it failed says nothing
  // a reader can act on -- the real failure is already in the list. Dropping it
  // keeps the cap for the failures that name a cause; if a run has NOTHING but
  // those, they are all there is, so they are kept.
  const named = all.filter((one) => one.failureType !== 'subtestFailed');
  const interesting = named.length ? named : all;

  const shown = interesting.slice(0, maxFailures).map((one) => ({
    ...one,
    error: one.error.length > maxText ? `${one.error.slice(0, maxText)}... [cut]` : one.error,
  }));
  return { total: interesting.length, shown, truncated: interesting.length > shown.length };
}

// WHETHER THE RESULT DESCRIBES THE COMMIT -- JUL-98 step 5, sixth fix, item 2.
//
// The controller runs the suite in the candidate WORKTREE, which can hold files
// the candidate COMMIT does not: anything the worker left uncommitted or
// untracked. So a green run in a dirty worktree is a different claim from a
// green run on the commit, and until this fix nothing on the card said which one
// the reviewer had been handed. That is exactly the shape of the incident above.
//
// This RECORDS the difference; it does not act on it. A dirty worktree must NOT
// refuse the step -- deciding what to do about one is a later card's job, and the
// omission below is deliberate, not an oversight. Git failing to answer at all is
// likewise not a refusal: the state is recorded as unknown and said to be
// unknown, because the test result itself is still a real result.
//
// The git calls go through the SAME `gitSafeDirectoryEnv` the suite runs under
// (see the boundary note below it): one entry, exactly this worktree, never a
// wildcard and never its parent.
export async function readWorktreeState({ worktree, env = process.env, gitImpl = defaultGitImpl }) {
  const gitEnv = gitSafeDirectoryEnv(worktree, env);
  try {
    const { stdout: status } = await gitImpl({ args: ['status', '--porcelain'], cwd: worktree, env: gitEnv });
    const { stdout: head } = await gitImpl({ args: ['rev-parse', 'HEAD'], cwd: worktree, env: gitEnv });
    const dirty = String(status ?? '').split('\n').map((line) => line.trimEnd()).filter(Boolean);
    const commit = String(head ?? '').trim();
    return {
      known: true,
      clean: dirty.length === 0,
      commit,
      shortCommit: commit.slice(0, 7),
      dirtyCount: dirty.length,
      // Enough to recognise what was uncommitted, not the whole tree.
      dirty: dirty.slice(0, MAX_REPORTED_FAILURES),
    };
  } catch (error) {
    return { known: false, reason: String(error?.message ?? error).split('\n')[0].slice(0, 200) };
  }
}

// The sentence appended to the test line saying whether the measured worktree
// matched the commit. A result with no recorded state says nothing extra.
function worktreeNote(state) {
  if (!state) return '';
  if (!state.known) return ` Worktree state unknown (${state.reason}), so whether this result describes the commit is not known.`;
  if (state.clean) return ` Worktree clean at ${state.shortCommit}, so this result describes that commit.`;
  const files = state.dirty?.length ? ` (${state.dirty.join('; ')}${state.dirtyCount > state.dirty.length ? '; ...' : ''})` : '';
  return ` Worktree NOT clean at ${state.shortCommit}: ${state.dirtyCount} uncommitted or untracked ${state.dirtyCount === 1 ? 'entry' : 'entries'}${files} -- this result describes the WORKTREE, not the commit.`;
}

// The failing tests, as markdown lines under the counts. Empty when the run
// passed, so a passing run keeps exactly the one-line form it has always had.
function failureLines(result) {
  if (result.ok !== false && !(result.fail > 0)) return [];
  const { total, shown, truncated } = parseTapFailures(result.output);
  if (!shown.length) {
    return ['', `**Failing tests:** the run reported ${result.fail} failing, but its output carried no "not ok" line to name them.`];
  }
  const head = truncated
    ? `**Failing tests** (${shown.length} of ${total} shown, error text cut at ${MAX_FAILURE_TEXT} characters):`
    : `**Failing tests** (${total}):`;
  const body = shown.flatMap((one) => [
    `- \`${one.tapLine}\``,
    ...(one.error ? ['  ```', ...one.error.split('\n').map((line) => `  ${line}`), '  ```'] : []),
  ]);
  return ['', head, ...body];
}

// The line the controller posts on the card, next to that step's cost lines.
export function testRunLine(result) {
  const counts = `${result.pass} pass, ${result.fail} fail, ${result.skipped} skipped of ${result.total}`;
  const seconds = (result.durationMs / 1000).toFixed(1);
  const head = `**Tests** (run once by the controller): ${shortStamp(result.startedAt)}-${shortStamp(result.endedAt)}, ${seconds}s -- ${counts}. \`${result.command}\` in \`${result.worktree}\`.${worktreeNote(result.worktreeState)}`;
  return [head, ...failureLines(result)].join('\n');
}

// The same facts for the journal, on ONE physical line: `journalctl --user -u
// julia-controller | grep` is how this is read on the server, and a grep that
// matches a multi-line message shows only the line it matched.
export function testRunJournalLine(result) {
  return testRunLine(result)
    .replace(/```/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' | ');
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

// git in the candidate worktree, for the two questions of item 2. Injected in
// every test; nothing here spawns anything when the caller supplies its own.
async function defaultGitImpl({ args, cwd, env }) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  return execFileAsync('git', args, { cwd, env, maxBuffer: 8 * 1024 * 1024 });
}

export function createSuiteRunner({
  execImpl = defaultExecImpl,
  gitImpl = defaultGitImpl,
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
      // Read BEFORE the suite runs: this is the worktree as it was handed to
      // the run, not as the run's own temporary files left it.
      const worktreeState = await readWorktreeState({ worktree, env, gitImpl });
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
        worktreeState,
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
