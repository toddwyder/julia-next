// Criterion 1 of JUL-310: once Shipping passes, the change is on the main line
// and the card is Complete in Linear with a comment naming the change. This
// module does the three writes that means, and reads each one back: the merge
// is confirmed by the pull request's own state, the main line is confirmed by
// the commit being reachable from origin/main, and the card is confirmed by
// asking Linear for it again after the update. A step that only says it worked
// is not evidence.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const GH_TIMEOUT = 120_000;
// A terminal that sets FORCE_COLOR makes gh colour its JSON, and JSON.parse then reads the
// escape byte and refuses the answer. The answer is for a program, so ask for no colour and
// take out any that arrives anyway.
const ANSI = /\u001b\[[0-9;]*m/g;

export function gh(args, { cwd, execImpl = execFileSync, env = process.env } = {}) {
  const colourless = { ...env, NO_COLOR: '1', FORCE_COLOR: '0', CLICOLOR: '0', CLICOLOR_FORCE: '0' };
  const out = execImpl('gh', args, { cwd, env: colourless, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT });
  return String(out).replace(ANSI, '').trim();
}

export function readPullRequest(pr, options = {}) {
  const fields = 'number,title,state,isDraft,baseRefName,headRefName,headRefOid,url,mergedAt,mergeCommit,createdAt,author';
  const raw = gh(['pr', 'view', String(pr), '--json', fields], options);
  const pull = JSON.parse(raw);
  return {
    number: pull.number,
    title: pull.title,
    state: pull.state,
    draft: Boolean(pull.isDraft),
    base: pull.baseRefName,
    head: pull.headRefName,
    headSha: pull.headRefOid,
    url: pull.url,
    mergedAt: pull.mergedAt ?? null,
    mergeCommit: pull.mergeCommit?.oid ?? null,
    createdAt: pull.createdAt ?? null,
    author: pull.author?.login ?? null,
  };
}

export function pullRequestComments(pr, options = {}) {
  const raw = gh(['pr', 'view', String(pr), '--json', 'comments'], options);
  return JSON.parse(raw).comments.map(comment => ({
    body: comment.body,
    url: comment.url,
    createdAt: comment.createdAt,
    author: comment.author?.login ?? null,
  }));
}

export function assertLandable({ pull, decision }) {
  const problems = [];
  // A merged pull request is a rerun picking up where the last run stopped, not a refusal.
  if (pull.state !== 'OPEN' && pull.state !== 'MERGED') problems.push(`the pull request is ${pull.state}`);
  if (pull.draft) problems.push('the pull request is a draft');
  if (pull.base !== 'main') problems.push(`it is based on ${pull.base}, not main`);
  if (!decision.pass) problems.push(decision.reason);
  if (problems.length > 0) throw new Error(`Not merging #${pull.number}: ${problems.join('; ')}.`);
  return true;
}

export function mergePullRequest({ pr, head, options = {}, execImpl }) {
  // --match-head-commit makes the forge refuse if the branch moved after the
  // verdict: the commit Shipping judged is the commit that lands. The branch is
  // left alone: `--delete-branch` also deletes the local branch, which fails on
  // any checkout holding it, and the sweep is where a card's branches go.
  return gh(['pr', 'merge', String(pr), '--squash', '--match-head-commit', head], { ...options, execImpl });
}

// A merged pull request's branch has to go before main's CI runs: repository
// hygiene fails any pushed branch with no open pull request, and a card's branch
// stops having one the moment it merges.
export function deleteRemoteBranch(ref, options = {}) {
  try {
    gh(['api', '-X', 'DELETE', `repos/{owner}/{repo}/git/refs/heads/${ref}`], options);
    return true;
  } catch (error) {
    // The forge answers 404 for an unknown ref and 422 "Reference does not exist";
    // either way the branch is gone, which is what this was asking for.
    if (/404|Not Found|Reference does not exist/i.test(String(error.message))) return false;
    throw error;
  }
}

export async function waitForMerged({ pr, read, tries = 15, waitMs = 4000, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), log = () => {} }) {
  let last = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    last = read(pr);
    if (last.state === 'MERGED' && last.mergeCommit) return last;
    log(`Pull request #${pr} is ${last.state}; waiting for the merge to show.`);
    await sleep(waitMs);
  }
  throw new Error(`Pull request #${pr} did not report MERGED; its last state was ${last?.state ?? 'unknown'}.`);
}

