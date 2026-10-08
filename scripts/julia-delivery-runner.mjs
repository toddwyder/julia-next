// The Windows delivery handoff for JUL-196.  It owns run files, never Linear
// mutations, publishing, UAT, or Factory.  Adapters keep the process boundary
// testable and make each worker's observed identity part of the durable record.
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { getIssue } from './linear-cli.mjs';
import { localTester } from './julia-minimal-runner-checks.mjs';
import { acquireRunLock, jsonText, loadText, processStarted, saveJson, sha256, stopProcessTree } from './julia-delivery-state.mjs';
import { assertDeliveryPath, prepareDeliveryWorkspace, captureDeliveryCandidate } from './julia-delivery-candidate.mjs';
import { LIMITS, runLimited } from '../ops/julia-runner/time-limit.mjs';

const SHA = /^[0-9a-f]{40}$/i;
// The initial build and its review, then at most this many repairs. A repair
// is spent when its builder is durably about to start, not when it finishes,
// so a restart can never win an extra one.
export const MAX_REPAIRS = 3;
const SCHEMA = 1;

// Authorization is an operator input, separate from tracker readiness. Spending
// names both roles explicitly; the exact resolved configuration is saved with it.
export function authorizationReason(authorization, issueId, configuration) {
  if (!authorization || authorization.explicitStart !== true || authorization.issueId !== issueId || (typeof authorization.authorizedBy !== 'string' || !authorization.authorizedBy.trim())) return 'explicit start authorization for this issue is required';
  for (const role of ['builder', 'reviewer']) {
    const spend = authorization.spending?.[role];
    if (!spend || !['subscription', 'paid', 'fixture'].includes(spend.mode) || !Number.isFinite(spend.maxUsd) || spend.maxUsd < 0) return `explicit ${role} spending choice is required`;
    if (spend.mode !== 'paid' && spend.maxUsd !== 0) return `${role} non-paid spending must have a zero dollar limit`;
  }
  if (authorization.configuration && !isDeepStrictEqual(authorization.configuration, plain(configuration))) return 'authorization names a different builder/reviewer configuration';
  return null;
}

