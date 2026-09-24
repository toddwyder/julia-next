// run-gemini.mjs -- the Gemini worker for julia-minimal-runner (JUL-122).
//
// Installed root-owned at /opt/julia-runner/ops/julia-runner/run-gemini.mjs and
// started only by `sudo -n -u gemini-worker /usr/bin/node <this file>` (the one
// sudoers rule in ./sudoers). It reads {worktree, prompt} as JSON on stdin and
// runs one headless agy turn in that worktree, as gemini-worker:
//
//   * gemini-worker has no groups and no service keys; it cannot read the
//     runner's Linear credential or the drop box;
//   * its own agy allow list must be empty: Gemini edits files and runs no
//     command at all (Todd, 24 Sep: not npm test, not git commit, not npx);
//   * only a card worktree under /srv/julia-runner/worktrees is accepted;
//   * agy gets HOME, PATH, LANG and USER only.
import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKTREES = '/srv/julia-runner/worktrees';

export function worktreeProblem(path, { realpath = realpathSync } = {}) {
  if (typeof path !== 'string' || !/^\/srv\/julia-runner\/worktrees\/card-\d+$/.test(path)) {
    return `refused: ${JSON.stringify(path)} is not a card worktree under ${WORKTREES}`;
  }
  const real = realpath(path);
  return real === path ? null : `refused: ${path} resolves to ${real}`;
}

export function allowListProblem(settingsText) {
  if (settingsText == null) return null;
  let settings;
  try { settings = JSON.parse(settingsText); } catch { return 'refused: the agy settings file could not be read'; }
  const allow = settings?.permissions?.allow ?? [];
  return allow.length ? `refused: gemini-worker's agy allow list must be empty, but it allows ${allow.join(', ')}` : null;
}

// Headless agy obeys only its own account's allow list; --sandbox and a
// project's rules do not help (measured 24 Sep). The worktree goes in with
// --add-dir and is named in the brief, or Gemini guesses paths. --print is
// variadic and must come last, straight before the prompt.
export const agyArgs = (prompt, worktree) => ['--add-dir', worktree, '--output-format', 'stream-json', '--disable-slash-commands', '--print', `Your working folder is ${worktree}.\n\n${prompt}`];

function readSettings(home) {
  try { return readFileSync(join(home, '.gemini', 'antigravity-cli', 'settings.json'), 'utf8'); } catch (error) {
    return error.code === 'ENOENT' ? null : '{ unreadable';
  }
}

function main() {
  const { worktree, prompt } = JSON.parse(readFileSync(0, 'utf8'));
  const home = homedir();
  const problem = worktreeProblem(worktree) ?? allowListProblem(readSettings(home));
  if (problem || typeof prompt !== 'string') {
    console.error(problem ?? 'refused: no prompt');
    process.exit(2);
  }
  // New files stay writable by the worktree group, so the runner can commit
  // them and switch commits afterwards.
  process.umask(0o002);
  const agy = spawn(join(home, '.local', 'bin', 'agy'), agyArgs(prompt, worktree), {
    cwd: worktree,
    env: { HOME: home, USER: 'gemini-worker', PATH: `${home}/.local/bin:/usr/bin:/bin`, LANG: 'C.UTF-8' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  agy.on('error', (error) => { console.error(`agy did not start: ${error.message}`); process.exit(1); });
  agy.on('close', (code) => process.exit(code ?? 1));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