// Branch protection refuses a merge until the pull request's own checks are done, so the
// machine reads them first and can say which one failed instead of reporting a refusal.
const BAD_CHECK = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const GOOD_CHECK = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

export function checkRollup(pr, options = {}) {
  const raw = gh(['pr', 'view', String(pr), '--json', 'statusCheckRollup'], options);
  return (JSON.parse(raw).statusCheckRollup ?? []).map(node => {
    const context = typeof node.state === 'string';
    return {
      name: node.name ?? node.context ?? 'a check',
      state: context ? node.state : node.conclusion ?? node.status ?? 'UNKNOWN',
      done: context ? node.state !== 'PENDING' : node.status === 'COMPLETED',
      url: node.detailsUrl ?? node.targetUrl ?? null,
    };
  });
}

export async function waitForPullChecks({
  pr,
  options = {},
  list = checkRollup,
  tries = 60,
  waitMs = 15_000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  log = () => {},
}) {
  let last = [];
  for (let attempt = 0; attempt < tries; attempt++) {
    last = list(pr, options);
    const failed = last.filter(check => BAD_CHECK.has(String(check.state).toUpperCase()));
    if (failed.length > 0) {
      return { green: false, checks: last, failed, reason: `pull request #${pr} has a failing check: ${failed.map(check => `${check.name} ${check.state}`).join(', ')}` };
    }
    const waiting = last.filter(check => !check.done);
    if (waiting.length === 0) {
      const unclear = last.filter(check => !GOOD_CHECK.has(String(check.state).toUpperCase()));
      if (unclear.length === 0) {
        return { green: true, checks: last, failed: [], reason: last.length === 0 ? `pull request #${pr} has no checks` : `the checks on pull request #${pr} are green` };
      }
      return { green: false, checks: last, failed: unclear, reason: `pull request #${pr} has a check with no verdict: ${unclear.map(check => `${check.name} ${check.state}`).join(', ')}` };
    }
    log(waiting.length === 0 ? `Pull request #${pr} has checks with no verdict yet: ${last.map(check => `${check.name} ${check.state}`).join(', ')}.` : `Waiting for ${waiting.map(check => check.name).join(', ')} on pull request #${pr}.`);
    await sleep(waitMs);
  }
  return { green: false, checks: last, failed: [], reason: `the checks on pull request #${pr} did not finish within ${Math.round((tries * waitMs) / 60_000)} minutes` };
}

export function mainRunsFor(sha, options = {}) {
  const raw = gh(['run', 'list', '--commit', sha, '--limit', '30', '--json', 'name,status,conclusion,headBranch,event,url'], options);
  return JSON.parse(raw).filter(run => run.headBranch === 'main');
}

// A merge commit is on main before CI has had its say. The card is not finished
// until the runs on that commit are done and green, so the machine waits.
export async function waitForMainCi({
  sha,
  options = {},
  list = mainRunsFor,
  tries = 40,
  waitMs = 15_000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  log = () => {},
}) {
  const bad = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure']);
  let last = [];
  for (let attempt = 0; attempt < tries; attempt++) {
    last = list(sha, options);
    if (last.length > 0 && last.every(run => run.status === 'completed')) {
      const failed = last.filter(run => bad.has(run.conclusion));
      if (failed.length > 0) {
        return { green: false, runs: last, failed, reason: `main CI failed on ${sha}: ${failed.map(run => `${run.name} ${run.conclusion}`).join(', ')}` };
      }
      return { green: true, runs: last, failed: [], reason: `main CI is green on ${sha}` };
    }
    log(last.length === 0 ? `No main CI run has started on ${sha} yet.` : `Main CI on ${sha}: ${last.map(run => `${run.name} ${run.status}`).join(', ')}.`);
    await sleep(waitMs);
  }
  return { green: false, runs: last, failed: [], reason: `main CI on ${sha} did not finish within ${Math.round((tries * waitMs) / 60_000)} minutes` };
}

