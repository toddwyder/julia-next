import dns from 'node:dns';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCatalog, readCorrections } from '../dashboard/lib/model-prices.js';
import { pricedModels, readModels } from '../dashboard/lib/models.js';
import { getInstallationToken, githubApi, runnerConfigDir } from './julia-runner-app.mjs';

const COMMANDCODE_CHAT_URL = 'https://api.commandcode.ai/provider/v1/chat/completions';

export const DEFAULT_OWNER = 'toddwyder';
export const DEFAULT_REPO = 'julia-next';
export const NTFY_MAX_BYTES = 4096;
export const FALLBACK_REPORT_MODELS = [
  'commandcode/stealth/glyph-cluster:free',
  'commandcode/Qwen/Qwen3.7-Flash',
];

export function reportLinkTarget({ prUrl, commentUrl }) {
  return commentUrl || prUrl;
}

export function shouldNotify(report) {
  return Boolean(report?.hasNewFeatures || report?.failed || report?.needsToddDecision);
}

export function reportKey({ prNumber, commitSha }) {
  return `pr=${prNumber} commit=${commitSha}`;
}

export function reportMarker({ prNumber, commitSha }) {
  return `<!-- julia-update-report: ${reportKey({ prNumber, commitSha })} -->`;
}

export function hasExistingReport(comments, coords) {
  const marker = reportMarker(coords);
  return (comments ?? []).some(comment => String(comment?.body ?? '').includes(marker));
}

export function stateFilePath() {
  return process.env.JULIA_UPDATE_REPORT_STATE ?? join(homedir(), '.local', 'state', 'julia-runner', 'update-reports.json');
}

export function readState(file = stateFilePath()) {
  if (!existsSync(file)) return { reports: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed.reports === 'object' ? parsed : { reports: {} };
  } catch {
    return { reports: {} };
  }
}

export function writeStateAtomic(state, file = stateFilePath()) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(temp, file);
}

export function truncateUtf8Bytes(text, maxBytes = NTFY_MAX_BYTES) {
  const input = String(text ?? '');
  if (Buffer.byteLength(input, 'utf8') <= maxBytes) return input;
  const suffix = '\n...(truncated)';
  const limit = Math.max(0, maxBytes - Buffer.byteLength(suffix, 'utf8'));
  let end = input.length;
  while (end > 0 && Buffer.byteLength(input.slice(0, end), 'utf8') > limit) {
    end -= 1;
  }
  return `${input.slice(0, end)}${suffix}`;
}

export function validateReport(raw, { prFailed = false } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Report agent output must be a JSON object.');
  }
  const updated = Array.isArray(raw.updated)
    ? raw.updated.filter(item => item && item.name).map(item => ({
        name: String(item.name).trim(),
        from: String(item.from ?? 'unknown').trim(),
        to: String(item.to ?? 'unknown').trim(),
      }))
    : [];
  const newFeatures = Array.isArray(raw.newFeatures)
    ? raw.newFeatures.filter(item => item && (item.title || item.plainEnglish)).map(item => ({
        title: String(item.title ?? 'New feature').trim(),
        plainEnglish: String(item.plainEnglish ?? '').trim(),
        machineUse: String(item.machineUse ?? 'No direct machine use identified.').trim(),
      }))
    : [];
  const fixes = Array.isArray(raw.fixes)
    ? raw.fixes.filter(item => item && (item.title || item.plainEnglish)).map(item => ({
        title: String(item.title ?? 'Fix').trim(),
        plainEnglish: String(item.plainEnglish ?? '').trim(),
      }))
    : [];
  const outcome = String(raw.outcome ?? '').trim();
  if (!outcome) throw new Error('Report agent output must include a non-empty outcome.');
  const toddAction = String(raw.toddAction ?? 'Nothing.').trim() || 'Nothing.';
  const needsToddDecision = Boolean(raw.needsToddDecision);
  const failed = Boolean(prFailed || raw.failed);
  const hasNewFeatures = newFeatures.length > 0 || Boolean(raw.hasNewFeatures);

  return {
    updated,
    newFeatures,
    fixes,
    outcome,
    toddAction,
    needsToddDecision,
    hasNewFeatures,
    failed,
  };
}

