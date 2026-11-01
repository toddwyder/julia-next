#!/usr/bin/env node
// The machine's own entry point. It checks the pull request out on its own,
// hands the workflow the commands it may run, and writes the record the
// workflow settled on. Nothing here judges a change; every judgement is a line
// the verdict module builds from an exit code or an address that answered.
//
//   node scripts/julia-agents.mjs -- node machine/preview/run.mjs --pr 412 --card JUL-308
//
// The launcher is the same vault wrapper the live dashboard service uses, so the
// preview copy it starts gets Linear access the same way and no key is written
// to disk.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { getIssue, postComment as commentOnCard } from '../../scripts/linear-cli.mjs';
import { readCardFile } from '../remediation/card-file.mjs';
import { postComment, prepareCheckout, repoRoot, savedPosting } from '../shipping/run-parts.mjs';
import { evidenceDigest, freePort, seedState, startPreview, stopPreview, waitForAnswer } from './preview.mjs';
import { buildNote, recordBody, stopMessage } from './verdict.mjs';

const USAGE = 'usage: node machine/preview/run.mjs --pr <number> --card <JUL-number> [--card-file <path>] [--no-post] [--force]';
const LIVE_STATE_DIR = '/var/lib/julia-dashboard/state';
const TAIL = 600;

function parseArgs(argv) {
  const options = { pr: null, card: null, cardFile: null, post: true, force: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--pr') options.pr = Number(argv[++index]);
    else if (flag === '--card') options.card = argv[++index];
    else if (flag === '--card-file') options.cardFile = argv[++index];
    else if (flag === '--no-post') options.post = false;
    else if (flag === '--force') options.force = true;
    else if (flag === '--help' || flag === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else throw new Error(`unknown argument ${flag}\n${USAGE}`);
  }
  if (!Number.isInteger(options.pr) || options.pr <= 0) throw new Error(`--pr is required\n${USAGE}`);
  if (!options.cardFile && !/^[A-Z]+-\d+$/.test(String(options.card ?? ''))) throw new Error(`--card is required\n${USAGE}`);
  return options;
}

function tail(text) {
  const whole = String(text ?? '').trim();
  return whole.length > TAIL ? `…${whole.slice(-TAIL)}` : whole;
}

function command(argv, cwd) {
  const started = Date.now();
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const code = typeof result.status === 'number' ? result.status : 1;
  return { code, seconds, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function gitIn(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gh(args) {
  return execFileSync('gh', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function pullFiles(pr) {
  const view = JSON.parse(gh(['pr', 'view', String(pr), '--json', 'headRefOid,files']));
  return { sha: view.headRefOid ?? null, files: (view.files ?? []).map(file => file.path) };
}

function checkRuns(sha) {
  const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
  return JSON.parse(gh(['api', `repos/${repo}/commits/${sha}/check-runs`, '--jq', '.check_runs']));
}

// The address Todd reaches, so a preview is something he can open rather than a
// port on the machine's own loopback.
function previewHost() {
  if (process.env.PREVIEW_HOST) return process.env.PREVIEW_HOST;
  const answer = spawnSync('tailscale', ['ip', '-4'], { encoding: 'utf8' });
  const address = String(answer.stdout ?? '').split('\n').map(line => line.trim()).find(Boolean);
  return address ?? '127.0.0.1';
}

function failedBefore(runDir) {
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(runDir, 'record.json'), 'utf8'));
    return Number(saved.failCount) || 0;
  } catch {
    return 0;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runDir = path.join(repoRoot, '.artifacts', 'preview', `pr-${options.pr}`);
  const checkout = path.join(runDir, 'worktree');
  const liveStateDir = process.env.PREVIEW_LIVE_STATE_DIR || LIVE_STATE_DIR;
  fs.mkdirSync(runDir, { recursive: true });

  const cardRecord = options.cardFile ? readCardFile(options.cardFile) : null;
  const card = cardRecord?.identifier ?? options.card;
  const failed = failedBefore(runDir);

  console.log(`Fetching pull request #${options.pr} and checking it out at ${checkout}.`);
  const sha = prepareCheckout(options.pr, runDir, checkout);
  console.log(`Pull request #${options.pr} is at ${sha}.`);

  if (options.post && !options.force) {
    const saved = savedPosting(runDir, options.pr, sha, card);
    if (saved) {
      console.log(`Already checked at ${sha} and recorded at ${saved.posted.url}. Nothing to do; pass --force to check it again.`);
      return;
    }
  }

  let child = null;
  let running = null;
  let prepared = null;

  async function installOnce() {
    if (!prepared) {
      console.log("Installing the checkout's dependencies once, for every proof.");
      prepared = command(['node', 'scripts/test-owners.mjs', '--install'], checkout);
      if (prepared.code !== 0) console.log(`The install exited ${prepared.code}: ${tail(prepared.output)}`);
    }
    return prepared;
  }

  async function runProof(proof) {
    const install = await installOnce();
    if (install.code !== 0) return install;
    const result = command(proof.argv, checkout);
    console.log(`  ${proof.name}: ${result.code === 0 ? 'passed' : `failed (${result.code})`} in ${result.seconds}s.`);
    return result;
  }

  async function buildPreview({ runDir: dir, sha: wanted }) {
    const head = gitIn(checkout, ['rev-parse', 'HEAD']);
    if (head !== wanted) throw new Error(`the checkout is at ${head}, not at ${wanted}, so a preview of it would prove the wrong change`);

    const dashboard = path.join(checkout, 'dashboard');
    const started = Date.now();
    const install = command(['npm', 'ci', '--no-audit', '--no-fund'], dashboard);
    if (install.code !== 0) throw new Error(`the dashboard did not install: ${tail(install.output)}`);
    const build = command(['npm', 'run', 'build'], dashboard);
    if (build.code !== 0) throw new Error(`the dashboard did not build: ${tail(build.output)}`);
    const buildSeconds = Math.round((Date.now() - started) / 100) / 10;

    // `lanes --url` drives whatever answers, so the build has to be this
    // checkout's own or the preview proves an older change.
    const mark = path.join(dashboard, '.next', 'BUILD_ID');
    const builtAt = fs.existsSync(mark) ? fs.statSync(mark).mtimeMs : 0;
    if (!builtAt) throw new Error('the build left no .next/BUILD_ID, so there is nothing to serve');
    if (builtAt < started - 2000) throw new Error('the build on disk is older than this run, so the preview would serve a stale build');

    const stateDir = path.join(dir, 'preview');
    seedState({ from: liveStateDir, to: stateDir });
    const host = previewHost();
    const port = await freePort({ host });
    console.log(`Starting a second dashboard copy on ${host}:${port} with its own records in ${stateDir}.`);
    child = startPreview({ dir: checkout, host, port, stateDir });
    running = { host, port };
    const answered = await waitForAnswer({ url: `http://${host}:${port}/` });
    if (!answered) {
      const output = tail(child.output?.());
      await stopRunningPreview();
      throw new Error(`the preview on ${host}:${port} never answered${output ? `: ${output}` : ''}`);
    }
    return {
      host,
      port,
      address: `http://${host}:${port}`,
      stateDir,
      sha: wanted,
      buildId: fs.readFileSync(mark, 'utf8').trim(),
      buildSeconds,
      bootSeconds: Math.round(answered.ms / 100) / 10,
    };
  }

  async function stopRunningPreview() {
    const copy = child;
    const where = running;
    child = null;
    running = null;
    if (!copy) return { stopped: true, note: 'nothing was running' };
    if (!where) {
      try {
        process.kill(-copy.pid, 'SIGTERM');
      } catch {
        // already gone
      }
      return { stopped: true, note: 'no address to watch' };
    }
    return stopPreview(copy, where);
  }

  async function saveRecord(record) {
    fs.writeFileSync(path.join(runDir, 'record.json'), `${JSON.stringify(record, null, 2)}\n`);
  }

  // Linear refusing must not lose the result: the record stays on disk and the
  // run says what it could not post.
  async function noteOnCard(identifier, body) {
    try {
      return await commentOnCard(identifier, body);
    } catch (error) {
      fs.writeFileSync(path.join(runDir, 'card-note.md'), `${body}\n\nLinear refused: ${error.message}\n`);
      console.log(`Linear refused the card note, so it is on disk at ${path.join(runDir, 'card-note.md')}.`);
      return null;
    }
  }

  async function post(record) {
    const bodyFile = path.join(runDir, 'record.md');
    fs.writeFileSync(bodyFile, recordBody(record));
    if (!options.post) {
      console.log(`Left the result unposted at ${bodyFile}.`);
      return { url: null, bodyFile };
    }
    const url = postComment(options.pr, bodyFile);
    console.log(`Posted the ${record.verdict} on pull request #${options.pr}: ${url}`);
    const identifier = record.card?.identifier;
    if (identifier) {
      if (record.verdict === 'PASS') {
        await noteOnCard(identifier, recordBody(record));
      } else {
        await noteOnCard(identifier, buildNote(record));
        if (record.stopped) {
          await noteOnCard(identifier, stopMessage(record));
          console.log(`The card is stopped and ${identifier} carries the ping.`);
        }
      }
    }
    return { url, bodyFile };
  }

  const deps = {
    runDir,
    checkout,
    liveStateDir,
    getIssue: async identifier => cardRecord ?? getIssue(identifier, { apiKey: process.env.LINEAR_API_KEY }),
    pullFiles,
    prepareCheckout: async () => gitIn(checkout, ['rev-parse', 'HEAD']),
    digest: dir => {
      try {
        return evidenceDigest(dir);
      } catch (error) {
        throw new Error(`the live dashboard records could not be read at ${dir}: ${error.message}`);
      }
    },
    buildPreview,
    checkRuns,
    runProof,
    stopPreview: stopRunningPreview,
    saveRecord,
    post,
  };

  try {
    const { runPreview } = await import('./workflow.mjs');
    const run = await runPreview({ pr: options.pr, card, deps, runDir, failedBefore: failed, log: message => console.log(message) });
    if (!run.output) {
      fs.writeFileSync(path.join(runDir, 'error.txt'), `${run.status}: ${run.error}\n`);
      console.error(`The machine ended ${run.status}: ${run.error}`);
      process.exitCode = 1;
      return;
    }
    const record = run.output;
    console.log(`Wrote the run record to ${path.join(runDir, 'record.json')}.`);
    if (record.preview) console.log(`The preview was ${record.preview.address}, built in ${record.preview.buildSeconds}s and answering ${record.preview.bootSeconds}s after it started.`);
    console.log(`${record.verdict} for #${options.pr} in ${Math.round(run.elapsedMs / 1000)}s; ${record.scopeReason}.`);
  } finally {
    await stopRunningPreview();
  }
}

main().catch(error => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
