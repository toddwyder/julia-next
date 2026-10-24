import os,json,hashlib,subprocess,datetime
from pathlib import Path
from collections import defaultdict
out=Path('/home/ubuntu/julia-jul-253-handoff/docs/agents/jul-253/ovh-readback')
rows=[json.loads(x) for x in (out/'readback.jsonl').read_text().splitlines()]
by_path={r['path']:r for r in rows}
proc=json.loads((out/'processes.json').read_text())
units=json.loads((out/'services-and-timers.json').read_text())
main=Path('/home/ubuntu/julia-machine-main')
head=subprocess.check_output(['git','-C',str(main),'rev-parse','HEAD'],text=True).strip()
def metadata(path,kind='supplemental-config',secret=False):
 p=Path(path);root=next((r for r in sorted((x for x in rows if x['kind']=='checkout'),key=lambda r:len(r['path']),reverse=True) if path==r['path'] or path.startswith(r['path']+'/')),None)
 r=by_path.get(path,{'kind':kind,'path':path,'commit':root.get('commit') if root else None,'checkout':root['path'] if root else None,'runningFrom':[],'observedReaders':[],'configuredUnits':[]})
 if path not in by_path: rows.append(r);by_path[path]=r
 r['exists']=p.exists();r['sha256']=None if secret or not p.is_file() else hashlib.sha256(p.read_bytes()).hexdigest()
 if p.exists():s=p.stat();r['mode']=oct(s.st_mode&0o777);r['uid']=s.st_uid;r['gid']=s.st_gid
 if secret:r['contentRead']=False;r['note']='metadata only; content never read or hashed'
 return r
for f in ['/home/ubuntu/.config/julia-machine/config.json','/home/ubuntu/.config/julia-server-tests/config.json','/home/ubuntu/.config/julia-verification-maintenance/config.json','/home/ubuntu/.gemini/antigravity-cli/cache/last_conversations.json']:
 metadata(f)
for f in ['/etc/julia-control','/etc/julia-control/op-service-account-token']:
 metadata(f,kind='legacy-credential-metadata',secret=True)
for f in ['/opt/julia-control','/opt/julia-control/reviewer/src/mastra/control-server.ts','/etc/julia-control/secrets.env']:
 metadata(f,kind='absent-legacy-target',secret=True)
installed={
 '/home/ubuntu/.local/lib/julia-machine/server-main.mjs':'ops/build-runner/server-main.mjs',
 '/home/ubuntu/.local/lib/julia-server-tests/worker.mjs':'ops/server-tests/worker.mjs',
 '/home/ubuntu/.local/share/julia-verification-maintenance/maintenance.mjs':'ops/verification-maintenance/maintenance.mjs',
 '/home/ubuntu/.local/share/julia-verification-maintenance/notify-blocked.mjs':'ops/verification-maintenance/notify-blocked.mjs'}
for path,source in installed.items():
 r=metadata(path,'installed-helper');r['sourcePath']=str(main/source);r['sourceSha256']=hashlib.sha256((main/source).read_bytes()).hexdigest();r['contentMatchesCommit']=head if r['sha256']==r['sourceSha256'] else None
r=by_path['/home/ubuntu/julia-next'];r.setdefault('configuredReaders',[]).append({'unit':'julia-verification-maintenance.timer -> julia-verification-maintenance.service','config':'/home/ubuntu/.config/julia-verification-maintenance/config.json','property':'notification.root','use':'conditional notify-blocked imports scripts/linear-cli.mjs and launches scripts/julia-agents.mjs'})
r.setdefault('configuredReaders',[]).append({'reader':'Current session supplied r6 skill catalog','path':'/home/ubuntu/julia-next/.agents/skills','use':'verify-machine was actually read in previous JUL-253 turn despite main removal'})
by_path['/home/ubuntu/.config/julia-verification-maintenance/config.json']['configuredReaders']=['enabled julia-verification-maintenance.service and timer']
for u in units:
 path=u.get('FragmentPath') or ('systemd:'+u['scope']+':'+u['unit'])
 r=metadata(path,'service-or-timer') if not path.startswith('systemd:') else {'kind':'service-or-timer','path':path,'commit':None}
 if path.startswith('systemd:'):rows.append(r)
 r.setdefault('unitReadback',[]).append(u)
