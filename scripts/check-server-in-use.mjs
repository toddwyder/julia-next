#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { evaluateServerState, formatReport } from './server-in-use.mjs';

const COLLECT_SCRIPT = `python3 - << 'PY'
import json, os, re, subprocess, urllib.request

def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True).stdout

def parse_units(cmd):
    out = []
    for line in run(cmd).splitlines():
        parts = line.split(None, 4)
        if len(parts) >= 4:
            out.append({'name': parts[0], 'load': parts[1], 'active': parts[2], 'sub': parts[3]})
    return out

def du_entries(base):
    if not os.path.isdir(base):
        return []
    items = []
    for name in sorted(os.listdir(base)):
        path = os.path.join(base, name)
        out = run(['du', '-sm', path]).strip()
        mb = int(out.split()[0]) if out else 0
        items.append({'name': name, 'path': path, 'diskMb': mb})
    return items

active_cards = []
try:
    with urllib.request.urlopen('http://127.0.0.1:4111/api/workflows/card-path/runs', timeout=3) as resp:
        data = json.loads(resp.read().decode())
        for r in data.get('runs', []):
            snap = r.get('snapshot') or {}
            if snap.get('status') == 'running':
                card = (snap.get('value') or {}).get('card')
                if card:
                    active_cards.append(card)
except Exception:
    pass

processes = []
for line in run(['ps', '-u', 'ubuntu', '-o', 'pid=,rss=,args=']).splitlines():
    m = re.match(r'^\\s*(\\d+)\\s+(\\d+)\\s+(.*)$', line)
    if not m:
        continue
    pid, rss_kb, cmd = int(m.group(1)), int(m.group(2)), m.group(3)
    service_unit = None
    try:
        cg = open(f'/proc/{pid}/cgroup').read()
        matches = re.findall(r'([a-zA-Z0-9_.@-]+\\.service)', cg)
        if matches and matches[-1] != 'user@1000.service':
            service_unit = matches[-1]
    except Exception:
        pass
    in_use_op = False
    if re.search(r'\\bop daemon\\b', cmd):
        try:
            cwd = os.readlink(f'/proc/{pid}/cwd')
            in_use_op = cwd == '/home/ubuntu' or cwd == '/home/ubuntu/julia-builder'
        except Exception:
            pass
    processes.append({'pid': pid, 'rssKb': rss_kb, 'cmd': cmd, 'serviceUnit': service_unit, 'inUseOpDaemon': in_use_op})

checkouts = []
worktrees = []
seen_wt = set()
for name in sorted(os.listdir('/home/ubuntu')):
    if not name.startswith('julia-'):
        continue
    p = os.path.join('/home/ubuntu', name)
    if os.path.isdir(p):
        out = run(['du', '-sm', p]).strip()
        mb = int(out.split()[0]) if out else 0
        checkouts.append({'path': p, 'diskMb': mb})
        for wline in run(['git', '-C', p, 'worktree', 'list', '--porcelain']).splitlines():
            if wline.startswith('worktree '):
                wp = wline.split(' ', 1)[1].strip()
                if wp not in seen_wt:
                    seen_wt.add(wp)
                    wout = run(['du', '-sm', wp]).strip() if os.path.exists(wp) else ''
                    wmb = int(wout.split()[0]) if wout else 0
                    worktrees.append({'path': wp, 'diskMb': wmb})

home_extras = []
for name in ('dist', '%ln'):
    p = os.path.join('/home/ubuntu', name)
    if os.path.exists(p):
        out = run(['du', '-sm', p]).strip()
        mb = int(out.split()[0]) if out else 0
        home_extras.append({'name': name, 'path': p, 'diskMb': mb})

print(json.dumps({
    'activeCards': active_cards,
    'userUnits': parse_units(['systemctl', '--user', 'list-units', '--type=service,timer', '--all', '--no-legend', '--plain']),
    'systemUnits': parse_units(['systemctl', 'list-units', '--type=service,timer', '--all', '--no-legend', '--plain']),
    'processes': processes,
    'checkouts': checkouts,
    'worktrees': worktrees,
    'scratchEntries': du_entries('/home/ubuntu/.local/state/julia-scratch'),
    'scratchCards': du_entries('/home/ubuntu/.local/state/julia-scratch/cards'),
    'builderArtifacts': du_entries('/home/ubuntu/julia-builder/.artifacts'),
    'flowStudioEntries': du_entries('/home/ubuntu/julia-flow-repo/.artifacts/flow/studio'),
    'mastracodeEntries': du_entries('/home/ubuntu/.local/share/mastracode'),
    'homeExtras': home_extras,
}))
PY`;

