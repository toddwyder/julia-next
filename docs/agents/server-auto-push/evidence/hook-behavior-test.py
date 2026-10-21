import pathlib,subprocess,tempfile,json,sys
hook=pathlib.Path(sys.argv[1]);results=[]
with tempfile.TemporaryDirectory(prefix='julia-hook-test-') as d:
 root=pathlib.Path(d);repo=root/'repo';bare=root/'origin.git';hooks=root/'hooks';hooks.mkdir();
 def git(*args,cwd=repo,ok=True):
  p=subprocess.run(['git',*args],cwd=cwd,text=True,capture_output=True)
  if ok and p.returncode:raise AssertionError(p.stderr)
  return p
 git('init','--bare',str(bare),cwd=root);git('init','-b','main',str(repo),cwd=root)
 git('config','user.name','Hook Test');git('config','user.email','hook-test@example.invalid');git('remote','add','origin',str(bare))
 git('config','core.hooksPath',str(hook.parent))
 own=repo/'.git/hooks/post-commit';own.write_text('#!/bin/sh\ngit log -1 --format=%s >> .git/own-hook-ran\nexit 9\n');own.chmod(0o755)
 git('commit','--allow-empty','-m','main-skipped')
 assert not git('show-ref','--verify','refs/heads/main',cwd=bare,ok=False).returncode==0
 assert (repo/'.git/own-hook-ran').read_text().splitlines()==['main-skipped'];results.append('main skipped; own failing hook ran; commit succeeded')
 git('switch','-c','feature');git('commit','--allow-empty','-m','feature-pushed')
 assert git('rev-parse','HEAD').stdout==git('rev-parse','refs/heads/feature',cwd=bare).stdout
 assert git('config','branch.feature.merge').stdout.strip()=='refs/heads/feature';results.append('feature automatically pushed with upstream after own hook')
 before=git('rev-parse','refs/heads/feature',cwd=bare).stdout
 git('switch','--detach');git('commit','--allow-empty','-m','detached-skipped');assert git('rev-parse','refs/heads/feature',cwd=bare).stdout==before;results.append('detached HEAD skipped; commit succeeded')
 git('switch','feature');git('remote','set-url','origin',str(root/'missing.git'));p=git('commit','--allow-empty','-m','push-fails');assert git('log','-1','--format=%s').stdout.strip()=='push-fails';results.append('push failure preserved local commit and commit exit 0')
 # Existing hook sees the commit before remote receives it.
 assert (repo/'.git/own-hook-ran').read_text().splitlines()==['main-skipped','feature-pushed','detached-skipped','push-fails']
print(json.dumps({'hook':str(hook),'passed':results},indent=2))
