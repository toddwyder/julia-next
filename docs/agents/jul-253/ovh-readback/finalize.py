import json,hashlib,datetime
from pathlib import Path
out=Path('/home/ubuntu/julia-jul-253-handoff/docs/agents/jul-253/ovh-readback')
rows=[json.loads(line) for line in (out/'readback.jsonl').read_text().splitlines()]
proc=json.loads((out/'processes.json').read_text());by={r['path']:r for r in rows}
for r in rows:
 if r['kind']=='checkout':
  root=r['path'];r['runningFrom']=[{'pid':p['pid'],'comm':p['comm'],'cwd':p['cwd'],'basis':'actual cwd or executable under this checkout'} for p in proc if p['cwd']==root or p['cwd'].startswith(root+'/') or p['exe'].startswith(root+'/')]
  r['commandLineReferences']=[{'pid':p['pid'],'cwd':p['cwd'],'basis':'argv path reference only; not proof the process runs this checkout'} for p in proc if any(a==root or a.startswith(root+'/') for a in p['argvPathReferences'])]
 if 'observedOpenReaders' in r:r['observedOpenFileUsers']=r.pop('observedOpenReaders');r['openFileDirection']='not established from sampled FD paths'
 if r.get('observedReaders'):
  r['observedFileDescriptors']=r.pop('observedReaders');r['openFileDirection']='not established from sampled FD paths'
 if 'unitReadback' in r:
  r['unitReadback']=list({(u['scope'],u['unit']):u for u in r['unitReadback']}.values())
by['/usr/local/sbin/julia-control-deploy-and-restart'].setdefault('configuredReaders',[]).extend(['/etc/sudoers.d/90-julia-agent','/etc/sudoers.d/90-julia-control-delivery'])
by['/home/ubuntu/.local/share/julia-verification-maintenance/notify-blocked.mjs'].setdefault('configuredReaders',[]).append('maintenance.mjs:101-103 conditionally invokes this helper for blocked notifications')
for path,readers in {
 '/home/ubuntu/.config/julia-machine/config.json':['julia-machine-main.service','julia-machine-control.service','julia-machine-runner.service'],
 '/home/ubuntu/.config/julia-server-tests/config.json':['julia-server-tests.service via enabled julia-server-tests.timer']}.items():by[path]['configuredReaders']=readers
(out/'readback.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows))
fields=['runningFrom','commandLineReferences','observedFileDescriptors','observedOpenFileUsers','configuredUnits','configuredReaders','catalogReader','sourceReferences','unitReadback','contentMatchesCommit','commitNote','legacyMatches']
def line(r):
 use={k:r[k] for k in fields if r.get(k)}
 return '\t'.join([r['kind'],r['path'],r.get('commit') or ('non-Git, blob matches '+r['contentMatchesCommit'] if r.get('contentMatchesCommit') else 'not a Git checkout / revision unknown'),json.dumps(use) if use else 'No observed process/open-FD/unit edge in snapshot; other reads unknown',r.get('sha256') or 'not hashed'])+'\n'
header='kind\tpath\tcommit\truns_from_or_reads\tsha256\n'
(out/'readback.tsv').write_text(header+''.join(line(r) for r in rows))
for i,start in enumerate(range(0,len(rows),600),1):(out/'lines'/f'{i:03}.tsv').write_text(header+''.join(line(r) for r in rows[start:start+600]))
checkouts=[r for r in rows if r['kind']=='checkout']
text='# OVH checkout readback\n\nHEAD is the on-disk revision at the recorded snapshot. Actual cwd use and argv mentions are separate. Nothing was removed.\n\n| Path | HEAD | Observed or configured use |\n| --- | --- | --- |\n'
for r in checkouts:
 use=[]
 if r.get('runningFrom'):use.append('actual cwd/executable PIDs '+','.join(str(p['pid']) for p in r['runningFrom']))
 if r.get('commandLineReferences'):use.append('argv-only references PIDs '+','.join(str(p['pid']) for p in r['commandLineReferences']))
 if r.get('configuredUnits'):use.append('units '+','.join(r['configuredUnits']))
 if r.get('configuredReaders'):use.append(json.dumps(r['configuredReaders']))
 desc=r.get('classification','')+'; '+('; '.join(use) if use else 'no observed runtime/open-FD/unit use; other reads unknown')
 text+='| `'+r['path']+'` | `'+str(r.get('commit'))+'` | '+desc.replace('|','\\|')+' |\n'
(out/'checkouts.md').write_text(text)
meta=json.loads((out/'scope.json').read_text());meta['finalizedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();meta['reviewCorrections']=['Separated cwd/executable use from argv references.','Open FD use no longer asserts read direction.','Added sudoers, conditional maintenance helper, and service configuration reader edges.','Captured raw Tailscale Serve status.'];meta['validation']={'rows':len(rows),'uniquePaths':len({r['path'] for r in rows}),'tsvDataLines':len((out/'readback.tsv').read_text().splitlines())-1};assert meta['validation']['rows']==meta['validation']['uniquePaths']==meta['validation']['tsvDataLines'];(out/'scope.json').write_text(json.dumps(meta,indent=2)+'\n')
print(json.dumps(meta['validation']))