function refusal(card) {
  if (!card || card.identifier == null) return 'Linear did not return a card';
  if (card.identifier !== card.expectedId) return `Linear returned ${card.identifier}, not the requested card`;
  if (!/^##\s+Acceptance criteria\s*$/mi.test(card.description ?? '')) return 'card has no approved acceptance criteria';
  return null;
}

function approvedInput(card, configuration) {
  return { issueId: card.identifier, title: card.title, description: card.description, configuration, readAt: new Date().toISOString() };
}

export function workerPrompt(role, card, configuration, runPath, approvedPath, findings = null, interrupted = false) {
  const chosen = configuration[role];
  const common = `Issue: ${card.identifier}\nSaved run: ${runPath}\nApproved input: ${approvedPath}\nConfigured ${role}: ${JSON.stringify(chosen)}`;
  // A builder that follows an interrupted one inherits its unfinished edits; it is told so, never left to guess.
  const resumed = interrupted ? '\n\nThe previous builder for this work was interrupted before it finished. Its partial changes are still in the worktree: inspect them first (git status, git diff) and finish the work from there. Do not discard them or start over.' : '';
  if (role === 'builder') return `${common}\n\nExplicitly read and follow .claude/skills/implement/SKILL.md for ${card.identifier}. The approved requirements are only in ${approvedPath}; do not reread Linear. Work only in the prepared isolated worktree.${resumed}${findings ? `\n\nRepair these review findings:\n${findings}` : ''}`;
  return `${common}\n\nReview the changed, checked immutable candidate named in the saved handoff file only, in one fresh session. Keep Standards and Spec separate in the report. You are independent of the builder and must not receive its conversation. Save and reuse this review for this candidate; no polling or retry after an ambiguous or failing call, and no unchanged rereview. End with exactly VERDICT: PASS or VERDICT: FAIL, and name the reviewed 40-character commit.`;
}

function validObserved(role, configured, observed) {
  if (!observed || observed.harness !== configured.harness || observed.model !== configured.model || observed.maker !== configured.maker) return `${role} observed identity does not match its saved configuration`;
  if (role === 'reviewer' && observed.maker.trim().toLowerCase() === configured.builderMaker?.trim().toLowerCase()) return 'reviewer maker matches builder maker';
  return null;
}

function reviewVerdict(text, commit) {
  const verdict = /^VERDICT:\s*(PASS|FAIL)\s*$/mi.exec(text ?? '')?.[1];
  if (!verdict) return { error: 'review output has no exact PASS/FAIL verdict' };
  if (verdict === 'PASS' && !new RegExp(`\\b${commit}\\b`, 'i').test(text)) return { error: 'PASS does not name the exact candidate commit' };
  return { verdict };
}

const fileSave = saveJson;
const now = () => new Date().toISOString();
const pause = (ms) => new Promise((done) => { setTimeout(done, ms); });

function park(reason, round = null) { return { outcome: 'park', reason, round }; }
// A started run the runner will not continue because it cannot prove that continuing is safe.
function unsafe(reason, round = null) { return { ...park(reason, round), unsafe: true }; }

// What a failed launch leaves in the evidence. Only the code and message are
// kept: the raw error also carries the stack and the full command line.
function failure(operation, error) {
  return error ? { operation, code: error.code ?? null, message: String(error.message ?? error) } : null;
}

// The JUL-122 time limiter owns the child process group; this adapter only
// maps the saved catalog harnesses to their unattended command lines.
function claudeCommand() {
  if (process.platform !== 'win32') return 'claude';
  // npm's Windows shim is a batch file, not a CreateProcess executable.
  // Prefer a native installation, then the native binary behind the npm shim.
  const native = spawnSync('where.exe', ['claude.exe'], { encoding: 'utf8', windowsHide: true });
  if (native.status === 0) return native.stdout.trim().split(/\r?\n/)[0];
  const shim = spawnSync('where.exe', ['claude.cmd'], { encoding: 'utf8', windowsHide: true });
  for (const path of (shim.stdout ?? '').trim().split(/\r?\n/).filter(Boolean)) {
    const executable = join(dirname(path), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    if (existsSync(executable)) return executable;
  }
  throw new Error('Installed Claude Code native executable was not found');
}

function nativeCommand(harness) {
  if (harness === 'claude-code') return claudeCommand();
  if (harness !== 'codex') return null;
  if (process.platform !== 'win32') return 'codex';
  const native = spawnSync('where.exe', ['codex.exe'], { encoding: 'utf8', windowsHide: true });
  if (native.status === 0) return native.stdout.trim().split(/\r?\n/)[0];
  throw new Error('Installed Codex native executable was not found');
}

// Read the exact thread's native session record once; never trust agent prose
// or the requested model. Missing/conflicting metadata fails identity closed.
function codexIdentity(output, root) {
  const events = output.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const thread = events.find(event => event.type === 'thread.started')?.thread_id;
  if (!/^[0-9a-f-]{36}$/i.test(thread ?? '')) return null;
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { const found = walk(path); if (found) return found; }
      else if (entry.name.startsWith('rollout-') && entry.name.endsWith(`-${thread}.jsonl`)) return path;
    }
    return null;
  };
  try {
    const path = walk(root); if (!path) return null;
    const records = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    const session = records.find(event => event.type === 'session_meta')?.payload;
    const turns = records.filter(event => event.type === 'turn_context').map(event => event.payload);
    if (session?.id !== thread || session.model_provider !== 'openai' || !turns.length || !turns[0]?.model || turns.some(turn => turn.model !== turns[0].model)) return null;
    return { thread, path, provider: session.model_provider, model: turns[0].model, effort: turns[0].reasoning_effort ?? turns[0].effort ?? null };
  } catch { return null; }
}

