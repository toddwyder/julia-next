#!/usr/bin/env python3
"""Read Factory's wait state and deliver each new wait to one ntfy topic."""

import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
from urllib.parse import urljoin
from urllib.request import Request, urlopen


DEFAULT_CONFIG = Path('/etc/julia-factory-wait-alerts/config.json')
DEFAULT_STATE = Path('/var/lib/julia-factory-wait-alerts/delivered.sqlite3')
SQL = Path(__file__).with_name('wait-alerts.sql')


def config_from(path):
    config = json.loads(path.read_text(encoding='utf-8'))
    if not re.fullmatch(r'[a-zA-Z0-9_-]{20,64}', config['topic']):
        raise ValueError('Invalid ntfy topic')
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', config['project_id']):
        raise ValueError('Invalid Factory project ID')
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', config['user_id']):
        raise ValueError('Invalid Factory user ID')
    if not config['factory_url'].startswith('https://'):
        raise ValueError('Factory URL must use HTTPS')
    return config


def read_waits(config):
    env = dict(os.environ, PGOPTIONS='-c default_transaction_read_only=on')
    result = subprocess.run(
        ['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
         '-v', f"project_id={config['project_id']}",
         '-v', f"user_id={config['user_id']}",
         '-d', config['database'], '-f', str(SQL)],
        check=True, capture_output=True, text=True, env=env, timeout=45,
    )
    waits = [json.loads(line) for line in result.stdout.splitlines() if line]
    for wait in waits:
        if wait['kind'] not in {
            'agent-waiting', 'automation-proposed', 'automation-failed',
            'supervisor-finding', 'mention', 'triage-approval',
        }:
            raise ValueError('Unexpected wait kind')
        if not wait['path'].startswith(f"/factories/{config['project_id']}/"):
            raise ValueError('Unexpected Factory deep link')
    return waits


def sequence_id(key):
    return hashlib.sha256(key.encode('utf-8')).hexdigest()[:32]


def publish(config, wait):
    topic = config['topic']
    target = urljoin(config['factory_url'].rstrip('/') + '/', wait['path'].lstrip('/'))
    body = f"{wait['detail']}: {wait['title']}".encode('utf-8')
    request = Request(
        f'https://ntfy.sh/{topic}/{sequence_id(wait["key"])}',
        data=body,
        headers={'Title': 'Factory needs you', 'Click': target,
                 'Content-Type': 'text/plain; charset=utf-8'},
        method='POST',
    )
    with urlopen(request, timeout=20) as response:
        if response.status not in (200, 201):
            raise RuntimeError(f'ntfy publish returned HTTP {response.status}')
        json.load(response)
    return target


def deliver(config, state_path, waits):
    state_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with closing(sqlite3.connect(state_path)) as db:
        db.execute('''CREATE TABLE IF NOT EXISTS delivered (
            wait_key TEXT PRIMARY KEY, kind TEXT NOT NULL,
            link TEXT NOT NULL, delivered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )''')
        for wait in waits:
            if db.execute('SELECT 1 FROM delivered WHERE wait_key=?', (wait['key'],)).fetchone():
                continue
            link = publish(config, wait)
            db.execute('INSERT INTO delivered (wait_key,kind,link) VALUES (?,?,?)',
                       (wait['key'], wait['kind'], link))
            db.commit()
            print(f"delivered {wait['kind']} {wait['key']} {link}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, default=DEFAULT_CONFIG)
    parser.add_argument('--state', type=Path, default=DEFAULT_STATE)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    config = config_from(args.config)
    waits = read_waits(config)
    if args.dry_run:
        for wait in waits:
            link = urljoin(config['factory_url'].rstrip('/') + '/', wait['path'].lstrip('/'))
            print(json.dumps({'key': wait['key'], 'detail': wait['detail'], 'link': link}))
    else:
        deliver(config, args.state, waits)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'wait-alerts: {error}', file=sys.stderr)
        sys.exit(1)