export function formatReportMarkdown({ report, prNumber, commitSha, modelId, releaseUrls = [] }) {
  const lines = ['## Update report', ''];
  lines.push('**What was updated**');
  if (report.updated.length === 0) {
    lines.push('- See pull request diff.');
  } else {
    for (const item of report.updated) {
      lines.push(`- \`${item.name}\`: ${item.from} -> ${item.to}`);
    }
  }
  lines.push('');

  lines.push('**New features**');
  if (report.newFeatures.length === 0) {
    lines.push('None.');
  } else {
    for (const feat of report.newFeatures) {
      lines.push(`- **${feat.title}**: ${feat.plainEnglish}`);
      lines.push(`  - *How the machine could use this*: ${feat.machineUse}`);
    }
  }
  lines.push('');

  lines.push('**Fixes**');
  if (report.fixes.length === 0) {
    lines.push('None.');
  } else {
    for (const fix of report.fixes) {
      lines.push(`- **${fix.title}**: ${fix.plainEnglish}`);
    }
  }
  lines.push('');

  lines.push(`**What happened**: ${report.outcome}`);
  lines.push('');
  lines.push(`**What Todd needs to do**: ${report.toddAction}`);
  if (releaseUrls.length > 0) {
    lines.push('');
    lines.push(`**Release notes**: ${releaseUrls.join(', ')}`);
  }
  lines.push('');
  lines.push(`<sub>Generated by Julia Update Reporter (${modelId})</sub>`);
  lines.push(reportMarker({ prNumber, commitSha }));
  return lines.join('\n');
}

export function formatNtfyMessage({ prNumber, prTitle, report }) {
  const reasons = [];
  if (report.failed) reasons.push('failed');
  if (report.hasNewFeatures) reasons.push('new features');
  if (report.needsToddDecision) reasons.push('needs decision');
  const tag = reasons.join(', ') || 'update';
  const title = `Julia update #${prNumber} (${tag}): ${prTitle}`.slice(0, 120);

  const parts = [];
  if (report.updated.length > 0) {
    parts.push(`Updated: ${report.updated.map(u => `${u.name} ${u.from}->${u.to}`).join(', ')}`);
  }
  if (report.newFeatures.length > 0) {
    parts.push(`New features:\n${report.newFeatures.map(f => `- ${f.title}: ${f.plainEnglish}`).join('\n')}`);
  }
  parts.push(`Outcome: ${report.outcome}`);
  if (report.needsToddDecision || report.failed) {
    parts.push(`Todd action: ${report.toddAction}`);
  }
  return {
    title,
    message: truncateUtf8Bytes(parts.join('\n\n'), NTFY_MAX_BYTES),
  };
}

export function pickReportModelCandidates() {
  if (process.env.JULIA_UPDATE_REPORT_MODEL) {
    return [process.env.JULIA_UPDATE_REPORT_MODEL];
  }
  try {
    const { models } = readModels();
    const priced = pricedModels(models, { catalog: loadCatalog(), corrections: readCorrections() })
      .filter(model => !/embedding/i.test(model.id))
      .sort((a, b) => ((a.price.inputPerMillion ?? 999) + (a.price.outputPerMillion ?? 999)) - ((b.price.inputPerMillion ?? 999) + (b.price.outputPerMillion ?? 999)));
    const ids = priced.map(model => model.id);
    return [...new Set([...FALLBACK_REPORT_MODELS, ...ids])];
  } catch {
    return [...FALLBACK_REPORT_MODELS];
  }
}

export function parsePackageUpdatesFromDiff(files = [], prTitle = '') {
  const updates = new Map();
  for (const file of files) {
    const patch = String(file.patch ?? '');
    if (file.filename === 'package.json' || file.filename === 'dashboard/package.json') {
      const removed = new Map();
      const added = new Map();
      for (const line of patch.split('\n')) {
        const match = line.match(/^([+-])\s*"([^"]+)":\s*"([^"]+)"/);
        if (!match) continue;
        const [, sign, name, version] = match;
        if (['version', 'name', 'private', 'type'].includes(name)) continue;
        const clean = version.replace(/^[\^~>=<]+/, '');
        if (sign === '-') removed.set(name, clean);
        if (sign === '+') added.set(name, clean);
      }
      for (const [name, to] of added) {
        if (removed.has(name) && removed.get(name) !== to) {
          updates.set(name, { name, from: removed.get(name), to });
        }
      }
    } else if (file.filename === '.nvmrc') {
      const minus = patch.match(/^-\s*([0-9.]+)/m)?.[1];
      const plus = patch.match(/^\+\s*([0-9.]+)/m)?.[1];
      if (minus && plus && minus !== plus) {
        updates.set('node', { name: 'node', from: minus, to: plus });
      }
    } else if (file.filename === '.agents/skills/PSTACK-SOURCE.md') {
      const from = patch.match(/^-Version:\s*(\S+)/m)?.[1] ?? patch.match(/^-Commit:\s*([0-9a-f]{7,40})/m)?.[1];
      const to = patch.match(/^\+Version:\s*(\S+)/m)?.[1] ?? patch.match(/^\+Commit:\s*([0-9a-f]{7,40})/m)?.[1];
      if (from && to && from !== to) {
        updates.set('backnotprop/pstack', { name: 'backnotprop/pstack', from, to });
      }
    }
  }
  if (updates.size === 0 && prTitle) {
    const match = prTitle.match(/update (?:dependency )?(\S+) (?:from (\S+) )?to v?(\S+)/i);
    if (match) {
      updates.set(match[1], { name: match[1], from: match[2] ?? 'previous', to: match[3] });
    }
  }
  return [...updates.values()];
}

