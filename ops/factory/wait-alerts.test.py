import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('wait_alerts', Path(__file__).with_name('wait-alerts.py'))
watcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(watcher)


class WaitAlertsTest(unittest.TestCase):
    def setUp(self):
        self.wait = {
            'key': 'triage-approval:139:entered', 'kind': 'triage-approval',
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
