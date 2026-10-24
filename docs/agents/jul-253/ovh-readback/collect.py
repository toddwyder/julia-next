import os, re, json, hashlib, subprocess, datetime
from pathlib import Path
from collections import defaultdict

out = Path('/home/ubuntu/julia-jul-253-handoff/docs/agents/jul-253/ovh-readback')
out.mkdir(parents=True, exist_ok=True)
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
roots = ['/home', '/opt', '/srv', '/tmp', '/var/tmp', '/var/lib', '/usr/local', '/root', '/etc/systemd/system', '/etc/cron.d', '/etc/cron.daily', '/etc/sudoers.d']
prune = {'node_modules', '.git', '.npm', '.cache', '.pnpm-store', '__pycache__', 'apt', 'dpkg', 'snapd', 'docker', 'containers', 'texmf', 'gem'}
owned = {'/home/ubuntu/julia-machine-main': 'current canonical checkout', '/home/ubuntu/julia-jul-253': 'current JUL-253 source worktree', '/home/ubuntu/julia-jul-253-handoff': 'current JUL-253 evidence worktree'}
errors, paths, repos = [], set(), set()
def err(e): errors.append(str(e))
for root in roots:
    if not Path(root).exists(): continue
    for directory, dirs, files in os.walk(root, followlinks=False, onerror=err):
        dirs[:] = [d for d in dirs if d not in prune]
        p = Path(directory)
        if (p / '.git').exists(): repos.add(str(p))
        for name in files:
            path = str(p / name)
            if path.startswith(str(out)): continue
            if name == 'SKILL.md' or (name in {'AGENTS.md','CLAUDE.md','CODING_STANDARDS.md'}): paths.add(path)
            elif ('julia' in path.lower() or 'mastra' in path.lower()) and (Path(name).suffix in {'.mjs','.cjs','.js','.ts','.ps1','.sh','.py','.service','.timer','.toml','.yml','.yaml'} or name in {'julia-control-run','julia-control-deploy-and-restart','post-commit'}): paths.add(path)
            elif path.startswith(('/home/ubuntu/.config/systemd/', '/etc/systemd/system/', '/etc/cron.', '/etc/sudoers.d/', '/usr/local/bin/julia', '/usr/local/sbin/julia', '/home/ubuntu/.config/git/')): paths.add(path)
            elif path in {'/home/ubuntu/.codex/config.toml','/home/ubuntu/.agents/pstack-models.md','/home/ubuntu/.bashrc','/home/ubuntu/.profile','/home/ubuntu/.gitconfig'}: paths.add(path)
        for name in dirs:
            link = p / name
            if link.is_symlink() and any(s in str(link).lower() for s in ['julia','skills','systemd']): paths.add(str(link))

def run(args):
    p = subprocess.run(args, capture_output=True, text=True, env={**os.environ, 'GIT_OPTIONAL_LOCKS':'0'}, timeout=30)
    return p.returncode, p.stdout.strip()

repo_data = {}
for root in sorted(repos):
    rc, head = run(['git','-c','safe.directory=*','-C',root,'rev-parse','HEAD'])
    _, branch = run(['git','-c','safe.directory=*','-C',root,'symbolic-ref','--short','-q','HEAD'])
    _, dirty = run(['git','-c','safe.directory=*','-C',root,'status','--porcelain=v1','--untracked-files=no'])
    repo_data[root] = {'commit':head if not rc else None, 'branch':branch or 'detached', 'trackedDirty':bool(dirty), 'dirtyPathCount':len(dirty.splitlines()) if dirty else 0}
ordered = sorted(repo_data, key=len, reverse=True)
def owner(path):
    return next((root for root in ordered if path == root or path.startswith(root+'/')), None)