function runTarget(script, { local, sshHost }) {
  if (local) {
    return execFileSync('bash', ['-s'], { input: script, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  }
  return execFileSync('ssh', ['-o', 'BatchMode=yes', sshHost, 'bash', '-s'], {
    input: script,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function collectSnapshot(options = {}) {
  const local = options.local ?? process.platform === 'linux';
  const sshHost = options.sshHost ?? 'ovh';
  const raw = runTarget(COLLECT_SCRIPT, { local, sshHost });
  return JSON.parse(raw);
}

export function cleanLeftovers(evaluation, options = {}) {
  const local = options.local ?? process.platform === 'linux';
  const sshHost = options.sshHost ?? 'ovh';
  if (evaluation.leftovers.length === 0) return;

  const commands = [];
  let resetFlowStudio = false;

  for (const item of evaluation.leftovers) {
    switch (item.kind) {
      case 'process':
        if (item.pid) commands.push(`kill -9 ${Number(item.pid)} 2>/dev/null || true`);
        break;
      case 'user-unit':
        commands.push(`systemctl --user disable --now ${JSON.stringify(item.name)} 2>/dev/null || true`);
        commands.push(`rm -f /home/ubuntu/.config/systemd/user/${JSON.stringify(item.name)} 2>/dev/null || true`);
        break;
      case 'trace-db':
        resetFlowStudio = true;
        break;
      case 'worktree':
      case 'checkout':
      case 'scratch':
      case 'scratch-card':
      case 'builder-artifact':
      case 'flow-studio-card':
      case 'mastracode':
      case 'home-extra':
        commands.push(`rm -rf ${JSON.stringify(item.name)}`);
        break;
      default:
        break;
    }
  }

  if (commands.some(c => c.includes('systemctl --user'))) {
    commands.push('systemctl --user daemon-reload');
    commands.push('systemctl --user reset-failed');
  }
  commands.push('git -C /home/ubuntu/julia-builder worktree prune 2>/dev/null || true');
  commands.push('git -C /home/ubuntu/julia-flow-repo worktree prune 2>/dev/null || true');
  commands.push('git -C /home/ubuntu/julia-mastra worktree prune 2>/dev/null || true');

  if (resetFlowStudio) {
    commands.push('systemctl --user stop julia-studio.service');
    commands.push('rm -rf /home/ubuntu/julia-flow-repo/.artifacts/flow/studio');
    commands.push('systemctl --user start julia-studio.service');
    commands.push('sleep 3');
  }

  runTarget(commands.join('\n'), { local, sshHost });
}

function parseArgs(argv) {
  const out = { clean: false, json: false, local: process.platform === 'linux', sshHost: 'ovh' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--clean') out.clean = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--local') out.local = true;
    else if (arg === '--ssh' && argv[i + 1]) {
      out.local = false;
      out.sshHost = argv[++i];
    }
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  let evaluation = evaluateServerState(collectSnapshot(args));
  if (args.clean && !evaluation.ok) {
    cleanLeftovers(evaluation, args);
    evaluation = evaluateServerState(collectSnapshot(args));
  }
  console.log(args.json ? JSON.stringify(evaluation, null, 2) : formatReport(evaluation));
  process.exitCode = evaluation.ok ? 0 : 1;
}
