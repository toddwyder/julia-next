// Existing delivery boundaries retained for the Mastra workflow. This file no longer sequences delivery.
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { safeWorkerEnvironment } from './julia-minimal-runner-checks.mjs';
import { saveJson } from './julia-delivery-state.mjs';
import { LIMITS, runLimited } from '../ops/julia-runner/time-limit.mjs';

const fileSave = saveJson;
const plain = value => JSON.parse(JSON.stringify(value));

export function authorizationReason(authorization, issueId, configuration) {
  if (!authorization || authorization.explicitStart !== true || authorization.issueId !== issueId || (typeof authorization.authorizedBy !== 'string' || !authorization.authorizedBy.trim())) return 'explicit start authorization for this issue is required';
  if (typeof authorization.linearActorId !== 'string' || !authorization.linearActorId.trim()) return 'authorized Linear actor identity is required';
  for (const role of ['builder', 'reviewer']) {
    const spend = authorization.spending?.[role];
    if (!spend || !['subscription', 'paid', 'fixture'].includes(spend.mode) || !Number.isFinite(spend.maxUsd) || spend.maxUsd < 0) return `explicit ${role} spending choice is required`;
    if (spend.mode !== 'paid' && spend.maxUsd !== 0) return `${role} non-paid spending must have a zero dollar limit`;
  }
  if (authorization.configuration && !isDeepStrictEqual(authorization.configuration, plain(configuration))) return 'authorization names a different builder/reviewer configuration';
  return null;
}

export function workerPrompt(role, card, configuration, runPath, approvedPath, findings = null, interrupted = false, round = 0) {
  const chosen = configuration[role];
  const common = `Issue: ${card.identifier}\nSaved run: ${runPath}\nApproved input: ${approvedPath}\nConfigured ${role}: ${JSON.stringify(chosen)}`;
  // A builder that follows an interrupted one inherits its unfinished edits; it is told so, never left to guess.
  const resumed = interrupted ? '\n\nThe previous builder for this work was interrupted before it finished. Its partial changes are still in the worktree: inspect them first (git status, git diff) and finish the work from there. Do not discard them or start over.' : '';
  if (role === 'builder') return `${common}\n\nExplicitly read and follow .claude/skills/implement/SKILL.md for ${card.identifier}. The approved requirements are only in ${approvedPath}; do not reread Linear. Work only in the prepared isolated worktree.${resumed}${findings ? `\n\nRepair these review findings:\n${findings}` : ''}`;
  const scope = round === 0
    ? 'Perform the full adversarial review of the changed, checked immutable candidate.'
    : 'Check the repairs and relevant regressions on the changed, checked immutable candidate; do not repeat the entire initial review.';
  return `Issue: ${card.identifier}\nConfigured reviewer: ${JSON.stringify(chosen)}\n\nExplicitly read and follow .agents/skills/adversarial-review/SKILL.md (the complete pinned instructions are supplied below). ${scope} Use only the supplied review input in one fresh session. Keep Standards and Spec separate in the report. Save and reuse this review for this candidate; no polling or retry after an ambiguous or failing call, and no unchanged rereview.`;
}

function failure(operation, error) {
  return error ? { operation, code: error.code ?? null, message: String(error.message ?? error) } : null;
}

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