function parseGitHubRepo(repoUrl = '') {
  const match = String(repoUrl).match(/github\.com[/:]([^/]+)\/([^/.#]+)/i);
  return match ? `${match[1]}/${match[2]}` : null;
}

function cleanVersion(version) {
  return String(version ?? '').replace(/^v/, '').replace(/^[\^~>=<]+/, '');
}

export async function fetchReleaseNotesForPackage(pkg, { fetchImpl = fetch, githubToken } = {}) {
  let repoSlug = null;
  if (pkg.name === 'node') {
    repoSlug = 'nodejs/node';
  } else if (pkg.name === 'backnotprop/pstack') {
    repoSlug = 'backnotprop/pstack';
  } else if (pkg.name === 'mattpocock/skills') {
    repoSlug = 'mattpocock/skills';
  } else {
    try {
      const npmRes = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (npmRes.ok) {
        const meta = await npmRes.json();
        repoSlug = parseGitHubRepo(meta?.repository?.url ?? meta?.homepage ?? '');
      }
    } catch {
      // Ignore npm metadata lookup errors; we fall back gracefully.
    }
  }

  if (!repoSlug) return { package: pkg.name, repo: null, urls: [], notes: '' };

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'julia-runner',
  };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

  try {
    const relRes = await fetchImpl(`https://api.github.com/repos/${repoSlug}/releases?per_page=25`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (relRes.ok) {
      const releases = await relRes.json();
      const target = cleanVersion(pkg.to);
      const from = cleanVersion(pkg.from);
      const matched = [];
      for (const rel of releases) {
        const tag = cleanVersion(rel.tag_name ?? '');
        if (tag === target || tag.endsWith(`@${target}`) || tag.endsWith(`-v${target}`)) {
          matched.push(rel);
        } else if (matched.length > 0 && from && tag !== from && !tag.endsWith(`@${from}`)) {
          if (matched.length < 5) matched.push(rel);
        } else if (matched.length > 0 && from && (tag === from || tag.endsWith(`@${from}`))) {
          break;
        }
      }
      if (matched.length > 0) {
        return {
          package: pkg.name,
          repo: repoSlug,
          urls: matched.map(r => r.html_url).filter(Boolean),
          notes: matched.map(r => `### ${r.name || r.tag_name}\n${r.body || ''}`).join('\n\n').slice(0, 12_000),
        };
      }
    }
  } catch {
    // Fall through to empty notes.
  }
  return { package: pkg.name, repo: repoSlug, urls: [], notes: '' };
}

async function callCommandCodeModel({ modelId, instructions, prompt, fetchImpl = fetch }) {
  const apiKey = process.env.COMMANDCODE_API_KEY ?? process.env.CMD_API_KEY;
  if (!apiKey) throw new Error('COMMANDCODE_API_KEY is missing; run through scripts/julia-agents.mjs.');
  const model = modelId.replace(/^commandcode\//, '');
  const response = await fetchImpl(COMMANDCODE_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`CommandCode ${modelId} failed (${response.status}): ${data?.error?.message ?? response.statusText}`);
  }
  return String(data?.choices?.[0]?.message?.content ?? '').trim();
}

export async function generateUpdateReport({ pr, updates, releaseNotes, ciSummary, modelCandidates = pickReportModelCandidates(), modelCaller = callCommandCodeModel }) {
  const instructions = [
    'You write plain-English software update reports for Todd, a non-developer homeowner using Julia.',
    'Use ONLY facts present in the pull request, updated package list, CI status, and maker release notes provided.',
    'Do NOT invent features or fixes that are not in the release notes.',
    'Classify genuine new capabilities, new CLI/API flags, new runtime support, or new tools as newFeatures.',
    'For each new feature, explain what it does in plain English AND how Julia (a Next.js household cookbook + Mastra/pstack coding machine) could use it.',
    'Classify bug fixes, security patches, dependency bumps, and refactors as fixes.',
    'Return ONLY a single JSON object with keys: updated (array of {name, from, to}), newFeatures (array of {title, plainEnglish, machineUse}), fixes (array of {title, plainEnglish}), outcome (string), toddAction (string), needsToddDecision (boolean), hasNewFeatures (boolean), failed (boolean).',
  ].join(' ');

  const prompt = JSON.stringify({
    pullRequest: {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      merged: Boolean(pr.merged_at),
      author: pr.user?.login,
      body: String(pr.body ?? '').slice(0, 2000),
    },
    ciSummary,
    updates,
    releaseNotes,
  });

  let lastError;
  for (const modelId of modelCandidates) {
    if (!modelId.startsWith('commandcode/')) continue;
    try {
      const text = await modelCaller({ modelId, instructions, prompt });
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error(`Model ${modelId} did not return JSON.`);
      const parsed = JSON.parse(jsonMatch[0]);
      const report = validateReport(parsed, { prFailed: ciSummary.failed });
      return { report, modelId };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('No report model succeeded.');
}

function postIpv4(urlString, { headers, body }) {
  const url = new URL(urlString);
  const transport = url.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const req = transport.request(url, {
      method: 'POST',
      lookup: (hostname, opts, cb) => dns.lookup(hostname, { ...opts, family: 4 }, cb),
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(body, 'utf8'),
      },
      timeout: 15_000,
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: async () => text });
      });
    });
    req.on('timeout', () => req.destroy(new Error('ntfy request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

export async function sendNtfyNotification({ report, pr, commentUrl, configDir = runnerConfigDir(), fetchImpl }) {
  const ntfyPath = join(configDir, 'ntfy.json');
  if (!existsSync(ntfyPath)) {
    throw new Error(`Missing ntfy config at ${ntfyPath}.`);
  }
  const { server = 'https://ntfy.sh', topic } = JSON.parse(readFileSync(ntfyPath, 'utf8'));
  if (!topic) throw new Error(`Missing ntfy topic in ${ntfyPath}.`);

  const target = reportLinkTarget({ prUrl: pr.html_url, commentUrl });
  const { title, message } = formatNtfyMessage({ prNumber: pr.number, prTitle: pr.title, report });
  const endpoint = `${server.replace(/\/$/, '')}/${encodeURIComponent(topic)}`;
  const headers = {
    Title: title,
    Click: target,
    Priority: report.failed ? 'high' : 'default',
    Tags: report.failed ? 'warning' : report.hasNewFeatures ? 'sparkles' : 'bell',
    'Content-Type': 'text/plain; charset=utf-8',
  };
  const response = fetchImpl
    ? await fetchImpl(endpoint, { method: 'POST', headers, body: message, signal: AbortSignal.timeout(15_000) })
    : await postIpv4(endpoint, { headers, body: message });
  if (!response.ok) {
    throw new Error(`ntfy POST failed (${response.status}): ${await response.text()}`);
  }
  return { title, target, bytes: Buffer.byteLength(message, 'utf8') };
}

export function isUpdatePr(pr) {
  const author = String(pr.user?.login ?? '').toLowerCase();
  const branch = String(pr.head?.ref ?? '').toLowerCase();
  const title = String(pr.title ?? '').toLowerCase();
  if (author.includes('renovate')) return true;
  if (branch.startsWith('renovate/') || branch.startsWith('chore/update-') || branch.startsWith('chore/skills-')) return true;
  return /^(chore|fix)\((deps|skills|renovate)\):/.test(title);
}

export async function getCiSummary(owner, repo, sha, { token, fetchImpl = fetch }) {
  const checks = await githubApi(`/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=50`, { token, fetchImpl });
  const runs = checks?.check_runs ?? [];
  const failedRuns = runs.filter(run => run.status === 'completed' && ['failure', 'timed_out', 'cancelled', 'action_required'].includes(run.conclusion));
  const pendingRuns = runs.filter(run => run.status !== 'completed');
  return {
    total: runs.length,
    failed: failedRuns.length > 0,
    pending: pendingRuns.length > 0,
    failedNames: failedRuns.map(run => run.name),
  };
}

export async function processPullRequest(pr, {
  owner = DEFAULT_OWNER,
  repo = DEFAULT_REPO,
  token,
  state,
  statePath = stateFilePath(),
  configDir = runnerConfigDir(),
  fetchImpl = fetch,
  generateImpl = generateUpdateReport,
  notifyImpl = sendNtfyNotification,
  dryRun = false,
} = {}) {
  const commitSha = pr.merged_at ? pr.merge_commit_sha : pr.head?.sha;
  if (!commitSha) return { prNumber: pr.number, status: 'skipped-no-sha' };

  const key = reportKey({ prNumber: pr.number, commitSha });
  const existingRecord = state.reports[key] ?? {};
  const comments = await githubApi(`/repos/${owner}/${repo}/issues/${pr.number}/comments?per_page=100`, { token, fetchImpl });
  const alreadyCommented = Boolean(existingRecord.commentedAt) || hasExistingReport(comments, { prNumber: pr.number, commitSha });

  const ciSummary = await getCiSummary(owner, repo, pr.head.sha, { token, fetchImpl });
  if (!pr.merged_at && !ciSummary.failed) {
    return { prNumber: pr.number, status: 'skipped-open-not-failed' };
  }
  if (alreadyCommented && existingRecord.commentedAt && (!existingRecord.needsNotification || existingRecord.notifiedAt)) {
    return { prNumber: pr.number, status: 'already-handled' };
  }

  const files = await githubApi(`/repos/${owner}/${repo}/pulls/${pr.number}/files?per_page=100`, { token, fetchImpl });
  const updates = parsePackageUpdatesFromDiff(files, pr.title);
  const releaseNotes = await Promise.all(updates.map(pkg => fetchReleaseNotesForPackage(pkg, { fetchImpl, githubToken: token })));
  const releaseUrls = releaseNotes.flatMap(r => r.urls);

  const { report, modelId } = await generateImpl({ pr, updates, releaseNotes, ciSummary });
  const needsNotification = shouldNotify(report);

  let commentUrl = existingRecord.commentUrl ?? comments.find(c => String(c?.body ?? '').includes(reportMarker({ prNumber: pr.number, commitSha })))?.html_url ?? null;
  if (!alreadyCommented && !dryRun) {
    const body = formatReportMarkdown({ report, prNumber: pr.number, commitSha, modelId, releaseUrls });
    const posted = await githubApi(`/repos/${owner}/${repo}/issues/${pr.number}/comments`, {
      token,
      method: 'POST',
      body: { body },
      fetchImpl,
    });
    commentUrl = posted.html_url;
  }
  if (!dryRun && !existingRecord.commentedAt) {
    state.reports[key] = {
      ...existingRecord,
      prNumber: pr.number,
      commitSha,
      modelId,
      needsNotification,
      commentedAt: new Date().toISOString(),
      commentUrl,
    };
    writeStateAtomic(state, statePath);
  }

  let notified = false;
  if (needsNotification && !existingRecord.notifiedAt && !dryRun) {
    await notifyImpl({ report, pr, commentUrl, configDir, fetchImpl });
    state.reports[key] = {
      ...state.reports[key],
      notifiedAt: new Date().toISOString(),
    };
    writeStateAtomic(state, statePath);
    notified = true;
  }

  return { prNumber: pr.number, commitSha, modelId, needsNotification, notified, commentUrl, report };
}

export async function runUpdateReports({
  owner = DEFAULT_OWNER,
  repo = DEFAULT_REPO,
  prNumber = null,
  lookbackHours = 24,
  dryRun = false,
  configDir = runnerConfigDir(),
  statePath = stateFilePath(),
} = {}) {
  const token = await getInstallationToken({ configDir });
  const state = readState(statePath);

  let candidates;
  if (prNumber) {
    const pr = await githubApi(`/repos/${owner}/${repo}/pulls/${prNumber}`, { token });
    candidates = [pr];
  } else {
    const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;
    const pulls = await githubApi(`/repos/${owner}/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=20`, { token });
    candidates = pulls.filter(pr => {
      if (!isUpdatePr(pr)) return false;
      const updatedMs = Date.parse(pr.merged_at ?? pr.updated_at);
      return Number.isFinite(updatedMs) && updatedMs >= cutoff;
    });
  }

  const results = [];
  for (const pr of candidates) {
    results.push(await processPullRequest(pr, { owner, repo, token, state, statePath, configDir, dryRun }));
  }
  return results;
}

function parseCliArgs(argv) {
  const options = { prNumber: null, lookbackHours: 24, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--pr' && argv[i + 1]) options.prNumber = Number(argv[++i]);
    else if (argv[i] === '--lookback-hours' && argv[i + 1]) options.lookbackHours = Number(argv[++i]);
    else if (argv[i] === '--dry-run') options.dryRun = true;
  }
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const opts = parseCliArgs(process.argv.slice(2));
  const results = await runUpdateReports(opts);
  console.log(JSON.stringify(results, null, 2));
}
