import importlib.util
from contextlib import closing, redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from io import BytesIO, StringIO
from pathlib import Path
import json
import runpy
import sqlite3
import sys
from types import SimpleNamespace
from urllib.error import HTTPError
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('wait_alerts', Path(__file__).with_name('wait-alerts.py'))
watcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(watcher)


class SuccessResponse(BytesIO):
    status = 200


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

    def test_rate_limited_wait_delivers_once_after_cooldown(self):
        start = datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc).timestamp()
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            error = HTTPError('https://ntfy.sh/private-topic', 429, 'Too Many Requests', {},
                              BytesIO(b'{"code":42901}'))
            with patch('time.time', return_value=start) as clock, \
                 patch.object(watcher, 'urlopen', side_effect=[error, SuccessResponse(b'{"id":"test"}')]) as send:
                watcher.deliver(self.config, state, [self.wait])
                clock.return_value = start + 59
                watcher.deliver(self.config, state, [self.wait])
                self.assertEqual(send.call_count, 1)
                clock.return_value = start + 61
                watcher.deliver(self.config, state, [self.wait])
                watcher.deliver(self.config, state, [self.wait])
            self.assertEqual(send.call_count, 2)
            requests = [call.args[0] for call in send.call_args_list]
            self.assertEqual(requests[0].full_url, requests[1].full_url)
            self.assertEqual(requests[0].get_header('Click'),
                             'https://factory.example/factories/project/work?item=139')
            self.assertEqual(requests[0].get_header('Click'), requests[1].get_header('Click'))

    def test_repeated_definite_rejection_uses_ready_independent_origin_within_five_minutes_once(self):
        start = datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc).timestamp()
        config = {**self.config, 'fallback_url': 'https://other.example',
                  'fallback_topic': 'other_0123456789abcdef0123456789abcdef'}
        other = {**self.wait, 'key': 'triage-approval:140',
                 'path': '/factories/project/work?item=140'}
        rejected_burst = HTTPError('https://ntfy.sh/private-topic', 429, 'rate limit', {},
                                   BytesIO(b'{"code":42901}'))
        rejected_quota = HTTPError('https://ntfy.sh/private-topic', 429, 'rate limit', {},
                                   BytesIO(b'{"code":42908}'))
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            with patch('time.time', return_value=start), patch.object(watcher, 'urlopen',
                    side_effect=[rejected_burst, SuccessResponse(b'{}'), rejected_quota,
                                 SuccessResponse(b'{}')]) as send:
                watcher.deliver(config, state, [self.wait, other])
                watcher.deliver(config, state, [self.wait, other])
            self.assertEqual(send.call_count, 4)
            requests = [call.args[0] for call in send.call_args_list]
            for original, fallback, wait in zip(requests[::2], requests[1::2],
                                                [self.wait, other]):
                self.assertTrue(original.full_url.startswith('https://ntfy.sh/'))
                self.assertTrue(fallback.full_url.startswith('https://other.example/'))
                self.assertEqual(original.get_header('Click'), fallback.get_header('Click'))
                self.assertEqual(fallback.get_header('Click'),
                                 f'https://factory.example{wait["path"]}')
                self.assertTrue(fallback.full_url.endswith(watcher.sequence_id(wait['key'])))
            with closing(sqlite3.connect(state)) as db:
                self.assertEqual(db.execute("SELECT count(*) FROM delivered WHERE status='sent'").fetchone()[0], 2)

    def test_fallback_timeout_is_not_replayed_on_next_timer_tick(self):
        config = {**self.config, 'fallback_url': 'https://other.example',
                  'fallback_topic': 'other_0123456789abcdef0123456789abcdef'}
        rejected = HTTPError('https://ntfy.sh/private-topic', 429, 'Too Many Requests', {},
                             BytesIO(b'{"code":42908}'))
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            with patch.object(watcher, 'urlopen', side_effect=[rejected, TimeoutError('unknown outcome')]) as send:
                with self.assertRaises(TimeoutError):
                    watcher.deliver(config, state, [self.wait])
                watcher.deliver(config, state, [self.wait])
            self.assertEqual(send.call_count, 2)
            with closing(sqlite3.connect(state)) as db:
                self.assertEqual(db.execute('SELECT status FROM delivered').fetchone()[0], 'attempted')

    def test_repeated_request_bucket_rejections_retry_before_the_deadline(self):
        start = datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc).timestamp()
        def rejected():
            return HTTPError('https://ntfy.sh/private-topic', 429, 'Too Many Requests', {},
                             BytesIO(b'{"code":42901}'))
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            with patch('time.time', return_value=start) as clock, \
                 patch.object(watcher, 'urlopen', side_effect=[rejected(), rejected(),
                                                              SuccessResponse(b'{}')]) as send:
                watcher.deliver(self.config, state, [self.wait])
                clock.return_value += 60
                watcher.deliver(self.config, state, [self.wait])
                clock.return_value += 60
                watcher.deliver(self.config, state, [self.wait])
                watcher.deliver(self.config, state, [self.wait])
            self.assertEqual(send.call_count, 3)

    def test_quota_or_unknown_rejection_without_fallback_reports_unmet_deadline(self):
        for response in (b'{"code":42908}', b'{"code":false}', b'not json', b'X' * 2050):
            with self.subTest(response=response[:20]), tempfile.TemporaryDirectory() as directory:
                state = Path(directory) / 'delivered.sqlite3'
                error = HTTPError('https://ntfy.sh/private-topic', 429, 'private-topic', {},
                                  BytesIO(response))
                output = StringIO()
                with redirect_stdout(output), patch.object(watcher, 'urlopen', side_effect=error) as send:
                    watcher.deliver(self.config, state, [self.wait])
                    watcher.deliver(self.config, state, [self.wait])
                self.assertEqual(send.call_count, 1)
                self.assertIn('outcome=deadline_unmet', output.getvalue())
                self.assertNotIn('private-topic', output.getvalue())
                with closing(sqlite3.connect(state)) as db:
                    self.assertEqual(db.execute('SELECT status FROM delivered').fetchone()[0],
                                     'deadline_unmet')

    def test_request_bucket_rejections_exhaust_the_five_minute_window(self):
        start = datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc).timestamp()
        def rejected():
            return HTTPError('https://ntfy.sh/private-topic', 429, 'Too Many Requests', {},
                             BytesIO(b'{"code":42901}'))
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            output = StringIO()
            with redirect_stdout(output), patch('time.time', return_value=start) as clock, \
                 patch.object(watcher, 'urlopen', side_effect=[rejected() for _ in range(5)]) as send:
                for minute in range(7):
                    clock.return_value = start + minute * 60
                    watcher.deliver(self.config, state, [self.wait])
            self.assertEqual(send.call_count, 5)
            self.assertIn('outcome=deadline_unmet', output.getvalue())
            with closing(sqlite3.connect(state)) as db:
                self.assertEqual(db.execute('SELECT status FROM delivered').fetchone()[0],
                                 'deadline_unmet')

    def test_definite_429_records_only_numeric_subtype_and_keeps_other_waits_eligible(self):
        later = {**self.wait, 'key': 'triage-approval:140',
                 'path': '/factories/project/work?item=140'}
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            output = StringIO()
            error = HTTPError('https://ntfy.sh/private-topic', 429, 'private URL', {},
                              BytesIO(b'{"code":42908,"message":"private-topic"}'))
            with redirect_stdout(output), patch.object(watcher, 'urlopen', side_effect=[
                    error, SuccessResponse(b'{}')]) as send:
                watcher.deliver(self.config, state, [self.wait, later])
            self.assertEqual(send.call_count, 2)
            self.assertIn('subtype=42908', output.getvalue())
            self.assertIn('outcome=sent', output.getvalue())
            self.assertNotIn('private-topic', output.getvalue())
            with closing(sqlite3.connect(state)) as db:
                self.assertEqual(db.execute('SELECT ntfy_code FROM delivered WHERE wait_key=?',
                                            (self.wait['key'],)).fetchone()[0], 42908)

    def test_delivery_events_hide_wait_and_ntfy_identifiers(self):
        start = datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc).timestamp()
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            output = StringIO()
            error = HTTPError('https://ntfy.sh/private-topic', 429, 'Too Many Requests', {},
                              BytesIO(b'{"code":42901}'))
            with redirect_stdout(output), patch('time.time', return_value=start) as clock, \
                 patch.object(watcher, 'urlopen', side_effect=[error, SuccessResponse(b'{}')]):
                watcher.deliver(self.config, state, [self.wait])
                clock.return_value += 60
                watcher.deliver(self.config, state, [self.wait])
                watcher.deliver(self.config, state, [self.wait])
            text = output.getvalue()
            self.assertIn('rate_limited', text)
            self.assertIn('sent', text)
            self.assertIn('triage-approval', text)
            for secret in (self.config['topic'], self.wait['key'], self.wait['path'],
                           self.wait['title'], 'private-topic'):
                self.assertNotIn(secret, text)

    def test_error_output_hides_the_private_http_url(self):
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / 'config.json'
            config_path.write_text(json.dumps({**self.config, 'project_id': 'project',
                                               'user_id': 'todd', 'database': 'factory'}))
            error = HTTPError(f"https://ntfy.sh/{self.config['topic']}/private",
                              403, f"rejected https://ntfy.sh/{self.config['topic']}/private", {}, None)
            stderr = StringIO()
            with patch.object(sys, 'argv', ['wait-alerts.py', '--config', str(config_path),
                                            '--state', str(Path(directory) / 'state.sqlite3')]), \
                 patch('subprocess.run', return_value=SimpleNamespace(stdout=json.dumps(self.wait))), \
                 patch('urllib.request.urlopen', side_effect=error), redirect_stderr(stderr), \
                 redirect_stdout(StringIO()):
                with self.assertRaises(SystemExit) as exit_status:
                    runpy.run_path(str(Path(watcher.__file__)), run_name='__main__')
            self.assertEqual(exit_status.exception.code, 1)
            self.assertNotIn(self.config['topic'], stderr.getvalue())
            self.assertNotIn(self.wait['key'], stderr.getvalue())
            self.assertNotIn('https://ntfy.sh/', stderr.getvalue())

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

    def test_timeout_on_due_retry_stays_claimed(self):
        start = datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc).timestamp()
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            error = HTTPError('https://ntfy.sh/private-topic', 429, 'Too Many Requests', {},
                              BytesIO(b'{"code":42901}'))
            with patch('time.time', return_value=start) as clock, \
                 patch.object(watcher, 'urlopen', side_effect=[error, TimeoutError('unknown outcome')]) as send:
                watcher.deliver(self.config, state, [self.wait])
                clock.return_value += 60
                with self.assertRaises(TimeoutError):
                    watcher.deliver(self.config, state, [self.wait])
                clock.return_value += 86400
                watcher.deliver(self.config, state, [self.wait])
            self.assertEqual(send.call_count, 2)
            with closing(sqlite3.connect(state)) as db:
                self.assertEqual(db.execute('SELECT status FROM delivered').fetchone()[0], 'attempted')

    def test_old_attempted_row_is_not_retried(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'delivered.sqlite3'
            with closing(sqlite3.connect(state)) as db:
                db.execute('''CREATE TABLE delivered (
                    wait_key TEXT PRIMARY KEY, kind TEXT NOT NULL, link TEXT NOT NULL,
                    delivered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    status TEXT NOT NULL DEFAULT 'sent'
                )''')
                db.execute("INSERT INTO delivered(wait_key,kind,link,status) VALUES (?,?,?,'attempted')",
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