export function completionComment({ card, title, pr, mergeCommit, decision, record, mergeUrl }) {
  const lines = [];
  lines.push(`Merged ${card}: ${title}`, '');
  lines.push(`- Commit \`${mergeCommit}\` is on main (squash of pull request #${pr}${mergeUrl ? `, ${mergeUrl}` : ''})`);
  lines.push(`- Shipping said ${decision.verdict} on \`${decision.head}\`${decision.commentUrl ? ` (${decision.commentUrl})` : ''}`);
  for (const line of record ? landingCommentLines(record) : []) lines.push(line);
  if (record?.landingUrl) lines.push(`- The landing record: ${record.landingUrl}`);
  lines.push('', `The card is Complete because the merge commit is on main and main CI is green on it.`);
  return lines.join('\n');
}

function landingCommentLines(record) {
  const took = record.duration ? `**${record.duration.human}**` : 'not measurable';
  const started = record.startedAt ? ` from ${record.startedAt}` : '';
  const rounds = record.reviews?.rounds ?? 0;
  const ran = record.reviews?.verdicts?.join(' -> ') || 'no Shipping round recorded';
  return [
    `- Took ${took}${started} to ${record.mergedAt}`,
    `- ${rounds} Shipping round${rounds === 1 ? '' : 's'}: ${ran}`,
    `- Both numbers are in docs/scorecards/${record.card}.landing.json, beside the scorecard`,
  ];
}

export function alreadyCompleted(comments, { card, mergeCommit }) {
  const needle = String(mergeCommit ?? '').toLowerCase();
  return (comments ?? []).some(comment => String(comment.body ?? '').toLowerCase().includes(needle) && String(comment.body ?? '').includes(`Merged ${card}`));
}

// Posting and moving the card, then reading the card back. Linear is asked for
// the card again because a mutation that returns success is not the same thing
// as a card in Complete.
export async function completeCard({
  card,
  comment,
  getIssue,
  postComment,
  setIssueState,
  mayPost,
  keep,
  log = () => {},
}) {
  if (!mayPost) {
    const file = keep(comment);
    log(`Left the card note unposted; it is kept at ${file}.`);
    return { posted: null, state: null, keptAt: file };
  }
  const posted = await postComment(card, comment);
  log(`Posted the merge comment on ${card}: ${posted.url}`);
  await setIssueState(card, 'Complete');
  const issue = await getIssue(card);
  const type = issue?.state?.type ?? null;
  if (type !== 'completed') {
    throw new Error(`${card} was set to Complete but Linear returned state ${issue?.state?.name ?? 'unknown'} (${type ?? 'no type'}).`);
  }
  log(`${card} reads back as ${issue.state.name}.`);
  return { posted: posted.url, state: issue.state.name, keptAt: null };
}

// The retro needs a checkout of the main line, which is what the merge just
// changed. It is a detached worktree on the merge commit, so the retro doc can
// be committed straight onto main without touching anyone else's working tree.
export function prepareMainCheckout({ root, runDir, sha, git }) {
  git(['fetch', '--no-tags', '--quiet', 'origin', 'main']);
  const dir = path.join(runDir, 'main');
  try {
    git(['worktree', 'remove', '--force', dir]);
  } catch {
    // Nothing there yet.
  }
  git(['worktree', 'prune']);
  fs.mkdirSync(runDir, { recursive: true });
  git(['worktree', 'add', '--detach', '--quiet', dir, sha]);
  return dir;
}

