"""Rerun the authorized clean install; distinguish EROFS from successful install."""
import os,subprocess,sys,tempfile,shutil,time,json
owner='/home/ubuntu/julia-jul-231/ops/build-runner'
if '--syscall' in sys.argv:
 if not (os.statvfs(owner).f_flag & os.ST_RDONLY):
  print('Refusing unlink-only probe on writable installation');sys.exit(2)
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
 r=subprocess.run(args,cwd=owner,text=True,capture_output=True,timeout=180)
 target="EROFS: read-only file system, unlink '/home/ubuntu/julia-jul-231/ops/build-runner/node_modules/"
 print(json.dumps({'command':[a if a!=cache else '<disposable-cache>' for a in args],'exit':r.returncode,'seconds':round(time.monotonic()-start,3),'red':target in r.stderr}))
 for line in r.stderr.splitlines():
  if any(x in line for x in ['EROFS','syscall','error path','error errno']):print(line)
 print('GREEN npm ci completed' if r.returncode==0 else 'RED npm ci failed')
 sys.exit(0 if r.returncode==0 else 1)
finally:shutil.rmtree(cache)
