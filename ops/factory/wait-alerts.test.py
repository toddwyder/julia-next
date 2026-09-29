import importlib.util
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('wait_alerts', Path(__file__).with_name('wait-alerts.py'))
watcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(watcher)


class WaitAlertsTest(unittest.TestCase):
    def setUp(self):
        self.wait = {
            'key': 'triage-approval:139', 'kind': 'triage-approval',
            'title': "Todd's approval is the only way to merge",
            'detail': 'This Triage card needs your approval',
            'path': '/factories/project/work?item=139',
        }
        self.config = {'topic': 'julia_factory_0123456789abcdef0123456789abcdef',
                       'factory_url': 'https://factory.example'}

    def test_one_delivery_survives_another_timer_run(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            with patch.object(watcher, 'publish', return_value='https://factory.example/factories/project/work?item=139') as publish:
                watcher.deliver(self.config, state, [self.wait])
                watcher.deliver(self.config, state, [self.wait])
            self.assertEqual(publish.call_count, 1)

    def test_failed_publish_is_not_retried(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            with patch.object(watcher, 'publish', side_effect=TimeoutError('unknown outcome')) as publish:
                with self.assertRaises(TimeoutError):
                    watcher.deliver(self.config, state, [self.wait])
                watcher.deliver(self.config, state, [self.wait])
            self.assertEqual(publish.call_count, 1)
            with closing(sqlite3.connect(state)) as db:
                self.assertEqual(db.execute('SELECT status FROM delivered').fetchone()[0], 'attempted')

    def test_old_card_and_finding_keys_are_not_resent(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            with closing(sqlite3.connect(state)) as db:
                db.execute('''CREATE TABLE delivered (
                    wait_key TEXT PRIMARY KEY, kind TEXT NOT NULL,
                    link TEXT NOT NULL, delivered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )''')
                db.execute("INSERT INTO delivered(wait_key,kind,link) VALUES (?,?,?)",
                           ('triage-approval:139:2026-09-28T18:16:31.152Z',
                            'triage-approval', 'https://factory.example/card'))
                db.execute("INSERT INTO delivered(wait_key,kind,link) VALUES (?,?,?)",
                           ('supervisor-finding:label-drift:139:0',
                            'supervisor-finding', 'https://factory.example/supervisor'))
                db.commit()
            finding = {**self.wait, 'kind': 'supervisor-finding',
                       'key': 'supervisor-finding:label-drift:139'}
            with patch.object(watcher, 'publish') as publish:
                watcher.deliver(self.config, state, [self.wait, finding])
                watcher.deliver(self.config, state, [self.wait, finding])
            publish.assert_not_called()

    def test_retry_uses_the_same_notification_identity(self):
        self.assertEqual(watcher.sequence_id(self.wait['key']), watcher.sequence_id(self.wait['key']))
        self.assertNotEqual(watcher.sequence_id(self.wait['key']), watcher.sequence_id('other wait'))

    def test_alert_link_opens_the_specific_card(self):
        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def read(self, *_):
                return b'{"id":"test"}'

        with patch.object(watcher, 'urlopen', return_value=Response()) as send:
            link = watcher.publish(self.config, self.wait)
        self.assertEqual(link, 'https://factory.example/factories/project/work?item=139')
        request = send.call_args.args[0]
        self.assertEqual(request.get_header('Click'), link)
        self.assertIn(watcher.sequence_id(self.wait['key']), request.full_url)


if __name__ == '__main__':
    unittest.main()
