import importlib.util
from contextlib import closing, redirect_stdout
from io import BytesIO, StringIO
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError


SPEC = importlib.util.spec_from_file_location('wait_alerts', Path(__file__).with_name('wait-alerts.py'))
watcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(watcher)


class Response(BytesIO):
    status = 200


CONFIRMATION = b'{"id":"123456789012345678","channel_id":"123456789012345679"}'


class WaitAlertsTest(unittest.TestCase):
    def setUp(self):
        self.wait = {
            'key': 'agent-waiting:session:call', 'kind': 'agent-waiting',
            'title': 'Julia recipe intake', 'detail': 'The agent is waiting for your answer',
            'path': '/factories/project/workspaces/session/threads/thread',
        }
        self.config = {
            'factory_url': 'https://factory.example',
            'discord_webhook_url': 'https://discord.com/api/webhooks/123456789012345678/' + 'a' * 68,
            'project_id': 'project', 'user_id': 'todd', 'database': 'factory',
        }

    def test_config_rejects_non_discord_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / 'config.json'
            config_path.write_text(json.dumps({**self.config, 'discord_webhook_url':
                                              'https://example.com/api/webhooks/123456789012345678/token'}))
            with self.assertRaisesRegex(ValueError, 'Discord webhook'):
                watcher.config_from(config_path)
            config_path.write_text(json.dumps(self.config))
            self.assertEqual(watcher.config_from(config_path)['discord_webhook_url'],
                             self.config['discord_webhook_url'])

    def test_publish_confirms_discord_message_with_factory_link_and_no_mentions(self):
        with patch.object(watcher, 'urlopen', return_value=Response(CONFIRMATION)) as send:
            message_id = watcher.publish(self.config, self.wait)
        request = send.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(message_id, '123456789012345678')
        self.assertEqual(request.full_url, self.config['discord_webhook_url'] + '?wait=true')
        self.assertEqual(payload['allowed_mentions'], {'parse': []})
        self.assertIn('https://factory.example' + self.wait['path'], payload['content'])

    def test_accepted_wait_is_sent_only_once(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            with patch.object(watcher, 'urlopen', return_value=Response(CONFIRMATION)) as send:
                watcher.deliver(self.config, state, [self.wait])
                watcher.deliver(self.config, state, [self.wait])
            self.assertEqual(send.call_count, 1)
            with closing(sqlite3.connect(state)) as db:
                self.assertEqual(db.execute('SELECT status,discord_message_id FROM delivered').fetchone(),
                                 ('sent', '123456789012345678'))

    def test_rejection_records_safe_code_without_replay_or_secret_output(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            error = HTTPError(self.config['discord_webhook_url'], 403,
                              'private detail', {}, BytesIO(b'{"message":"private detail"}'))
            output = StringIO()
            with redirect_stdout(output), patch.object(watcher, 'urlopen', side_effect=error) as send:
                with self.assertRaisesRegex(RuntimeError, 'Discord rejected'):
                    watcher.deliver(self.config, state, [self.wait])
                watcher.deliver(self.config, state, [self.wait])
            self.assertEqual(send.call_count, 1)
            with closing(sqlite3.connect(state)) as db:
                self.assertEqual(db.execute(
                    'SELECT status,http_status FROM delivered'
                ).fetchone(), ('rejected', 403))
            self.assertIn('http_status=403', output.getvalue())
            for private in (self.config['discord_webhook_url'],
                            self.wait['key'], self.wait['path'], 'private detail'):
                self.assertNotIn(private, output.getvalue())

    def test_discord_429_retries_after_deadline_without_losing_wait(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            error = HTTPError(self.config['discord_webhook_url'], 429, 'slow down',
                              {'Retry-After': '2'}, BytesIO(b'{"retry_after":2}'))
            with patch.object(watcher.time, 'time', return_value=1000), \
                    patch.object(watcher, 'urlopen', side_effect=error) as send:
                watcher.deliver(self.config, state, [self.wait])
                watcher.deliver(self.config, state, [self.wait])
            self.assertEqual(send.call_count, 1)
            with closing(sqlite3.connect(state)) as db:
                self.assertEqual(db.execute('SELECT status,retry_at FROM delivered').fetchone(),
                                 ('discord_retry', 1002.0))
            with patch.object(watcher.time, 'time', return_value=1003), \
                    patch.object(watcher, 'urlopen', return_value=Response(CONFIRMATION)) as send:
                watcher.deliver(self.config, state, [self.wait])
                watcher.deliver(self.config, state, [self.wait])
            self.assertEqual(send.call_count, 1)
            with closing(sqlite3.connect(state)) as db:
                self.assertEqual(db.execute('SELECT status FROM delivered').fetchone()[0], 'sent')

    def test_server_error_is_uncertain_and_never_replayed(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            error = HTTPError(self.config['discord_webhook_url'], 502, 'upstream', {}, BytesIO())
            with patch.object(watcher, 'urlopen', side_effect=error) as send:
                with self.assertRaises(HTTPError):
                    watcher.deliver(self.config, state, [self.wait])
                watcher.deliver(self.config, state, [self.wait])
            self.assertEqual(send.call_count, 1)
            with closing(sqlite3.connect(state)) as db:
                self.assertEqual(db.execute('SELECT status FROM delivered').fetchone()[0], 'attempted')

    def test_connection_refusal_is_retried_after_deadline(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            with patch.object(watcher.time, 'time', return_value=1000), \
                    patch.object(watcher, 'urlopen', side_effect=URLError(ConnectionRefusedError())) as send:
                watcher.deliver(self.config, state, [self.wait])
                watcher.deliver(self.config, state, [self.wait])
            self.assertEqual(send.call_count, 1)
            with closing(sqlite3.connect(state)) as db:
                self.assertEqual(db.execute('SELECT status,retry_at FROM delivered').fetchone(),
                                 ('discord_retry', 1060.0))
            with patch.object(watcher.time, 'time', return_value=1061), \
                    patch.object(watcher, 'urlopen', return_value=Response(CONFIRMATION)) as send:
                watcher.deliver(self.config, state, [self.wait])
            self.assertEqual(send.call_count, 1)

    def test_unknown_network_failure_is_not_replayed(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            with patch.object(watcher, 'urlopen', side_effect=URLError(TimeoutError())):
                with self.assertRaises(URLError):
                    watcher.deliver(self.config, state, [self.wait])
            with closing(sqlite3.connect(state)) as db:
                self.assertEqual(db.execute('SELECT status FROM delivered').fetchone()[0], 'attempted')
            with patch.object(watcher, 'urlopen', return_value=Response(CONFIRMATION)) as send:
                watcher.deliver(self.config, state, [self.wait])
            send.assert_not_called()

    def test_timeout_is_never_replayed(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            with patch.object(watcher, 'urlopen', side_effect=TimeoutError('unknown')) as send:
                with self.assertRaises(TimeoutError):
                    watcher.deliver(self.config, state, [self.wait])
                watcher.deliver(self.config, state, [self.wait])
            self.assertEqual(send.call_count, 1)
            with closing(sqlite3.connect(state)) as db:
                self.assertEqual(db.execute('SELECT status FROM delivered').fetchone()[0], 'attempted')

    def test_unconfirmed_200_is_not_recorded_as_sent_or_replayed(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            with patch.object(watcher, 'urlopen', return_value=Response(b'{}')) as send:
                with self.assertRaisesRegex(RuntimeError, 'message ID'):
                    watcher.deliver(self.config, state, [self.wait])
                watcher.deliver(self.config, state, [self.wait])
            self.assertEqual(send.call_count, 1)
            with closing(sqlite3.connect(state)) as db:
                self.assertEqual(db.execute('SELECT status FROM delivered').fetchone()[0], 'attempted')

    def test_legacy_rate_limited_wait_is_not_replayed_after_origin_change(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            with closing(sqlite3.connect(state)) as db:
                db.execute('''CREATE TABLE delivered (
                    wait_key TEXT PRIMARY KEY, kind TEXT NOT NULL, link TEXT NOT NULL,
                    delivered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    status TEXT NOT NULL DEFAULT 'sent',
                    rejections INTEGER NOT NULL DEFAULT 0, retry_at REAL
                )''')
                db.execute("INSERT INTO delivered(wait_key,kind,link,status) VALUES (?,?,?,'rate_limited')",
                           (self.wait['key'], self.wait['kind'], 'https://factory.example/card'))
                db.commit()
            with patch.object(watcher, 'urlopen') as send:
                watcher.deliver(self.config, state, [self.wait])
            send.assert_not_called()

    def test_old_card_and_finding_keys_are_not_resent(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            with closing(sqlite3.connect(state)) as db:
                db.execute('''CREATE TABLE delivered (
                    wait_key TEXT PRIMARY KEY, kind TEXT NOT NULL,
                    link TEXT NOT NULL, delivered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )''')
                db.execute('INSERT INTO delivered(wait_key,kind,link) VALUES (?,?,?)',
                           ('triage-approval:139:2026-09-28T18:16:31.152Z',
                            'triage-approval', 'https://factory.example/card'))
                db.execute('INSERT INTO delivered(wait_key,kind,link) VALUES (?,?,?)',
                           ('supervisor-finding:label-drift:139:0',
                            'supervisor-finding', 'https://factory.example/supervisor'))
                db.commit()
            waits = [
                {**self.wait, 'kind': 'triage-approval', 'key': 'triage-approval:139'},
                {**self.wait, 'kind': 'supervisor-finding',
                 'key': 'supervisor-finding:label-drift:139'},
            ]
            with patch.object(watcher, 'publish') as publish:
                watcher.deliver(self.config, state, waits)
            publish.assert_not_called()


if __name__ == '__main__':
    unittest.main()
