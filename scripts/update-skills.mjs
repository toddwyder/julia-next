import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JULIA_SKILLS, checkPstackPin, readPin } from './check-pstack-pin.mjs';
import { checkSkillVersions } from './check-skill-versions.mjs';
import { getInstallationToken, githubApi, runnerConfigDir } from './julia-runner-app.mjs';
import { scratchDir } from './scratch-dir.mjs';

export const DEFAULT_OWNER = 'toddwyder';
export const DEFAULT_REPO = 'julia-next';
export const PSTACK_REPO = 'backnotprop/pstack';
export const POCOCK_REPO = 'mattpocock/skills';

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function formatInstalledDate(date = new Date()) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function readCurrentPocockRef(root = process.cwd()) {
  const lock = JSON.parse(readFileSync(join(root, 'skills-lock.json'), 'utf8'));
  for (const entry of Object.values(lock.skills ?? {})) {
    if (entry?.source === POCOCK_REPO && entry?.ref) return entry.ref;
  }
  return null;
}

export function applyPstackMirrorToTree({ root, mirrorDir, commit, version, installedDate = formatInstalledDate() }) {
  const agentsSkills = join(root, '.agents/skills');
  mkdirSync(agentsSkills, { recursive: true });

  const upstreamSkillDirs = new Map();
  for (const relBase of ['skills', 'automations/benny/skills']) {
    const base = join(mirrorDir, relBase);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) upstreamSkillDirs.set(entry.name, join(base, entry.name));
    }
  }

  for (const entry of readdirSync(agentsSkills, { withFileTypes: true })) {
    if (entry.isDirectory() && !JULIA_SKILLS.has(entry.name)) {
      rmSync(join(agentsSkills, entry.name), { recursive: true, force: true });
    }
  }

  for (const [name, src] of upstreamSkillDirs) {
    cpSync(src, join(agentsSkills, name), { recursive: true });
  }

  rmSync(join(root, '.agents/docs'), { recursive: true, force: true });
  cpSync(join(mirrorDir, 'docs'), join(root, '.agents/docs'), { recursive: true });
  cpSync(join(mirrorDir, 'README.md'), join(root, '.agents/README.md'));
  cpSync(join(mirrorDir, 'LICENSE'), join(agentsSkills, 'PSTACK-LICENSE.txt'));

  const sourceDocPath = join(agentsSkills, 'PSTACK-SOURCE.md');
  let sourceDoc = readFileSync(sourceDocPath, 'utf8');
  sourceDoc = sourceDoc
    .replace(/^Commit: .+$/m, `Commit: ${commit}`)
    .replace(/^Version: .+$/m, `Version: ${version} (.cursor-plugin/plugin.json and plugin.json at that commit)`)
    .replace(/^Installed: .+$/m, `Installed: ${installedDate}`)
    .replaceAll(/backnotprop\/pstack#[0-9a-f]{7,40}/g, `backnotprop/pstack#${commit}`);
  writeFileSync(sourceDocPath, sourceDoc, 'utf8');

  const lockPath = join(root, 'skills-lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  for (const [name, entry] of Object.entries(lock.skills ?? {})) {
    if (entry?.source !== PSTACK_REPO) continue;
    entry.ref = commit;
    const skillMd = join(agentsSkills, name, 'SKILL.md');
    if (existsSync(skillMd)) entry.computedHash = sha256File(skillMd);
  }
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

export function applyPocockReleaseToTree({ root, mirrorDir, tag }) {
  const lockPath = join(root, 'skills-lock.json');
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const claudeSkills = join(root, '.claude/skills');
  mkdirSync(claudeSkills, { recursive: true });

  for (const [name, entry] of Object.entries(lock.skills ?? {})) {
    if (entry?.source !== POCOCK_REPO) continue;
    entry.ref = tag;
    const skillMdRel = entry.skillPath;
    if (skillMdRel) {
      const upstreamSkillDir = join(mirrorDir, dirname(skillMdRel));
      const targetDir = join(claudeSkills, name);
      if (existsSync(upstreamSkillDir)) {
        rmSync(targetDir, { recursive: true, force: true });
        cpSync(upstreamSkillDir, targetDir, { recursive: true });
      }
      const installedMd = join(targetDir, 'SKILL.md');
      if (existsSync(installedMd)) entry.computedHash = sha256File(installedMd);
    }
  }
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

export async function fetchUpstreamSkillTargets({ fetchImpl = fetch, githubToken } = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'julia-runner' };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

  const pstackCommitRes = await fetchImpl(`https://api.github.com/repos/${PSTACK_REPO}/commits/main`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!pstackCommitRes.ok) throw new Error(`Failed to fetch ${PSTACK_REPO} main commit (${pstackCommitRes.status})`);
  const pstackCommit = await pstackCommitRes.json();
  const pstackSha = pstackCommit.sha;

  let pstackVersion = pstackSha.slice(0, 7);
  const pluginRes = await fetchImpl(
    `https://api.github.com/repos/${PSTACK_REPO}/contents/.cursor-plugin/plugin.json?ref=${pstackSha}`,
    { headers, signal: AbortSignal.timeout(15_000) },
  );
  if (pluginRes.ok) {
    const file = await pluginRes.json();
    const decoded = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    if (decoded?.version) pstackVersion = String(decoded.version);
  }

  const pocockRes = await fetchImpl(`https://api.github.com/repos/${POCOCK_REPO}/releases/latest`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!pocockRes.ok) throw new Error(`Failed to fetch ${POCOCK_REPO} latest release (${pocockRes.status})`);
  const pocockRelease = await pocockRes.json();
  const pocockTag = String(pocockRelease.tag_name);

  return {
    pstack: { sha: pstackSha, version: pstackVersion },
    pocock: { tag: pocockTag, url: pocockRelease.html_url },
  };
}

function cloneAtRef(repoSlug, ref, dest) {
  execFileSync('git', ['init', '-q', dest]);
  execFileSync('git', ['-C', dest, 'remote', 'add', 'origin', `https://github.com/${repoSlug}.git`]);
  execFileSync('git', ['-C', dest, 'fetch', '--depth', '1', 'origin', ref], { stdio: ['ignore', 'ignore', 'inherit'] });
  execFileSync('git', ['-C', dest, 'checkout', '-q', '--detach', 'FETCH_HEAD']);
}

async function openOrReuseSkillPr({ repoRoot, branch, title, body, applyChanges, owner, repo, token, dryRun }) {
  const existing = await githubApi(
    `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
    { token },
  );
  if (existing.length > 0) {
    return { status: 'existing-pr', branch, prNumber: existing[0].number, prUrl: existing[0].html_url };
  }

  mkdirSync(scratchDir, { recursive: true });
  const workDir = mkdtempSync(join(scratchDir, 'skills-update-'));
  const wt = join(workDir, 'wt');
  const mirrorDir = join(workDir, 'mirror');

  try {
    execFileSync('git', ['-C', repoRoot, 'fetch', 'origin', 'main', '--quiet']);
    execFileSync('git', ['-C', repoRoot, 'worktree', 'add', '--detach', wt, 'origin/main', '--quiet']);
    await applyChanges({ wt, mirrorDir });

    const { problems: versionProblems } = checkSkillVersions(wt);
    if (versionProblems.length > 0) {
      throw new Error(`Skill version check failed after update:\n${versionProblems.join('\n')}`);
    }

    const status = execFileSync('git', ['-C', wt, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
    if (!status) {
      return { status: 'no-changes', branch };
    }
    if (dryRun) {
      return { status: 'dry-run', branch, title };
    }

    execFileSync('git', ['-C', wt, 'checkout', '-b', branch, '--quiet']);
    execFileSync('git', ['-C', wt, 'add', '-A']);
    execFileSync('git', [
      '-C', wt,
      '-c', 'user.name=julia-runner[bot]',
      '-c', 'user.email=julia-runner[bot]@users.noreply.github.com',
      'commit', '-m', title, '--quiet',
    ]);
    const pushUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
    execFileSync('git', ['-C', wt, 'push', '--force-with-lease', pushUrl, `HEAD:refs/heads/${branch}`, '--quiet']);

    const created = await githubApi(`/repos/${owner}/${repo}/pulls`, {
      token,
      method: 'POST',
      body: { title, head: branch, base: 'main', body },
    });
    return { status: 'created', branch, prNumber: created.number, prUrl: created.html_url };
  } finally {
    try {
      execFileSync('git', ['-C', repoRoot, 'worktree', 'remove', '--force', wt], { stdio: 'ignore' });
    } catch {
      // Ignore cleanup errors on already-removed worktrees.
    }
    rmSync(workDir, { recursive: true, force: true });
  }
}

export async function runSkillUpdates({
  root = process.cwd(),
  owner = DEFAULT_OWNER,
  repo = DEFAULT_REPO,
  configDir = runnerConfigDir(),
  dryRun = false,
} = {}) {
  const token = await getInstallationToken({ configDir });
  const currentPstack = readPin(root);
  const currentPocockRef = readCurrentPocockRef(root);
  const upstream = await fetchUpstreamSkillTargets({ githubToken: token });

  const results = [];

  if (upstream.pstack.sha !== currentPstack.commit) {
    const shortSha = upstream.pstack.sha.slice(0, 7);
    const branch = `chore/skills-pstack-${shortSha}`;
    const title = `chore(skills): update pstack to ${upstream.pstack.version} (${shortSha})`;
    const body = [
      '## Why',
      '',
      'Every update to Julia\'s software, its skills and the Anthropic tools it uses reaches Todd as a plain-English report, starts without anyone launching it, and tells him when a report could not be written or a decision is his.',
      '',
      `Weekly scheduled update of \`${PSTACK_REPO}\` from \`${currentPstack.commit.slice(0, 7)}\` to \`${shortSha}\` (${upstream.pstack.version}).`,
    ].join('\n');

    results.push({
      source: PSTACK_REPO,
      ...(await openOrReuseSkillPr({
        repoRoot: root,
        branch,
        title,
        body,
        owner,
        repo,
        token,
        dryRun,
        applyChanges: async ({ wt, mirrorDir }) => {
          cloneAtRef(PSTACK_REPO, upstream.pstack.sha, mirrorDir);
          applyPstackMirrorToTree({
            root: wt,
            mirrorDir,
            commit: upstream.pstack.sha,
            version: upstream.pstack.version,
          });
          const { problems: pinProblems } = checkPstackPin(wt, { fetchMirror: (_pin, dest) => cpSync(mirrorDir, dest, { recursive: true }) });
          if (pinProblems.length > 0) {
            throw new Error(`pstack pin check failed after update:\n${pinProblems.join('\n')}`);
          }
        },
      })),
    });
  } else {
    results.push({ source: PSTACK_REPO, status: 'up-to-date', commit: currentPstack.commit });
  }

  if (upstream.pocock.tag !== currentPocockRef) {
    const branch = `chore/skills-pocock-${upstream.pocock.tag}`;
    const title = `chore(skills): update Pocock skills to ${upstream.pocock.tag}`;
    const body = [
      '## Why',
      '',
      'Every update to Julia\'s software, its skills and the Anthropic tools it uses reaches Todd as a plain-English report, starts without anyone launching it, and tells him when a report could not be written or a decision is his.',
      '',
      `Weekly scheduled update of \`${POCOCK_REPO}\` from \`${currentPocockRef}\` to \`${upstream.pocock.tag}\`.`,
    ].join('\n');

    results.push({
      source: POCOCK_REPO,
      ...(await openOrReuseSkillPr({
        repoRoot: root,
        branch,
        title,
        body,
        owner,
        repo,
        token,
        dryRun,
        applyChanges: async ({ wt, mirrorDir }) => {
          cloneAtRef(POCOCK_REPO, upstream.pocock.tag, mirrorDir);
          applyPocockReleaseToTree({ root: wt, mirrorDir, tag: upstream.pocock.tag });
        },
      })),
    });
  } else {
    results.push({ source: POCOCK_REPO, status: 'up-to-date', ref: currentPocockRef });
  }

  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes('--dry-run');
  const results = await runSkillUpdates({ dryRun });
  console.log(JSON.stringify(results, null, 2));
}