export function retroPathFor(card) {
  return `docs/retros/${String(card).toLowerCase()}.md`;
}

export function landingPathFor(card) {
  return `docs/scorecards/${card}.landing.json`;
}

// Main is protected by a ruleset that requires the checks to pass, so the
// machine cannot push its own record straight to it. The record travels as a
// pull request the machine opens, watches and merges itself: the checks run, the
// forge enforces them, and the main line stays a line of reviewed commits.
export async function publishDocs({
  checkout,
  branch,
  title,
  body,
  bodyPath,
  files,
  git,
  log = () => {},
  forge = {},
  tries = 60,
  waitMs = 15_000,
}) {
  const openPr = forge.openPr ?? (() => gh(['pr', 'create', '--base', 'main', '--head', branch, '--title', title, '--body-file', bodyPath], { cwd: checkout }).trim());
  const listChecks = forge.listChecks ?? (pr => checkRollup(pr, { cwd: checkout }));
  const mergePr = forge.mergePr ?? (pr => mergePullRequest({ pr, head: sha, options: { cwd: checkout } }));
  const readPr = forge.readPr ?? (pr => readPullRequest(pr, { cwd: checkout }));
  const dropBranch = forge.dropBranch ?? (ref => deleteRemoteBranch(ref, { cwd: checkout }));
  const sleep = forge.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));

  const relative = files.map(file => path.relative(checkout, file));
  // The files were just written into a worktree of the merge commit, and main
  // may already hold them from an earlier run. Switching branches refuses to
  // overwrite them, so they are held in memory and put back on the new branch.
  const written = relative
    .map(file => ({ file, body: fs.existsSync(path.join(checkout, file)) ? fs.readFileSync(path.join(checkout, file), 'utf8') : null }))
    .filter(entry => entry.body !== null);
  if (!written.length) throw new Error(`nothing was written at ${relative.join(', ')}, so there is nothing to publish`);
  for (const entry of written) fs.rmSync(path.join(checkout, entry.file), { force: true });
  git(['fetch', '--no-tags', '--quiet', 'origin', 'main'], { cwd: checkout });
  git(['checkout', '--quiet', '-B', branch, 'origin/main'], { cwd: checkout });
  for (const entry of written) {
    fs.mkdirSync(path.dirname(path.join(checkout, entry.file)), { recursive: true });
    fs.writeFileSync(path.join(checkout, entry.file), entry.body);
  }
  for (const file of relative) git(['add', '--', file], { cwd: checkout });
  const status = git(['status', '--porcelain', '--', ...relative], { cwd: checkout });
  if (!status) {
    // Main already holds this record, so a run that stopped after the record's
    // own pull request merged has nothing left to publish.
    log(`The record is already on main, so there is nothing to publish for ${branch}.`);
    return { url: null, branch: null, commit: null, sha: null, files: [] };
  }
  git(['commit', '-q', '-m', title, '-m', body], { cwd: checkout });
  git(['push', '--quiet', '-u', 'origin', branch], { cwd: checkout });
  const sha = git(['rev-parse', 'HEAD'], { cwd: checkout });

  const url = String(openPr()).trim();
  const pr = numberFromUrl(url);
  log(`Opened ${url} for the record of this run.`);
  const checks = await waitForPullChecks({ pr, list: listChecks, tries, waitMs, sleep, log });
  if (!checks.green) throw new Error(checks.reason);
  mergePr(pr);
  const merged = await waitForMerged({ pr, read: readPr, sleep, log });
  dropBranch(branch);
  log(`The record is on main as ${merged.mergeCommit}: ${url}`);
  return { url, branch, commit: merged.mergeCommit, sha };
}

function numberFromUrl(url) {
  const match = /\/pull\/(\d+)/.exec(url);
  if (!match) throw new Error(`could not read a pull request number out of ${url}`);
  return Number(match[1]);
}
