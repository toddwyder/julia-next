import { spawnSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readlinkSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

function command(name, args, cwd) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  const result = spawnSync(name, args, { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(`${name} failed (${result.status}): ${result.error?.message ?? result.stderr}`)
  return result.stdout.trim()
}

export function updateMain(config) {
  const root = resolve(config.checkout)
  const git = (...args) => command('git', args, root)
  const branch = config.branch ?? 'main'
  let activationMerge
  if (git('branch', '--show-current') !== branch) throw new Error(`Service checkout must track ${branch}`)
  if (git('status', '--porcelain')) throw new Error('Service checkout contains uncommitted changes')
  git('fetch', '--quiet', 'origin', branch)
  const current = git('rev-parse', 'HEAD')
  const remote = git('rev-parse', `origin/${branch}`)
  git('merge-base', '--is-ancestor', current, remote)
  if (config.activationPullRequest) {
    const pr = JSON.parse(command('gh', ['api', `repos/${config.githubRepository}/pulls/${config.activationPullRequest}`]))
    if (!pr.merged || pr.base.ref !== branch) return { current, remote, updated: false, awaitingMerge: config.activationPullRequest }
    activationMerge = pr.merge_commit_sha
    git('merge-base', '--is-ancestor', activationMerge, remote)
  }
  const commits = git('rev-list', '--first-parent', '--reverse', `${current}..${remote}`).split('\n').filter(Boolean)
  let target = current
  for (const sha of commits) {
    const parents = git('rev-list', '--parents', '-n', '1', sha).split(' ').slice(1)
    const associated = config.githubRepository ? JSON.parse(command('gh', ['api', `repos/${config.githubRepository}/commits/${sha}/pulls?per_page=100`])) : []
    if (parents.length > 1 || associated.some(pr => pr.merged_at && pr.base.ref === branch && pr.merge_commit_sha === sha)) target = sha
  }
  if (activationMerge && commits.includes(activationMerge)) target = activationMerge
  const pending = resolve(root, git('rev-parse', '--git-path', 'julia-services-pending'))
  if (existsSync(pending)) target = readFileSync(pending, 'utf8').trim()
  if (target === current && !existsSync(pending)) return { current, remote, updated: false }
  writeFileSync(pending, target + '\n')
  git('merge', '--ff-only', target)
  if (config.installDependencies !== false) {
    for (const owner of ['.', 'ops/build-runner', 'ops/mastra-agents/reviewer']) {
      if (existsSync(join(root, owner, 'package-lock.json'))) command('npm', ['ci', '--no-audit', '--no-fund'], join(root, owner))
    }
  }
  for (const service of config.legacyServices ?? []) {
    const unit = join(homedir(), '.config/systemd/user', service)
    if (!existsSync(unit)) continue
    command('systemctl', ['--user', 'disable', '--now', service])
    unlinkSync(unit)
  }
  if (config.legacyServices?.length) command('systemctl', ['--user', 'daemon-reload'])
  for (const service of config.services ?? []) {
    command('systemctl', ['--user', 'enable', service])
    command('systemctl', ['--user', 'restart', service])
  }
  const healthChecks = (config.healthChecks ?? []).map(url => ({
    url,
    status: command('curl', ['--fail', '--silent', '--output', '/dev/null', '--write-out', '%{http_code}', '--retry', '20', '--retry-connrefused', '--retry-delay', '1', url]),
  }))
  if (config.evidenceDirectory) {
    const services = (config.services ?? []).map(service => {
      const pid = Number(command('systemctl', ['--user', 'show', service, '--property=MainPID', '--value']))
      const active = command('systemctl', ['--user', 'show', service, '--property=ActiveState', '--value'])
      const cwd = readlinkSync(`/proc/${pid}/cwd`)
      if (active !== 'active' || cwd !== root) throw new Error(`${service} did not start from main`)
      const role = { 'julia-machine-runner.service': 'runner', 'julia-machine-control.service': 'control' }[service]
      const entrypoint = join(root, entrypoints[role])
      const cgroup = command('systemctl', ['--user', 'show', service, '--property=ControlGroup', '--value'])
      const processes = readFileSync(`/sys/fs/cgroup${cgroup}/cgroup.procs`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number).map(processPid => ({
        pid: processPid,
        cwd: readlinkSync(`/proc/${processPid}/cwd`),
        args: readFileSync(`/proc/${processPid}/cmdline`, 'utf8').split('\0').filter(Boolean),
      })).filter(process => process.args[1] === entrypoint)
      if (processes.length !== 1 || processes[0].cwd !== root) throw new Error(`${service} has no running main entrypoint`)
      return { service, pid, active, cwd, processes }
    })
    const oldServices = (config.legacyServices ?? []).map(service => {
      const loadState = command('systemctl', ['--user', 'show', service, '--property=LoadState', '--value'])
      if (loadState !== 'not-found') throw new Error(`${service} is still installed`)
      return { service, loadState }
    })
    mkdirSync(config.evidenceDirectory, { recursive: true })
    writeFileSync(join(config.evidenceDirectory, `${target}.json`), JSON.stringify({ checkedAt: new Date().toISOString(), commit: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), tracking: git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'), dirty: git('status', '--porcelain'), services, oldServices, healthChecks }, null, 2) + '\n')
  }
  unlinkSync(pending)
  return { previous: current, current: target, remote, updated: true }
}

const entrypoints = { runner: 'ops/build-runner/jobs.mjs', control: 'ops/mastra-agents/reviewer/src/mastra/control-server.ts' }
async function runService(config, service) {
  const root = resolve(config.checkout)
  const entrypoint = entrypoints[service]
  if (!entrypoint) throw new Error('Service must be runner or control')
  if (!existsSync(join(root, entrypoint))) throw new Error(`${entrypoint} is absent from main; ${service} is unavailable`)
  const child = spawn(process.execPath, [join(root, 'scripts/julia-agents.mjs'), '--', process.execPath, join(root, entrypoint)], { cwd: root, stdio: 'inherit' })
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal))
  child.on('error', error => { console.error(error.message); process.exitCode = 1 })
  await new Promise(done => child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); done() }))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, configPath, service] = process.argv.slice(2)
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    if (action === 'poll') console.log(JSON.stringify(updateMain(config)))
    else if (action === 'run') await runService(config, service)
    else throw new Error('Usage: node server-main.mjs poll CONFIG | run CONFIG runner|control')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
