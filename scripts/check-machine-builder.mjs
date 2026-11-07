#!/usr/bin/env node
// Whether an installed Mastra Code program registers the `subagent` tool the
// machine's stages need. The machine boots that program to build each stage's
// agent, so a builder without the tool fails every stage for reasons that have
// nothing to do with the code under review.
//
// Whoever installs or upgrades the program the machine borrows runs this:
//
//   node scripts/check-machine-builder.mjs
//
// `--program-dir` points the check at a different install, such as a copy
// staged beside the live one before a swap.
//
// One boot per process. Two copies of @mastra/core must never share a process,
// so the check takes one program directory and stops there.

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scratchDir } from './scratch-dir.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(here, '..');

const USAGE = 'usage: node scripts/check-machine-builder.mjs [--program-dir <dir>]';

// The harness's own sentence for a builder with no subagent tool. Kept here so
// the check can tell that failure apart from every other boot failure.
const NO_TOOL = 'built no subagent tool';

export function resolveProgramDir(value) {
  return resolve(value || process.env.MASTRACODE_PROGRAM_DIR || join(os.homedir(), '.local', 'lib', 'mastracode-program'));
}

export function codeSdkVersion(programDir) {
  try {
    return JSON.parse(readFileSync(join(programDir, 'node_modules', '@mastra', 'code-sdk', 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

export function versionNote(programDir) {
  const version = codeSdkVersion(programDir);
  return version ? `(@mastra/code-sdk ${version})` : '(@mastra/code-sdk version unknown)';
}

// Both the finally and the exit hook call this, so it has to tolerate a
// directory that is already gone.
export function removeTemp(tempDir) {
  rmSync(tempDir, { recursive: true, force: true });
}

async function main(argv) {
  const flag = argv.indexOf('--program-dir');
  const programDir = flag > -1 ? argv[flag + 1] : null;
  if (flag > -1 && !programDir) {
    console.error(USAGE);
    return 2;
  }
  const dir = resolveProgramDir(programDir);
  const note = versionNote(dir);

  // The harness reads MASTRACODE_PROGRAM_DIR and the two database paths once, at
  // module load, so the environment is set before the import, the way
  // machine/shipping/run.mjs does it. The paths point into a fresh temp
  // directory so a check never writes the store a live run is reading.
  mkdirSync(scratchDir, { recursive: true });
  const tempDir = mkdtempSync(join(scratchDir, 'check-machine-builder-'));
  process.env.MASTRACODE_PROGRAM_DIR = dir;
  process.env.MASTRA_DB_PATH = join(tempDir, 'state.db');
  process.env.MASTRA_OBSERVABILITY_DB_PATH = join(tempDir, 'trace.db');
  // A boot also writes a thread lock file under the app data directory, and a
  // check must stay out of the way of a live run, so that directory moves into
  // the temp one as well.
  process.env.MASTRA_APP_DATA_DIR = join(tempDir, 'app-data');
  const sweep = () => removeTemp(tempDir);
  process.once('exit', sweep);

  try {
    const { bootHarness, missingProgram, stopHarness } = await import('../machine/shipping/harness.mjs');

    const missing = missingProgram();
    if (missing) {
      console.error(`FAIL ${dir}: ${missing}`);
      return 1;
    }

    let booted;
    try {
      booted = await bootHarness({
        cwd: repoRoot,
        storage: { backend: 'libsql', url: `file:${join(tempDir, 'state.db')}`, isRemote: false },
      });
    } finally {
      // A failed boot can still leave a store and a trace writer open, so the
      // shutdown runs whenever the boot got far enough to return a controller.
      if (booted) await stopHarness(booted);
      // The builder installs its own exit hook while booting, and that hook puts
      // the app data directory back to delete its session pid file. Moving the
      // sweep to the end of the exit listeners leaves it running once that hook
      // is done, so nothing the boot rebuilt survives the process.
      process.removeListener('exit', sweep);
      process.once('exit', sweep);
    }

    console.log(`PASS ${dir} ${note}: the subagent tool is present.`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(NO_TOOL)) {
      console.error(`FAIL ${dir} ${note}: the harness built no subagent tool, so the review, retro and fix stages cannot start.`);
      // The harness's sentence stays verbatim underneath, so a reader can go
      // back to harness.mjs and find the same words.
      console.error(message);
      return 1;
    }
    console.error(`FAIL ${dir}: ${message}`);
    return 1;
  } finally {
    removeTemp(tempDir);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then(code => {
      if (code) process.exitCode = code;
    })
    .catch(error => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