export function productionLauncher(worktree, { run = runLimited, findExecutable = nativeCommand, sessionRoot = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions') } = {}) {
  return async (role, request) => {
    const configured = request.configuration;
    const cwd = role === 'builder' ? worktree : process.cwd();
    const startedAt = new Date().toISOString();
    // A worker whose executable cannot be found is recorded like one that could not be started.
    let command = null; let failed = null;
    try { command = findExecutable(configured.harness); }
    catch (cause) { failed = failure(`find ${configured.harness} executable`, cause); }
    const args = configured.harness === 'claude-code' ? ['-p', '--model', configured.model, '--effort', configured.thinking ?? 'high', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', 'Read,Edit,Write,Bash,Glob,Grep,Skill', '--allowedTools', 'Read,Edit,Write,Glob,Grep,Skill,Bash(node --test *),Bash(git status *),Bash(git diff *)']
      : configured.harness === 'codex' ? ['exec', '-m', configured.model, '-c', 'model_provider="openai"', '-c', 'approval_policy="never"', ...(configured.thinking ? ['-c', `model_reasoning_effort="${configured.thinking}"`] : []), '-s', role === 'builder' ? 'workspace-write' : 'read-only', '--skip-git-repo-check', '--json', '-'] : [];
    if (!command && !failed) return { exitCode: 2, observed: null, text: `unsupported harness ${configured.harness}` };
    let output = ''; let error = ''; let pid = null; let unrecorded = null;
    const result = failed ? { code: null, signal: null, stopped: false } : await run(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }, {
      seconds: LIMITS.builder.fallback,
      started: (child) => {
        child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { error += chunk; }); child.stdin.on('error', () => {});
        pid = child.pid ?? null;
        // The worker gets its instructions only after the caller has durably
        // recorded which process it is, so a restart can always find it. A
        // worker that could not be recorded is stopped before it is told anything.
        Promise.resolve(pid && request.started ? request.started({ pid }) : null).then(
          () => child.stdin.end(request.prompt),
          (cause) => { unrecorded = failure('record worker identity', cause); child.stdin.end(); child.kill(); },
        );
      },
    });
    failed ??= failure('start worker', result.error) ?? unrecorded;
    let identity = null;
    const identityEvidence = configured.harness === 'codex' ? codexIdentity(output, sessionRoot) : null;
    if (identityEvidence) identity = { harness: 'codex', model: identityEvidence.model, maker: 'OpenAI' };
    if (configured.harness === 'claude-code') {
      const events = output.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      const init = events.find(event => event.type === 'system' && event.subtype === 'init');
      const model = events.find(event => event.type === 'assistant')?.message?.model ?? init?.model;
      if (model) identity = { harness: 'claude-code', model, maker: 'Anthropic' };
    }
    const finishedAt = new Date().toISOString();
    const exitCode = result.stopped ? 124 : unrecorded ? 1 : result.code ?? 1;
    // The worker's own streams are the evidence; nothing here is summarised.
    if (request.outputPath) await fileSave(request.outputPath, { role, configured, observed: identity ?? null, identityEvidence, command, args, cwd, pid, exitCode, signal: result.signal ?? null, timedOut: result.stopped, error: failed, startedAt, finishedAt, stdout: output, stderr: error });
    return { exitCode, observed: identity ?? null, text: output || error || failed?.message || '', outputPath: request.outputPath ?? null, timedOut: result.stopped };
  };
}

