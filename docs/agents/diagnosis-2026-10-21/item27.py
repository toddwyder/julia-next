"""Exact npm EROFS probe. Refuse any writable view to preserve the installation."""
import os,subprocess,sys,tempfile,shutil,time,json
owner='/home/ubuntu/julia-jul-231/ops/build-runner'
if not (os.statvfs(owner).f_flag & os.ST_RDONLY):
 print('UNAVAILABLE: writable installation; npm ci would remove installed dependencies');sys.exit(2)
if '--syscall' in sys.argv:
 try:
  os.unlink(owner+'/node_modules/.bin')
 except OSError as error:
  print(f"RED unlink node_modules/.bin: errno={error.errno} {error.strerror}")
  sys.exit(1 if error.errno==30 else 2)
 raise RuntimeError('read-only precondition violated')
cache=tempfile.mkdtemp(prefix='diagnosis-npm-',dir='/tmp')
args=['npm','ci','--no-audit','--no-fund','--cache',cache]
if '--minimal' in sys.argv: args += ['--offline','--ignore-scripts']
start=time.monotonic()
try:
 r=subprocess.run(args,cwd=owner,text=True,capture_output=True,timeout=30)
 target="EROFS: read-only file system, unlink '/home/ubuntu/julia-jul-231/ops/build-runner/node_modules/"
 print(json.dumps({'command':[a if a!=cache else '<disposable-cache>' for a in args],'exit':r.returncode,'seconds':round(time.monotonic()-start,3),'red':target in r.stderr}))
 for line in r.stderr.splitlines():
  if any(x in line for x in ['EROFS','syscall','error path','error errno']):print(line)
 sys.exit(1 if target in r.stderr else 2)
finally:shutil.rmtree(cache)