proc = []
for p in Path('/proc').iterdir():
    if not p.name.isdigit(): continue
    try:
        cwd, exe = os.readlink(p/'cwd'), os.readlink(p/'exe')
        comm = (p/'comm').read_text().strip()
        cmd = (p/'cmdline').read_bytes().decode(errors='replace').replace('\0',' ')
        refs = sorted(set(re.findall(r'/(?:home|opt|usr/local|var/lib|tmp|var/tmp)/[A-Za-z0-9_./@+:-]+', cmd)))
        fds = []
        for fd in (p/'fd').iterdir():
            try:
                target = os.readlink(fd)
                if target.startswith(('/home/','/opt/','/usr/local/','/var/lib/julia','/tmp/')): fds.append(target)
            except OSError: pass
        if owner(cwd) or any('julia' in x.lower() for x in [cwd,exe,*refs,*fds]) or comm in {'codex','tmux: server'}:
            proc.append({'pid':int(p.name),'comm':comm,'cwd':cwd,'exe':exe,'argvPathReferences':refs,'openFilePaths':sorted(set(fds))})
    except (OSError,PermissionError): pass
(out/'processes.json').write_text(json.dumps(proc,indent=2)+'\n')

units = []
for user in [False,True]:
    prefix = ['systemctl'] if not user else ['runuser','-u','ubuntu','--','env','XDG_RUNTIME_DIR=/run/user/1000','systemctl','--user']
    rc, listing = run(prefix+['list-unit-files','--no-pager','--no-legend','--plain'])
    for line in listing.splitlines():
        fields = line.split()
        if not fields or not fields[0].endswith(('.service','.timer')): continue
        unit = fields[0]
        props = ['FragmentPath','DropInPaths','ActiveState','SubState','UnitFileState','WorkingDirectory','MainPID','ExecStart','Triggers','TriggeredBy']
        _, detail = run(prefix+['show',unit,*['--property='+p for p in props]])
        d = dict(x.split('=',1) for x in detail.splitlines() if '=' in x)
        cmd = d.pop('ExecStart','')
        d['ExecStartPathReferences'] = sorted(set(re.findall(r'/(?:home|opt|usr/local|etc|var/lib|tmp|var/tmp)/[A-Za-z0-9_./@+:-]+',cmd)))
        d.update(scope='ubuntu-user' if user else 'system',unit=unit)
        units.append(d)
        if 'julia' in unit.lower():
            if d.get('FragmentPath'): paths.add(d['FragmentPath'])
            paths.update(d.get('DropInPaths','').split())
(out/'services-and-timers.json').write_text(json.dumps(units,indent=2)+'\n')

patterns = {'stale-checkout':r'/home/ubuntu/julia-next','old-deployment':r'/opt/julia-control|/var/lib/julia-build','windows-proof':r'verify-machine|machine-pstack-verification','windows-launcher':r'julia-vault-windows|start-julia-control-page|Start Julia Control Page','laptop':r'\blaptop\b|C:\\\\?Users|\bWindows\b','retired-flow':r'pre-plan|Mastra Factory|factory-daemon'}
regex = {k:re.compile(v,re.I) for k,v in patterns.items()}
text_suffix = {'.md','.mjs','.cjs','.js','.ts','.ps1','.sh','.py','.json','.toml','.yml','.yaml','.service','.timer','.conf'}
refs, laptop = defaultdict(list), []
texts = set(paths)
for root in sorted(repos):
    if '/receipt' in root or '/repository' in root or '/worktree' in root or '/observer/' in root: continue
    for directory, dirs, files in os.walk(root, followlinks=False, onerror=err):
        dirs[:] = [d for d in dirs if d not in prune and d not in {'.artifacts','.builder-home'}]
        for name in files:
            p = Path(directory)/name
            if p.suffix in text_suffix and p.stat().st_size < 8_000_000 and not any(s in name.lower() for s in ['token','auth.json','secret','credential','bootstrap-receipt']): texts.add(str(p))
for path in sorted(texts):
    p = Path(path)
    if not p.is_file() or p.is_symlink() or p.suffix == '.env' or any(s in p.name.lower() for s in ['service-account-token','auth.json','secrets.env','hosts.yml']): continue
    try: content=p.read_text(errors='replace')
    except OSError: continue
    if '\0' in content: continue
    hits = defaultdict(list)
    for n,line in enumerate(content.splitlines(),1):
        for kind, rx in regex.items():
            if rx.search(line): hits[kind].append(n)
        for root in ordered:
            if root in line and len(refs[root])<200: refs[root].append({'path':path,'line':n,'kind':'literal source/config/document reference; not proof of execution'})
    if hits:
        laptop.append({'path':path,'commit':repo_data.get(owner(path),{}).get('commit'),'matches':dict(hits),'historicalEvidence':'/docs/agents/' in path or '/evidence/' in path})
