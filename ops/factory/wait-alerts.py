#!/usr/bin/env python3
"""Read Factory's wait state and deliver each new wait to one ntfy topic."""

import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit
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
    if 'fallback_url' in config or 'fallback_topic' in config:
        url = urlsplit(config['fallback_url'])
        if (url.scheme != 'https' or not url.hostname or url.username or url.password
                or url.path not in ('', '/') or url.query or url.fragment):
            raise ValueError('Fallback URL must be an HTTPS origin')
        if not re.fullmatch(r'[a-zA-Z0-9_-]{20,64}', config['fallback_topic']):
            raise ValueError('Invalid fallback topic')
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


def sequence_id(key):
    return hashlib.sha256(key.encode('utf-8')).hexdigest()[:32]


def ntfy_code(error):
    try:
        body = error.read(2049)
        if len(body) > 2048:
            return None
        code = json.loads(body)['code']
        return code if type(code) is int and code in (42901, 42908) else None
    except (ValueError, KeyError, TypeError, AttributeError):
        return None


def publish(config, wait, *, fallback=False):
    origin = config['fallback_url'].rstrip('/') if fallback else 'https://ntfy.sh'
    topic = config['fallback_topic'] if fallback else config['topic']
    target = urljoin(config['factory_url'].rstrip('/') + '/', wait['path'].lstrip('/'))
    body = f"{wait['detail']}: {wait['title']}".encode('utf-8')
    request = Request(
        f'{origin}/{topic}/{sequence_id(wait["key"])}',
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
        columns = {row[1] for row in db.execute('PRAGMA table_info(delivered)')}
        if 'status' not in columns:
            db.execute("ALTER TABLE delivered ADD COLUMN status TEXT NOT NULL DEFAULT 'sent'")
        if 'rejections' not in columns:
            db.execute('ALTER TABLE delivered ADD COLUMN rejections INTEGER NOT NULL DEFAULT 0')
        if 'retry_at' not in columns:
            db.execute('ALTER TABLE delivered ADD COLUMN retry_at REAL')
        if 'ntfy_code' not in columns:
            db.execute('ALTER TABLE delivered ADD COLUMN ntfy_code INTEGER')
        if 'deadline_at' not in columns:
            db.execute('ALTER TABLE delivered ADD COLUMN deadline_at REAL')
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
        for wait in waits:
            row = db.execute('SELECT status,retry_at,rejections,deadline_at FROM delivered WHERE wait_key=?',
                             (wait['key'],)).fetchone()
            deadline_at = row[3] if row else datetime.fromisoformat(
                wait['occurred_at'].replace('Z', '+00:00')).timestamp() + 300
            if row:
                if row[0] != 'rate_limited' or row[1] > time.time():
                    continue
                if row[3] is None or time.time() >= row[3]:
                    db.execute("UPDATE delivered SET status='deadline_unmet', retry_at=NULL "
                               "WHERE wait_key=?", (wait['key'],))
                    db.commit()
                    print(f"wait-alerts kind={wait['kind']} outcome=deadline_unmet")
                    continue
                # Reclaim before sending: an interrupted retry remains uncertain.
                db.execute("UPDATE delivered SET status='attempted', retry_at=NULL WHERE wait_key=?",
                           (wait['key'],))
            else:
                link = urljoin(config['factory_url'].rstrip('/') + '/', wait['path'].lstrip('/'))
                # Claim before the network call. A timeout or process crash must never
                # turn the same wait into a second phone/desktop notification.
                db.execute("INSERT INTO delivered (wait_key,kind,link,status,deadline_at) "
                           "VALUES (?,?,?,'attempted',?)",
                           (wait['key'], wait['kind'], link, deadline_at))
            db.commit()
            try:
                publish(config, wait)
            except HTTPError as error:
                if error.code != 429:
                    print(f"wait-alerts kind={wait['kind']} outcome=uncertain_failure")
                    raise
                code = ntfy_code(error)
                if 'fallback_url' in config and time.time() < deadline_at:
                    try:
                        publish(config, wait, fallback=True)
                    except HTTPError as fallback_error:
                        if fallback_error.code != 429:
                            print(f"wait-alerts kind={wait['kind']} outcome=uncertain_failure")
                            raise
                        # Both origins definitely rejected; only the primary subtype
                        # determines whether a bounded request-bucket retry is useful.
                    except Exception:
                        print(f"wait-alerts kind={wait['kind']} outcome=uncertain_failure")
                        raise
                    else:
                        outcome = 'sent_fallback' if time.time() < deadline_at else 'sent_late_fallback'
                        db.execute("UPDATE delivered SET status=?, delivered_at=CURRENT_TIMESTAMP "
                                   "WHERE wait_key=?", (outcome, wait['key']))
                        db.commit()
                        print(f"wait-alerts kind={wait['kind']} outcome={outcome}")
                        continue
                retry_at = time.time() + 60
                if code != 42901 or retry_at >= deadline_at:
                    db.execute("UPDATE delivered SET status='deadline_unmet', "
                               "rejections=rejections+1, retry_at=NULL, ntfy_code=? WHERE wait_key=?",
                               (code, wait['key']))
                    outcome = 'deadline_unmet'
                else:
                    db.execute("UPDATE delivered SET status='rate_limited', rejections=rejections+1, "
                               "retry_at=?, ntfy_code=? WHERE wait_key=?", (retry_at, code, wait['key']))
                    outcome = 'rate_limited'
                db.commit()
                count = (row[2] if row else 0) + 1
                due = (f' retry_at={datetime.fromtimestamp(retry_at, timezone.utc).isoformat()}'
                       if outcome == 'rate_limited' else '')
                subtype = f' subtype={code}' if code is not None else ' subtype=unknown'
                print(f"wait-alerts kind={wait['kind']} outcome={outcome} rejections={count}{subtype}{due}")
                continue
            except Exception:
                print(f"wait-alerts kind={wait['kind']} outcome=uncertain_failure")
                raise
            outcome = 'sent' if time.time() < deadline_at else 'sent_late'
            db.execute("UPDATE delivered SET status=?, delivered_at=CURRENT_TIMESTAMP WHERE wait_key=?",
                       (outcome, wait['key']))
            db.commit()
            print(f"wait-alerts kind={wait['kind']} outcome={outcome}")


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
