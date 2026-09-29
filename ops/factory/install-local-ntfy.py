#!/usr/bin/env python3
"""One-time root setup for Factory's private, self-hosted ntfy origin."""

import json
import os
from pathlib import Path
import pwd
import re
import secrets
import shutil
import subprocess


CONFIG = Path('/etc/julia-factory-wait-alerts/config.json')
SERVER = Path('/etc/ntfy/server.yml')
BASE_URL = 'https://julia-factory.tail91f394.ts.net:8443'
LISTEN = '127.0.0.1:8085'


def run(*args, env=None):
    result = subprocess.run(args, capture_output=True, text=True, env=env)
    if result.returncode:
        raise RuntimeError(f'{args[0]} exited {result.returncode}: {result.stderr.strip()}')
    return result.stdout


def main():
    if os.geteuid() != 0 or not shutil.which('ntfy'):
        raise SystemExit('Run as root after installing ntfy from its official Ubuntu repository')
    config = json.loads(CONFIG.read_text(encoding='utf-8'))
    topic = config['topic']
    if not re.fullmatch(r'[A-Za-z0-9_-]{20,64}', topic):
        raise SystemExit('Invalid watcher topic')
    if SERVER.exists() and BASE_URL in SERVER.read_text(encoding='utf-8'):
        print('Self-hosted ntfy already configured; preserving Web Push keys')
    else:
        if SERVER.exists():
            backup = SERVER.with_name('server.yml.before-julia-alerts')
            if not backup.exists():
                shutil.copy2(SERVER, backup)
        key_output = run('ntfy', 'webpush', 'keys')
        keys = dict(re.findall(r'^(web-push-(?:public|private)-key):\s*(\S+)$',
                               key_output, re.MULTILINE))
        if set(keys) != {'web-push-public-key', 'web-push-private-key'}:
            raise RuntimeError('ntfy did not produce Web Push keys')
        server_config = (
            f'base-url: {BASE_URL}\n'
            f'listen-http: {LISTEN}\n'
            'behind-proxy: true\n'
            'cache-file: /var/cache/ntfy/cache.db\n'
            'cache-duration: 12h\n'
            'auth-file: /var/cache/ntfy/user.db\n'
            'auth-default-access: deny-all\n'
            'web-push-file: /var/cache/ntfy/webpush.db\n'
            'web-push-email-address: toddwyder@users.noreply.github.com\n'
            f'web-push-public-key: {keys["web-push-public-key"]}\n'
            f'web-push-private-key: {keys["web-push-private-key"]}\n'
        )
        SERVER.write_text(server_config, encoding='utf-8')
        os.chown(SERVER, 0, pwd.getpwnam('ntfy').pw_gid)
        SERVER.chmod(0o640)
    # First start creates the auth database while all anonymous access is denied.
    run('systemctl', 'enable', '--now', 'ntfy.service')
    password = secrets.token_urlsafe(32)
    env = dict(os.environ, NTFY_PASSWORD=password)
    # CLI manages its own auth database; no password enters a command line or log.
    run('runuser', '-u', 'ntfy', '--', 'ntfy', 'user', 'add',
        '--ignore-exists', 'factory-watcher', env=env)
    run('runuser', '-u', 'ntfy', '--', 'ntfy', 'access', 'factory-watcher', topic, 'rw')
    run('runuser', '-u', 'ntfy', '--', 'ntfy', 'access', 'everyone', topic, 'ro')
    if 'ntfy_token' not in config:
        token_output = run('runuser', '-u', 'ntfy', '--', 'ntfy', 'token',
                           'add', '--label=factory-wait', 'factory-watcher')
        token_match = re.search(r'\btk_[a-z0-9]{29}\b', token_output)
        if not token_match:
            raise RuntimeError('ntfy did not produce a token')
        config['ntfy_token'] = token_match.group(0)
    config['ntfy_url'] = f'http://{LISTEN}'
    CONFIG.write_text(json.dumps(config) + '\n', encoding='utf-8')
    CONFIG.chmod(0o640)
    os.chown(CONFIG, 0, pwd.getpwnam('julia-factory').pw_gid)
    run('tailscale', 'funnel', '--bg', '--yes', '--https=8443', f'http://{LISTEN}')
    print(f'ntfy ready at {BASE_URL}; watcher stays gated until both devices subscribe')


if __name__ == '__main__':
    main()
