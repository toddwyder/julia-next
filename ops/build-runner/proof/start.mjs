import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const execFileAsync = promisify(execFile);
const require = createRequire(new URL('../../mastra-agents/reviewer/package.json', import.meta.url));
const { chromium } = require('playwright');

const root = new URL('../../../', import.meta.url);
const [controlURL, runnerURL, controlUnit, outputDir] = process.argv.slice(2);
await mkdir(path.join(outputDir, 'job-files'), { recursive: true });

const head = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
const diff = (await execFileAsync('git', ['diff', 'HEAD'], { cwd: root })).stdout;
const untracked = (await execFileAsync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root })).stdout.trim().split(/\n/).filter(Boolean).join('\n');
const source = { head, sha256: crypto.createHash('sha256').update(diff).update('\n').update(untracked).digest('hex') };

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const networkFailures = [];
const consoleMessages = [];
const pageErrors = [];
page.on('requestfailed', r => networkFailures.push({ url: r.url(), time: new Date().toISOString(), error: r.failure()?.errorText }));
page.on('console', m => consoleMessages.push({ type: m.type(), text: m.text() }));
page.on('pageerror', e => pageErrors.push(String(e)));

let lastJob;
try {
  const stateRes = await fetch(`${controlURL}/api/state`);
  assert.equal(stateRes.ok, true);
  const state = await stateRes.json();
  const cardIndex = state.cards.findIndex(x => x.admitted === true && x.card?.identifier === 'JUL-232');
  assert(cardIndex >= 0);
  const offer = state.offers.find(x => x.modelId === 'reflection/beam:free' && x.route === 'commandcode');
  assert(offer);

  await page.goto(controlURL, { waitUntil: 'networkidle' });
  const readyCard = page.locator('select[name="card"]');
  await readyCard.waitFor();
  await readyCard.selectOption(String(cardIndex));
  for (const legend of ['Orchestrator', 'Coder']) {
    const fieldset = page.locator('fieldset').filter({ has: page.locator('legend', { hasText: legend }) });
    await fieldset.locator('select').first().selectOption(`${offer.route}::${offer.modelId}`);
  }

  const startResponsePromise = page.waitForResponse(r => r.request().method() === 'POST' && r.url() === `${controlURL}/api/start`);
  await page.getByRole('button', { name: 'Start' }).click();
  const startResponse = await startResponsePromise;
  assert.equal(startResponse.ok(), true);
  const init = await startResponse.json();
  assert.equal(init.state, 'ready-for-build');
  const initialJob = init.build;
  assert.equal(initialJob.state, 'running');
  const runId = initialJob.runId;

  const currentJobRes = await fetch(`${runnerURL}/jobs/${runId}`);
  assert.equal(currentJobRes.ok, true);
  lastJob = await currentJobRes.json();

  async function procStarttime(pid) {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)[19];
  }
  const runnerPid = initialJob.runnerPid;
  const workerPid = initialJob.workerPid;
  const runnerStarttime = await procStarttime(runnerPid);
  const workerStarttime = await procStarttime(workerPid);
  process.kill(runnerPid, 0);
  process.kill(workerPid, 0);
  const processBefore = { runnerPid, runnerStarttime, workerPid, workerStarttime };

  const restartStart = new Date().toISOString();
  await execFileAsync('systemctl', ['--user', 'restart', controlUnit]);
  const restartEnd = new Date().toISOString();
  process.kill(runnerPid, 0);
  assert.equal(await procStarttime(runnerPid), runnerStarttime);
  let workerAliveAfterRestart = true;
  let workerReadbackAfterRestart = null;
  try {
    process.kill(workerPid, 0);
    assert.equal(await procStarttime(workerPid), workerStarttime);
  } catch (error) {
    const code = error?.code;
    if (code !== 'ESRCH' && code !== 'ENOENT') throw error;
    workerAliveAfterRestart = false;
    const readbackRes = await fetch(`${runnerURL}/jobs/${runId}`);
    assert.equal(readbackRes.ok, true);
    const readbackJob = await readbackRes.json();
    workerReadbackAfterRestart = readbackJob;
    assert.equal(readbackJob.state, 'ready-for-review');
  }
  const restart = { start: restartStart, end: restartEnd, workerAliveAfterRestart, workerReadbackAfterRestart };

  let finalJob;
  for (let i = 0; i < 900; i += 1) {
    const r = await fetch(`${runnerURL}/jobs/${runId}`);
    assert.equal(r.ok, true);
    const job = await r.json();
    lastJob = job;
    if (job.state === 'ready-for-review' || job.state === 'failed') {
      finalJob = job;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert(finalJob, 'job did not finish');
  if (finalJob.state === 'failed') throw new Error(finalJob.error?.message ?? 'job failed');

  const result = finalJob.result;
  assert.equal(result.state, 'ready-for-review');
  assert.deepEqual(result.card, initialJob.snapshot.card);
  assert.deepEqual(result.roles, initialJob.snapshot.roles);
  assert.equal(result.worktree, initialJob.worktree);
  assert.equal(result.baseCommit, initialJob.baseCommit);
  assert.notEqual(result.candidateCommit, result.baseCommit);
  assert.equal(typeof result.threadId, 'string');
  assert.ok(result.threadId.length > 0);
  assert.strictEqual(result.account.spentNano, 0);
  assert.strictEqual(result.account.heldNano, 0);
  assert.strictEqual(result.account.stopped, false);
  assert.equal(result.internalReview.deepseekRefusal, false);
  assert.equal(result.internalReview.deepseekSent, false);
  assert.equal(result.downstreamReviewStarted, false);
  assert(Array.isArray(result.internalReview.starts) && result.internalReview.starts.length > 0);
  assert(Array.isArray(result.internalReview.ends) && result.internalReview.ends.length > 0);
  assert(Array.isArray(result.internalReview.events));
  assert.equal(typeof result.actualModels.orchestrator, 'string');
  assert.equal(typeof result.actualModels.coder, 'string');

  const names = ['settings.json', 'events.jsonl', 'requests.jsonl', 'ledger.json', 'receipt.json', 'job.json', 'pstack-checklist.md', 'pstack-decisions.tsv', 'pstack-state.json', 'receipts.json', 'workflow-feedback.json'];
  for (const name of names) await copyFile(path.join(path.dirname(finalJob.worktree), name), path.join(outputDir, 'job-files', name));
  const settings = JSON.parse(await readFile(path.join(outputDir, 'job-files', 'settings.json'), 'utf8'));
  const events = (await readFile(path.join(outputDir, 'job-files', 'events.jsonl'), 'utf8')).trim().split(/\n/).filter(Boolean).map(JSON.parse);
  const requests = (await readFile(path.join(outputDir, 'job-files', 'requests.jsonl'), 'utf8')).trim().split(/\n/).filter(Boolean).map(JSON.parse);
  const ledger = JSON.parse(await readFile(path.join(outputDir, 'job-files', 'ledger.json'), 'utf8'));

  for (const role of ['orchestrator', 'coder']) {
    const fullId = result.actualModels[role];
    const wireModel = settings.models[fullId].wireModel;
    assert.equal(wireModel, initialJob.snapshot.roles[role].modelId);
    assert.equal(wireModel, 'reflection/beam:free');
  }
  const coderStart = events.find(e => e.type === 'subagent_start' && e.modelId === result.actualModels.coder && /implement|build|write|code/i.test(e.task ?? '') && !/review/i.test(e.task ?? ''));
  assert(coderStart, 'pstack delegated implementation to the saved coder model');
  const coderEnd = events.find(e => e.type === 'subagent_end' && e.toolCallId === coderStart.toolCallId);
  assert.equal(coderEnd?.isError, false);
  const handoff = result.internalReview.reviewHandoff;
  assert(handoff, 'pstack completed its machinery self-check');
  assert.equal(handoff.modelId, coderStart.modelId);
  assert.equal(handoff.modelId, result.actualModels.coder);
  assert.match(handoff.task, /review|audit|judge|self-check/i);
  assert.equal(handoff.refused, false);
  assert(handoff.result);
  const checklist = await readFile(path.join(outputDir, 'job-files', 'pstack-checklist.md'), 'utf8');
  const decisions = await readFile(path.join(outputDir, 'job-files', 'pstack-decisions.tsv'), 'utf8');
  assert(checklist.trim(), 'pstack authored a checklist');
  assert(decisions.trim(), 'pstack authored a decision log');
  assert.equal(checklist, result.internalReview.checklist);
  assert.equal(decisions, result.internalReview.decisions);

  const deepseekRequests = requests.filter(r => String(r.model).includes('deepseek'));
  assert.equal(deepseekRequests.length, 0, 'machinery drive must not dispatch DeepSeek');
  const successfulRequests = requests.filter(r => r.model && typeof r.status === 'number' && r.status >= 200 && r.status < 300);
  assert(successfulRequests.length > 0);
  assert(successfulRequests.every(r => r.model === 'reflection/beam:free'));

  const ledgerAccount = ledger.account ?? ledger;
  assert.equal(ledgerAccount.spentNano, 0);
  assert.equal(ledgerAccount.heldNano, 0);
  assert.equal(ledgerAccount.stopped, false);

  const base = result.baseCommit;
  const candidate = result.candidateCommit;
  const markerExec = await execFileAsync('git', ['show', `${candidate}:BUILD-PHASE-REHEARSAL.txt`], { cwd: finalJob.result.worktree, encoding: 'buffer' });
  const markerBuffer = markerExec.stdout;
  assert(Buffer.isBuffer(markerBuffer));
  assert(markerBuffer.equals(Buffer.from('Julia build-phase rehearsal passed.\n')));
  await writeFile(path.join(outputDir, 'marker.txt'), markerBuffer);

  const diffExec = await execFileAsync('git', ['diff', '--name-only', base, candidate], { cwd: finalJob.result.worktree });
  const changedFiles = diffExec.stdout.trim() ? diffExec.stdout.trim().split(/\n/) : [];
  assert.deepEqual(changedFiles, ['BUILD-PHASE-REHEARSAL.txt']);
  const statusExec = await execFileAsync('git', ['-C', finalJob.result.worktree, 'status', '--porcelain']);
  assert.equal(statusExec.stdout.trim(), '');

  async function stateReady() {
    try {
      const r = await fetch(`${controlURL}/api/state`);
      return r.ok;
    } catch {
      return false;
    }
  }
  for (let i = 0; i < 60; i += 1) {
    if (await stateReady()) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await page.reload({ waitUntil: 'networkidle' });
  const article = page.locator('article').filter({ hasText: runId }).first();
  await article.waitFor({ timeout: 30000 });
  const pre = article.locator('pre[data-testid="saved-build-result"]').first();
  await pre.waitFor({ timeout: 30000 });
  const preText = await pre.textContent();
  assert(preText.includes(candidate));
  assert(preText.includes('ready-for-review'));
  assert.equal(await article.getByText('Downstream Review has not started', { exact: true }).count(), 1);
  await writeFile(path.join(outputDir, 'page.txt'), await page.locator('body').innerText());
  await page.screenshot({ path: path.join(outputDir, 'screenshot.png'), fullPage: true });

  process.kill(runnerPid, 0);
  const processAfter = {
    runnerPid,
    runnerStarttime: await procStarttime(runnerPid),
    workerPid,
    workerStarttime: await (async () => { try { process.kill(workerPid, 0); return await procStarttime(workerPid); } catch { return null; } })(),
    workerAlive: await (async () => { try { process.kill(workerPid, 0); return true; } catch { return false; } })()
  };

  const report = {
    pass: true,
    source,
    runId,
    initialJob,
    finalJob,
    processBefore,
    processAfter,
    restart,
    git: { base, candidate, changedFiles, markerContent: markerBuffer.toString('utf8'), clean: true },
    account: result.account,
    deepseekRefused: false,
    machinerySelfCheck: true,
    pstack: { checklist, decisions, reviewHandoff: handoff },
    pageSavedResult: true,
    network: { failures: networkFailures, console: consoleMessages, pageErrors }
  };
  await writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
} catch (error) {
  try {
    await writeFile(path.join(outputDir, 'report.json'), JSON.stringify({ pass: false, error: String(error?.message ?? error), lastJob }, null, 2));
  } catch {}
  throw error;
} finally {
  await browser?.close();
}
