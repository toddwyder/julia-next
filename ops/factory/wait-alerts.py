#!/usr/bin/env python3
"""Read Factory's wait state and deliver each new wait to Discord."""

import argparse
from contextlib import closing
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen


DEFAULT_CONFIG = Path('/etc/julia-factory-wait-alerts/config.json')
DEFAULT_STATE = Path('/var/lib/julia-factory-wait-alerts/delivered.sqlite3')
SQL = Path(__file__).with_name('wait-alerts.sql')


def config_from(path):
    config = json.loads(path.read_text(encoding='utf-8'))
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', config['project_id']):
        raise ValueError('Invalid Factory project ID')
    if not re.fullmatch(r'[a-zA-Z0-9_-]+', config['user_id']):
        raise ValueError('Invalid Factory user ID')
    if not config['factory_url'].startswith('https://'):
        raise ValueError('Factory URL must use HTTPS')
    webhook = urlsplit(config['discord_webhook_url'])
    if (webhook.scheme != 'https' or webhook.netloc != 'discord.com' or
            webhook.query or webhook.fragment or not re.fullmatch(
                r'/api/webhooks/[0-9]{17,20}/[A-Za-z0-9_-]{30,}', webhook.path)):
        raise ValueError('Invalid Discord webhook URL')
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
        if wait['kind'] not in {'agent-waiting', 'supervisor-finding', 'triage-approval'}:
            raise ValueError('Unexpected wait kind')
        if not wait['path'].startswith(f"/factories/{config['project_id']}/"):
            raise ValueError('Unexpected Factory deep link')
    return waits


def publish(config, wait):
    target = urljoin(config['factory_url'].rstrip('/') + '/', wait['path'].lstrip('/'))
    summary = f"{wait['detail']}: {wait['title']}".replace('\r', ' ').replace('\n', ' ')
    prefix = 'Factory needs you\n'
    budget = 2000 - len(prefix) - len(target) - 1
    if budget < 0:
        raise ValueError('Factory deep link exceeds Discord message limit')
    content = f'{prefix}{summary[:budget]}\n{target}'
    body = json.dumps({'content': content, 'username': 'Factory',
                       'allowed_mentions': {'parse': []}}).encode('utf-8')
    request = Request(
        config['discord_webhook_url'] + '?wait=true',
        data=body,
        headers={'Content-Type': 'application/json',
                 'User-Agent': 'JuliaFactoryAlerts/1.0'},
        method='POST',
    )
    with urlopen(request, timeout=20) as response:
        if response.status != 200:
            raise RuntimeError(f'Discord publish returned HTTP {response.status}')
        message = json.load(response)
    if not isinstance(message, dict) or not re.fullmatch(r'[0-9]{17,20}', str(message.get('id', ''))):
        raise RuntimeError('Discord did not confirm a message ID')
    return message['id']


def deliver(config, state_path, waits):
    state_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with closing(sqlite3.connect(state_path)) as db:
        db.execute('''CREATE TABLE IF NOT EXISTS delivered (
            wait_key TEXT PRIMARY KEY, kind TEXT NOT NULL,
            link TEXT NOT NULL, delivered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )''')
        columns = {row[1] for row in db.execute('PRAGMA table_info(delivered)')}
        if 'status' not in columns:
            db.execute("ALTER TABLE delivered ADD COLUMN status TEXT NOT NULL DEFAULT 'sent'")
        if 'http_status' not in columns:
            db.execute('ALTER TABLE delivered ADD COLUMN http_status INTEGER')
        if 'discord_message_id' not in columns:
            db.execute('ALTER TABLE delivered ADD COLUMN discord_message_id TEXT')
        # The first release included an occurrence suffix on these keys. Preserve
        # its history when moving to one stable identity per finding or card.
        for key, kind, link, delivered_at, status in db.execute(
            "SELECT wait_key,kind,link,delivered_at,status FROM delivered "
            "WHERE kind IN ('supervisor-finding','triage-approval')"
        ).fetchall():
            stable_key = key
            if kind == 'supervisor-finding' and key.rsplit(':', 1)[-1].isdigit():
                stable_key = key.rsplit(':', 1)[0]
            elif kind == 'triage-approval' and key.count(':') > 1:
                stable_key = ':'.join(key.split(':', 2)[:2])
            if stable_key != key:
                db.execute('''INSERT OR IGNORE INTO delivered
                    (wait_key,kind,link,delivered_at,status) VALUES (?,?,?,?,?)''',
                    (stable_key, kind, link, delivered_at, status))
        db.commit()
        rejected = False
        for wait in waits:
            if db.execute('SELECT 1 FROM delivered WHERE wait_key=?', (wait['key'],)).fetchone():
                continue
            link = urljoin(config['factory_url'].rstrip('/') + '/', wait['path'].lstrip('/'))
            # Claim before the network call. An uncertain result cannot create a
            # duplicate notification on the next timer run.
            db.execute("INSERT INTO delivered (wait_key,kind,link,status) VALUES (?,?,?,'attempted')",
                       (wait['key'], wait['kind'], link))
            db.commit()
            try:
                message_id = publish(config, wait)
            except HTTPError as error:
                db.execute("UPDATE delivered SET status='rejected', http_status=? "
                           "WHERE wait_key=?", (error.code, wait['key']))
                db.commit()
                print(f"wait-alerts kind={wait['kind']} outcome=rejected "
                      f"http_status={error.code}")
                rejected = True
                continue
            except Exception:
                print(f"wait-alerts kind={wait['kind']} outcome=uncertain_failure")
                raise
            db.execute("UPDATE delivered SET status='sent', discord_message_id=?, "
                       "delivered_at=CURRENT_TIMESTAMP WHERE wait_key=?",
                       (message_id, wait['key']))
            db.commit()
            print(f"wait-alerts kind={wait['kind']} outcome=sent")
        if rejected:
            raise RuntimeError('Discord rejected one or more alerts; inspect HTTP codes in the journal')


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
    except Exception:
        print('wait-alerts: failed; inspect the private delivery ledger', file=sys.stderr)
        sys.exit(1)