// The run record: everything a restart needs, in one file that is replaced
// whole at every step. `actions` is the journal: an action is saved as started
// before it runs and as done after it, so a restart can tell a finished step
// (skipped) from an interrupted one (handled explicitly, never assumed done).
function newRecord({ issueId, configuration, approvedPath, approvedHash, worktree }) {
  return { schema: SCHEMA, issueId, configuration, approved: { path: approvedPath, sha256: approvedHash }, worktree, stage: 'build', round: 0, repairsUsed: 0, restarts: 0, actions: [], findings: [], result: null, startedAt: now(), updatedAt: now() };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

// Why this start may not continue a saved record, or null.
function recordMismatch(record, issueId, configuration) {
  if (!Number.isInteger(record.repairsUsed) || record.repairsUsed < 0 || record.repairsUsed > MAX_REPAIRS || record.round < record.repairsUsed || record.round > MAX_REPAIRS + 1 || !Array.isArray(record.actions) || record.actions.filter(action => action?.status === 'started').length > 1) return 'the saved repair budget or action journal is invalid';
  if (record.schema !== SCHEMA || !Array.isArray(record.actions) || !Array.isArray(record.findings) || !Number.isInteger(record.round) || typeof record.approved?.sha256 !== 'string') return 'the saved run state is not in a form this runner wrote';
  if (record.actions.some(action => !action || !['build', 'candidate', 'review', 'verify'].includes(action.kind) || !['started', 'done', 'interrupted', 'stale', 'uncertain'].includes(action.status) || !Number.isInteger(action.round) || action.round < 0 || action.round > MAX_REPAIRS || action.key !== `${action.kind}:${action.round}` || (action.worker != null && (!Number.isInteger(action.worker.pid) || action.worker.pid <= 0 || (action.worker.started != null && typeof action.worker.started !== 'string'))))) return 'the saved action journal is invalid';
  if (record.issueId !== issueId) return `the saved run state belongs to ${record.issueId}, not ${issueId}`;
  if (!isDeepStrictEqual(record.configuration, plain(configuration))) return 'the saved run was started with a different builder/reviewer configuration';
  return null;
}

// An interrupted action's worker must be gone before anything else runs. The
// recorded pid is trusted only while its creation time still matches, so a
// process that merely reuses the number is left alone. Returns how the worker
// was settled, or `unsafe` when it cannot be proved gone.
async function settleWorker(action, processes) {
  if (!action.role) return { handling: 'no worker was involved; the step is run again' };
  if (!action.worker) return { final: true, unsafe: `the ${action.role} was being started when the runner stopped and its process was never recorded, so it may still be running` };
  const { pid, started } = action.worker;
  try {
    let seen = await processes.started(pid);
    if (!started && seen) return { unsafe: `the earlier ${action.role} (process ${pid}) has no recorded creation time, so its identity cannot be proved` };
    if (seen !== started || !seen) return { handling: seen ? `worker ${pid} had already exited; that process id now belongs to another process, which was left alone` : `worker ${pid} had already exited` };
    await processes.stop(pid);
    for (let checks = 0; checks < 40 && seen === started; checks += 1) { await pause(250); seen = await processes.started(pid); }
    if (seen === started) return { unsafe: `the earlier ${action.role} (process ${pid}) is still running and could not be stopped` };
    return { handling: `worker ${pid} was still running without its runner and was stopped` };
  } catch (error) { return { unsafe: `could not tell whether the earlier ${action.role} (process ${pid}) is still running: ${error.message}` }; }
}

export async function runDelivery({ issueId, configuration, runPath, authorization }, { readCard, save = fileSave, load, lock, launch, candidate, prepareWorktree = async () => ({ ok: true }), preflight = () => null, processes = { started: processStarted, stop: stopProcessTree } }) {
  // Run files are either all real or all injected: a test that keeps them in
  // memory has no earlier run to load and no second process to lock out.
  load ??= save === fileSave ? loadText : async () => null;
  lock ??= save === fileSave ? acquireRunLock : async () => ({ ok: true, release: async () => {} });
  const directory = dirname(runPath);
  const statePath = join(directory, `${issueId}-state.json`);
  const approvedPath = join(directory, `${issueId}-approved.json`);
  // A refusal to continue a started run is saved beside its record, never over it.
  const refuse = async (reason, round = null) => { const result = unsafe(reason, round); await save(join(directory, `${issueId}-refusal.json`), { issueId, result, refusedAt: now() }); return result; };
  const held = await lock(join(directory, `${issueId}-lock.json`));
  if (!held.ok) return refuse(held.reason);
  try {
    let record = null;
    let savedState; try { savedState = await load(statePath); } catch (error) { return await refuse(`the saved run state cannot be read (${error.code ?? error.message})`); }
    if (savedState != null) {
      let parsed = null; try { parsed = JSON.parse(savedState); } catch { /* refused below */ }
      if (!parsed || typeof parsed !== 'object' || (parsed.schema == null && !parsed.result)) return await refuse('the saved run state is corrupt; nothing was run and Linear was not reread');
      // A file without a schema is the note of a start refused before any work: there is no run to resume.
      if (parsed.schema != null) {
        const mismatch = recordMismatch(parsed, issueId, configuration);
        if (mismatch) return await refuse(mismatch);
        // A finished run stays finished: its saved result is the answer and nothing runs twice.
        if (parsed.result) return parsed.result;
        record = parsed;
      }
    }
    const persist = async () => { record.updatedAt = now(); await save(statePath, record); };
    const finish = async (result) => {
      if (!record) { await save(statePath, { issueId, configuration, result, finishedAt: now() }); return result; }
      record.stage = 'finished'; record.result = result; record.finishedAt = now();
      await persist(); return result;
    };
    // Before a run has a record a refusal is only a note; after, it is saved beside the record, which keeps its progress.
    const stop = (reason) => (record ? refuse(reason, record.round) : finish(park(reason)));

    if (record) {
      record.restarts += 1;
      const open = record.actions.find((action) => action.status === 'started');
      if (open) {
        const settled = await settleWorker(open, processes);
        if (settled.unsafe && !settled.final) return await refuse(settled.unsafe, open.round);
        open.interruptedAt = now(); open.handling = settled.unsafe ?? settled.handling;
        if (settled.unsafe) { open.status = 'uncertain'; return await finish(unsafe(settled.unsafe, open.round)); }
        if (open.kind === 'review') {
          open.status = 'uncertain';
          return await finish(unsafe('review was interrupted; its provider outcome is ambiguous and is not retried', open.round));
        }
        open.status = 'interrupted';
        // Continue the same spent build/repair; restarting does not buy or
        // consume another repair. Its attempt and interrupted evidence remain.
        if (open.kind === 'build') record.round = open.round;
      }
      // A candidate nobody has reviewed yet is read again: the worktree was unwatched while the runner was down.
      const reviewed = record.actions.some((action) => action.kind === 'review' && action.round === record.round && action.status === 'done');
      for (const action of record.actions) {
        if (action.kind === 'candidate' && action.round === record.round && action.status === 'done' && !reviewed) { action.status = 'stale'; action.handling = 'read again after the restart'; }
        // A verification is never carried across a restart, for the same reason: the runner that records a PASS measures the reviewed candidate itself.
        if (action.kind === 'verify' && action.status === 'done') { action.status = 'stale'; action.handling = 'measured again after the restart'; }
      }
      await persist();
    }
    const blocked = preflight();
    if (blocked) return await stop(blocked);

    let approvedText; try { approvedText = await load(approvedPath); } catch (error) { return await stop(`the saved approved input cannot be read (${error.code ?? error.message}); Linear is not reread to replace it`); }
    if (approvedText == null && record) return await refuse('the saved approved input is missing; Linear is not reread for a started run', record.round);
    let card;
    if (approvedText != null) {
      if (record && sha256(approvedText) !== record.approved.sha256) return await refuse('the saved approved input is not the one this run started with', record.round);
      let approved = null; try { approved = JSON.parse(approvedText); } catch { /* refused below */ }
      if (!approved?.card) return await stop('the saved approved input cannot be read; Linear is not reread to replace it');
      if (approved.configuration && !isDeepStrictEqual(approved.configuration, plain(configuration))) return await stop('the saved approved input was approved for a different builder/reviewer configuration');
      card = { ...approved.card, expectedId: issueId };
    } else {
      const unauthorized = authorizationReason(authorization, issueId, configuration);
      if (unauthorized) return await stop(unauthorized);
      // The single read is deliberately before any worktree or worker operation.
      card = { ...await readCard(issueId), expectedId: issueId };
    }
    const approvedAuthorization = approvedText == null ? authorization : JSON.parse(approvedText).authorization;
    const unauthorized = authorizationReason(approvedAuthorization, issueId, configuration);
    if (unauthorized) return await stop(unauthorized);
    const invalid = refusal(card);
    if (invalid) return await stop(invalid);
    let approvedHash = approvedText == null ? null : sha256(approvedText);
    if (approvedText == null) {
      const approved = { card, configuration, authorization: { ...authorization, configuration: plain(configuration) }, ...approvedInput(card, configuration) };
      approvedHash = sha256(jsonText(approved));
      await save(approvedPath, approved);
    }
    let prepared; try { prepared = await prepareWorktree({ issueId, configuration, runPath, card, saved: record?.worktree ?? null }); } catch (error) { prepared = { ok: false, reason: error.message }; }
    if (!prepared?.ok) return await stop(prepared?.reason ?? 'could not prepare isolated worktree');
    if (record?.worktree?.path && prepared.worktree?.path && record.worktree.path !== prepared.worktree.path) return await refuse(`this run belongs to worktree ${record.worktree.path}, not ${prepared.worktree.path}`, record.round);
    if (!record) { record = newRecord({ issueId, configuration, approvedPath, approvedHash, worktree: prepared.worktree ?? null }); await persist(); }
    if (record.round > MAX_REPAIRS) return await finish(park('the builder was interrupted in the last allowed repair, and no repair is left to finish it', MAX_REPAIRS));

    const isDone = (kind, round) => record.actions.some((action) => action.key === `${kind}:${round}` && action.status === 'done');
    // One journalled step. A step already done is answered from the record.
    const act = async (kind, round, role, run) => {
      const key = `${kind}:${round}`;
      const done = record.actions.find((action) => action.key === key && action.status === 'done');
      if (done) return done.outcome;
      const attempt = record.actions.filter((action) => action.key === key).length + 1;
      const action = { key, kind, round, role, attempt, status: 'started', startedAt: now(), worker: null };
      record.actions.push(action); record.stage = kind; record.round = round;
      if (kind === 'build') record.repairsUsed = round;
      await persist();
      const outcome = await run(async ({ pid }) => { action.worker = { pid, started: await processes.started(pid) }; await persist(); }, attempt) ?? {};
      // A builder's whole output stays in its evidence file; a review's text is its findings and is kept.
      const { text: _text, ...summary } = outcome;
      action.status = 'done'; action.finishedAt = now(); action.outcome = kind === 'build' ? summary : outcome;
      await persist();
      return action.outcome;
    };

    for (let round = record.round; round <= MAX_REPAIRS; round += 1) {
      const findings = record.findings.at(-1)?.text ?? null;
      const interrupted = record.actions.some((action) => action.kind === 'build' && action.round === round && action.status === 'interrupted');
      const evidence = (role, attempt) => join(directory, `${issueId}-${role}-round-${round}${attempt > 1 ? `-attempt-${attempt}` : ''}.json`);
      const builder = await act('build', round, 'builder', (started, attempt) => launch('builder', { prompt: workerPrompt('builder', card, configuration, runPath, approvedPath, findings, interrupted), configuration: configuration.builder, round, started, outputPath: evidence('builder', attempt) }));
      const builderIdentity = validObserved('builder', configuration.builder, builder.observed);
      if (builder.exitCode !== 0 || builderIdentity) return await finish(park(builderIdentity ?? `builder exited ${builder.exitCode}`, round));
      const current = await act('candidate', round, null, () => candidate({ round, previous: record.actions.findLast(action => action.kind === 'candidate' && action.round === round && action.status === 'stale')?.outcome }));
      if (!SHA.test(current?.commit ?? '') || current.clean !== true || current.checks?.pass !== true) return await finish(park(!SHA.test(current?.commit ?? '') ? 'candidate has no immutable commit' : current.clean !== true ? 'candidate drifted or is dirty' : 'candidate checks failed', round));
      if (!isDone('review', round) && record.findings.some(finding => finding.commit === current.commit)) return await finish(park('unchanged candidate: saved review findings require changed checked code before another review', round));
      const handoffPath = join(directory, `${issueId}-handoff-round-${round}.json`);
      const handoff = { issueId, round, approvedPath, candidate: current, builder: { configured: configuration.builder, observed: builder.observed, exitCode: builder.exitCode, outputPath: builder.outputPath ?? null }, createdAt: now() };
      if (!isDone('review', round)) await save(handoffPath, handoff);
      const reviewerConfig = { ...configuration.reviewer, builderMaker: configuration.builder.maker };
      const reviewer = await act('review', round, 'reviewer', (started, attempt) => launch('reviewer', { prompt: `${workerPrompt('reviewer', card, configuration, runPath, approvedPath)}\nHandoff: ${handoffPath}\nCandidate: ${current.commit}`, configuration: reviewerConfig, handoffPath, round, started, outputPath: evidence('reviewer', attempt) }));
      const reviewerIdentity = validObserved('reviewer', reviewerConfig, reviewer.observed);
      const verdict = reviewVerdict(reviewer.text, current.commit);
      await save(handoffPath, { ...handoff, reviewer: { configured: configuration.reviewer, observed: reviewer.observed, exitCode: reviewer.exitCode, outputPath: reviewer.outputPath ?? null, verdict: verdict.verdict ?? null }, result: verdict.error ?? verdict.verdict });
      if (reviewer.exitCode !== 0 || reviewerIdentity || verdict.error) return await finish(park(reviewerIdentity ?? verdict.error ?? `reviewer exited ${reviewer.exitCode}`, round));
      if (verdict.verdict === 'PASS') {
        const afterReview = await act('verify', round, null, () => candidate({ round, afterReview: true, previous: current }));
        if (afterReview?.commit !== current.commit || afterReview.clean !== true || afterReview.checks?.pass !== true) return await finish(park('candidate changed after review', round));
        return await finish({ outcome: 'pass', commit: current.commit, handoffPath });
      }
      // Findings are kept in the record, so a restart repairs the same findings and never forgets a round.
      if (!record.findings.some((finding) => finding.round === round)) { record.findings.push({ round, commit: current.commit, text: reviewer.text, handoffPath }); await persist(); }
    }
    return await finish(park('the initial build and three repairs did not produce a passing reviewed commit', MAX_REPAIRS));
  } finally { await held.release(); }
}

// Production uses the same controller with JUL-122 Git/check preparation.
export async function startDelivery(issueId, configuration, {
  runPath = join(homedir(), '.julia', 'runs', `${issueId}.json`),
  worktree = process.env.JULIA_DELIVERY_WORKTREE,
  repoRoot = process.cwd(), base, authorization,
  readCard = (id) => getIssue(id, { apiKey: process.env.LINEAR_API_KEY }),
  launch, test = request => localTester(request.run === 'suite' ? { ...request, run: 'runnerSuite' } : request),
} = {}) {
  // Protect run files as well as builder source, before locking or any writes.
  assertDeliveryPath(runPath);
  let workspace, approvedCard, instructions;
  const prepareWorktree = async ({ saved, card }) => {
    const prepared = await prepareDeliveryWorkspace({ issueId, runPath, repoRoot, base, worktree, saved });
    workspace = prepared.worktree; approvedCard = card; instructions = prepared.instructions;
    return prepared;
  };
  const launchWorker = async (role, request) => {
    const worker = launch ?? productionLauncher(workspace.path);
    return worker(role, { ...request, worktree: workspace.path,
      prompt: role === 'builder' ? `${request.prompt}\n\nPinned canonical implementation instructions:\n${instructions}` : request.prompt });
  };
  let fixed = null;
  const candidate = async ({ round, afterReview, previous }) => {
    if (afterReview || previous) {
      fixed = previous ?? fixed;
      // Never commit/recheck new source changes under a reviewed SHA.
      const { git } = await import('./julia-minimal-runner-checks.mjs');
      try {
        const clean = git(workspace.path, 'rev-parse', 'HEAD') === fixed.commit && !git(workspace.path, 'status', '--porcelain') && git(workspace.path, 'branch', '--show-current') === workspace.branch;
        const raw = await loadText(fixed.evidencePath);
        const matches = raw && isDeepStrictEqual(JSON.parse(raw), fixed);
        return { ...fixed, clean: clean && Boolean(matches) };
      } catch (error) { return { ...fixed, clean: false, checks: { pass: false, error: error.message } }; }
    }
    fixed = await captureDeliveryCandidate({ issueId, runPath, workspace, card: approvedCard, test, round });
    return fixed;
  };
  return runDelivery({ issueId, configuration, runPath, authorization }, { readCard, launch: launchWorker, candidate, prepareWorktree });
}