(out/'legacy-references.jsonl').write_text(''.join(json.dumps(x)+'\n' for x in laptop))

rows=[]
for root,data in sorted(repo_data.items()):
    rows.append({'kind':'checkout','path':root,**data,'classification':owned.get(root,'other checkout or retained snapshot; not authority'),'runningFrom':[{'pid':p['pid'],'comm':p['comm'],'cwd':p['cwd']} for p in proc if p['cwd']==root or p['cwd'].startswith(root+'/') or any(a==root or a.startswith(root+'/') for a in p['argvPathReferences'])],'observedOpenReaders':[p['pid'] for p in proc if any(f==root or f.startswith(root+'/') for f in p['openFilePaths'])],'configuredUnits':[u['scope']+':'+u['unit'] for u in units if u.get('WorkingDirectory','')==root or any(a==root or a.startswith(root+'/') for a in u['ExecStartPathReferences'])],'sourceReferences':refs[root]})
for path in sorted(paths):
    p=Path(path)
    if not p.exists() and not p.is_symlink(): continue
    root=owner(path)
    try: sha=hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None
    except OSError: sha=None
    kind='skill' if p.name=='SKILL.md' else 'entrypoint' if p.name in {'AGENTS.md','CLAUDE.md','CODING_STANDARDS.md'} else 'service-or-timer' if p.suffix in {'.service','.timer'} else 'script-helper-or-config'
    readers=[{'pid':r['pid'],'reason':'open file descriptor'} for r in proc if path in r['openFilePaths']]
    runners=[{'pid':r['pid'],'reason':'executable or command-line path reference'} for r in proc if path==r['exe'] or path in r['argvPathReferences']]
    configured=[u['scope']+':'+u['unit'] for u in units if path==u.get('FragmentPath') or path in u.get('DropInPaths','').split() or path in u['ExecStartPathReferences']]
    rows.append({'kind':kind,'path':path,'commit':repo_data.get(root,{}).get('commit'),'checkout':root,'sha256':sha,'symlinkTarget':os.readlink(p) if p.is_symlink() else None,'runningFrom':runners,'observedReaders':readers,'configuredUnits':configured,'catalogReader':'This session advertises r6=/home/ubuntu/julia-next/.agents/skills' if path.startswith('/home/ubuntu/julia-next/.agents/skills/') else None})
(out/'readback.jsonl').write_text(''.join(json.dumps(x)+'\n' for x in rows))
with (out/'readback.tsv').open('w') as f:
    f.write('kind\tpath\tcommit\truns_from_or_reads\tsha256\n')
    for r in rows:
        use={k:r[k] for k in ['runningFrom','observedReaders','observedOpenReaders','configuredUnits','catalogReader','sourceReferences'] if r.get(k)}
        f.write('\t'.join([r['kind'],r['path'],r.get('commit') or 'not a Git checkout',json.dumps(use) if use else 'No observed process/open-FD/unit reference in this snapshot; unobserved reads remain unknown',r.get('sha256') or 'n/a'])+'\n')
meta={'startedAt':started,'finishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scopeRoots':roots,'excludedDirectoryNames':sorted(prune),'counts':{'checkouts':len(repos),'readbackRows':len(rows),'skills':sum(r['kind']=='skill' for r in rows),'legacyReferenceFiles':len(laptop),'servicesAndTimers':len(units),'juliaProcesses':len(proc)},'walkErrors':errors,'limitations':['Snapshot cannot prove that a closed file was never read. Empty readers means no observed open FD/process/configured unit edge, not nobody reads it.','Literal documentation references are labeled separately from runtime execution.','Vendor dependencies, package caches, OS package databases and virtual filesystems are excluded from checkout traversal.','Automated services can create new snapshots after this census.','A checkout HEAD is its on-disk revision, not proof that a long-lived process loaded that revision.'],'removed':[]}
(out/'scope.json').write_text(json.dumps(meta,indent=2)+'\n')
print(json.dumps(meta))