export function productionLauncher(worktree, { run = runLimited, environment = process.env, findExecutable = nativeCommand, sessionRoot = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions') } = {}) {
  const workerEnvironment = safeWorkerEnvironment(environment);
  const runWorker = (command, args, options, limits) => run(command, args, { ...options, env: workerEnvironment }, limits);
  return async (role, request) => {
    const configured = request.configuration;
    // Review-only work is the Mastra path.  It receives metadata and reads the
    // immutable candidate through its own read-only Git tools, rather than
    // putting changed files in a provider prompt.
    if (role === 'reviewer' && request.mastraReviewOnly === true && request.reviewInput && request.issueId && request.candidate && configured.connection?.provider === 'commandcode') {
      let stdout = ''; let stderr = ''; let recorded = false;
      const startedAt = new Date().toISOString();
      // The reviewer executable is controller code, never code from the
      // candidate worktree that receives the provider credential.
      const script = resolve(import.meta.dirname, '..', 'ops', 'mastra-agents', 'reviewer', 'src', 'reviewer.mjs');
      const verdictPath = `${request.outputPath}.verdict.json`;
      const result = await run(process.execPath, [script], { cwd: dirname(script), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...workerEnvironment, COMMANDCODE_API_KEY: environment.COMMANDCODE_API_KEY } }, {
        seconds: 20 * 60,
        started: child => {
          child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.stdin.on('error', () => {});
          Promise.resolve(request.started?.({ pid: child.pid })).then(() => {
            recorded = true;
            child.stdin.end(JSON.stringify({ issueId: request.issueId, runId: request.runId ?? basename(dirname(request.outputPath ?? verdictPath)), repoRoot: request.repoRoot ?? worktree, candidate: request.candidate, input: request.reviewInput, configuration: configured, spending: request.spending, cardBudgetPath: request.spending?.ledgerPath, round: request.round, verdictPath }));
          }, () => child.kill());
        },
      });
      let reply = null; try { reply = JSON.parse(stdout); } catch { /* durable sidecar checked below */ }
      if (!reply && existsSync(verdictPath)) try { reply = JSON.parse(readFileSync(verdictPath, 'utf8')); } catch { /* recorded below */ }
      let technicalFailure = null;
      let plannedGate = null;
      let providerAcceptance = null;
      let recordedCostUsd = null;
      const failurePath = `${verdictPath}.failure.json`;
      if (existsSync(failurePath)) {
        try {
          const failure = JSON.parse(readFileSync(failurePath, 'utf8'));
          if (failure?.kind === 'technical-failure' && typeof failure.reason === 'string') {
            technicalFailure = failure.reason;
            plannedGate = typeof failure.plannedGate === 'string' ? failure.plannedGate : null;
            if (failure.providerAcceptance === 'not-accepted' && failure.costUsd === 0) {
              providerAcceptance = failure.providerAcceptance;
              recordedCostUsd = failure.costUsd;
            }
          }
        } catch { /* malformed failure evidence is not trusted */ }
      }
      const durableVerdict = typeof reply?.text === 'string' && /^VERDICT: (?:PASS|FAIL|INCONCLUSIVE)\b/.test(reply.text);
      const workerSucceeded = result.code === 0 && result.stopped !== true;
      const exitCode = recorded && durableVerdict && workerSucceeded ? 0 : 2;
      const observed = reply?.observed ? { ...reply.observed, harness: configured.harness, maker: configured.maker } : null;
      const deliveryResult = {
        exitCode, observed, text: reply?.text ?? technicalFailure ?? stderr, technicalFailure, plannedGate,
        outputPath: request.outputPath ?? null, responseId: reply?.responseId ?? null, traceId: reply?.traceId ?? null,
        usage: reply?.usage ?? null, costEstimateUsd: reply?.costEstimateUsd ?? recordedCostUsd,
        providerAcceptance,
      };
      if (request.outputPath) await fileSave(request.outputPath, { role, configured, observed, startedAt, finishedAt: new Date().toISOString(), stdout, stderr, exitCode, technicalFailure, plannedGate, traceId: reply?.traceId ?? null, responseId: reply?.responseId ?? null, quotes: reply?.quotes ?? [], warnings: reply?.warnings ?? [], deliveryResult });
      return deliveryResult;
    }
    if (role === 'reviewer') return { exitCode: 2, observed: null, text: 'Reviewer execution is disabled during the JUL-223 reset' };
    const cwd = role === 'builder' ? worktree : tmpdir();
    const startedAt = new Date().toISOString();
    // A worker whose executable cannot be found is recorded like one that could not be started.
    let command = null; let failed = null;
    try { command = findExecutable(configured.harness); }
    catch (cause) { failed = failure(`find ${configured.harness} executable`, cause); }
    const args = configured.harness === 'claude-code' ? ['-p', '--model', configured.model, '--effort', configured.thinking ?? 'high', '--output-format', 'stream-json', '--verbose', '--permission-mode', role === 'builder' ? 'acceptEdits' : 'default', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', role === 'builder' ? 'Read,Edit,Write,Bash,Glob,Grep,Skill' : '', ...(role === 'builder' ? ['--allowedTools', 'Read,Edit,Write,Glob,Grep,Skill,Bash(node --test *),Bash(git status *),Bash(git diff *)'] : [])]
      : configured.harness === 'codex' ? ['exec', ...(configured.model ? ['-m', configured.model] : []), '-c', 'model_provider="openai"', '-c', 'approval_policy="never"', ...(configured.thinking ? ['-c', `model_reasoning_effort="${configured.thinking}"`] : []), '-s', role === 'builder' ? 'workspace-write' : 'read-only', '--skip-git-repo-check', '--json', '-'] : [];
    if (!command && !failed) return { exitCode: 2, observed: null, text: `unsupported harness ${configured.harness}` };
    let output = ''; let error = ''; let pid = null; let unrecorded = null;
    const result = failed ? { code: null, signal: null, stopped: false } : await runWorker(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }, {
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
    const reply = output; const responseId = identityEvidence?.thread ?? null;
    const finishedAt = new Date().toISOString();
    const exitCode = result.stopped ? 124 : unrecorded || (role === 'reviewer' && failed) ? 1 : result.code ?? 1;
    // The worker's own streams are the evidence; nothing here is summarised.
    const deliveryResult = { exitCode, observed: identity ?? null, text: reply || error || failed?.message || '', outputPath: request.outputPath ?? null, timedOut: result.stopped, responseId, startedAt, finishedAt, connection: configured.connection };
    if (request.outputPath) await fileSave(request.outputPath, { role, configured, observed: identity ?? null, identityEvidence, command, args, cwd, pid, exitCode, signal: result.signal ?? null, timedOut: result.stopped, error: failed, startedAt, finishedAt, responseId, stdout: output, stderr: error, deliveryResult });
    return deliveryResult;
  };
}