for cwd in sorted({p['cwd'] for p in proc if p['cwd'].endswith(' (deleted)')}):
 rows.append({'kind':'deleted-runtime-directory','path':cwd,'commit':None,'commitNote':'Original deleted checkout revision not established; no guessing','exists':False,'runningFrom':[{'pid':p['pid'],'comm':p['comm']} for p in proc if p['cwd']==cwd]})
for entry in [json.loads(x) for x in (out/'legacy-references.jsonl').read_text().splitlines()]:
 r=metadata(entry['path'],'laptop-or-retired-reference');r['legacyMatches']=entry['matches'];r['historicalEvidence']=entry['historicalEvidence']
for relative,consumer in [('.claude/skills/tdd/SKILL.md','current CODING_STANDARDS.md:17 and CLAUDE.md:5'),('.claude/skills/teach/SKILL.md','current CLAUDE.md:5 and .claude/skills/ask-matt/SKILL.md:90'),('.claude/skills/pre-plan/SKILL.md','current .claude skill discovery despite retirement'),('docs/agents/server-runbook.md','current AGENTS.md links Server runbook')]:
 by_path[str(main/relative)].setdefault('configuredReaders',[]).append(consumer)
for root in ['/home/ubuntu/.cache','/root/.cache']:
 if not Path(root).exists():continue
 for directory,dirs,files in os.walk(root,followlinks=False):
  dirs[:]=[d for d in dirs if d not in {'node_modules','.git'}]
  if (Path(directory)/'.git').exists() and directory not in by_path:
   result=subprocess.run(['git','-c','safe.directory=*','-C',directory,'rev-parse','HEAD'],capture_output=True,text=True)
   rows.append({'kind':'checkout','path':directory,'commit':result.stdout.strip() if result.returncode==0 else None,'classification':'additional cache checkout','runningFrom':[],'note':'No process/reader assertion beyond the snapshot census'})
rows.sort(key=lambda r:(r['kind'],r['path']))
(out/'readback.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows))
def use(r):return {k:r[k] for k in ['runningFrom','observedReaders','observedOpenReaders','configuredUnits','configuredReaders','catalogReader','sourceReferences','unitReadback','contentMatchesCommit','commitNote','legacyMatches'] if r.get(k)}
header='kind\tpath\tcommit\truns_from_or_reads\tsha256\n'
def line(r):return '\t'.join([r['kind'],r['path'],r.get('commit') or ('non-Git, blob matches '+r['contentMatchesCommit'] if r.get('contentMatchesCommit') else 'not a Git checkout / revision unknown'),json.dumps(use(r)) if use(r) else 'No observed process/open-FD/unit edge in snapshot; other reads unknown',r.get('sha256') or 'not hashed'])+'\n'
(out/'readback.tsv').write_text(header+''.join(line(r) for r in rows))
shards=out/'lines';shards.mkdir(exist_ok=True)
for index,start in enumerate(range(0,len(rows),600),1):
 (shards/f'{index:03}.tsv').write_text(header+''.join(line(r) for r in rows[start:start+600]))
checkouts=[r for r in rows if r['kind']=='checkout']
text='# OVH checkout readback\n\nEvery observed checkout is listed. Current main and the two JUL-253 worktrees are identified. Nothing was removed. HEAD means the on-disk revision, not the revision loaded by an old process.\n\n| Path | HEAD | Use |\n| --- | --- | --- |\n'
for r in checkouts:
 description=r.get('classification','')
 if r.get('runningFrom'):description+='; live PIDs '+','.join(str(p['pid']) for p in r['runningFrom'])
 if r.get('configuredUnits'):description+='; units '+','.join(r['configuredUnits'])
 if r.get('configuredReaders'):description+='; '+json.dumps(r['configuredReaders'])
 if not any(r.get(k) for k in ['runningFrom','observedOpenReaders','configuredUnits','configuredReaders']):description+='; no observed runtime/open-FD/unit use, other reads unknown'
 text+='| `'+r['path']+'` | `'+str(r.get('commit'))+'` | '+description.replace('|','\\|')+' |\n'
(out/'checkouts.md').write_text(text)
meta=json.loads((out/'scope.json').read_text());meta['augmentedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();meta['finalCounts']={'rows':len(rows),'checkouts':len(checkouts),'skills':sum(r['kind']=='skill' for r in rows),'shards':(len(rows)+599)//600};meta['cacheGitScan']='Scanned /home/ubuntu/.cache and /root/.cache separately for project Git directories';(out/'scope.json').write_text(json.dumps(meta,indent=2)+'\n');print(json.dumps(meta['finalCounts']))
