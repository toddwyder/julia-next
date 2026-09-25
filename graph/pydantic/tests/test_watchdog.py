"""JUL-129: watchdog behaviour with a pretend Linear, clock and graph state."""

import unittest
from datetime import datetime, timedelta, timezone

from julia_graph.watchdog import check


PLAN = '## UAT plan\n\n1. Check it.\n'
T0 = datetime(2026, 9, 25, 12, tzinfo=timezone.utc)


class PretendLinear:
    def __init__(self):
        self.cards = {}
        self.posted = []
        self.assigned = []
        self.fail_assign = False

    def add(self, name, state='Implementation', status=None, description=PLAN, labels=(), blockers=(), order=1):
        self.cards[name] = dict(identifier=name, state=state, description=description, labels=list(labels),
                                blockers=list(blockers), sort_order=order, comments=[])
        if status:
            self.cards[name]['comments'].append({'body': status})

    async def in_progress_cards(self):
        return [c for c in self.cards.values() if c['state'] == 'Implementation']

    async def ready_cards(self):
        return [c for c in self.cards.values() if c['state'] == 'Ready']

    async def card(self, name):
        return self.cards[name]

    async def watchdog_card(self, name):
        return self.cards[name]

    async def comment(self, name, body):
        self.cards[name]['comments'].append({'body': body})
        self.posted.append((name, body))

    async def assign_todd(self, name):
        if self.fail_assign:
            raise RuntimeError('assignment failed')
        self.assigned.append(name)


def status(moved=T0, step='building', limit=60):
    return (f'**Where this card is**\nNow: Building (attempt 1), by Gemini, time limit 1 min\n'
            f'Last moved: 12:00 UTC, 25 Sep\n- … Building (attempt 1), since 12:00 UTC\n'
            f'graph: status card=JUL-1 base=8c527a0\n'
            f'graph-moved: {moved:%Y-%m-%dT%H:%M:%SZ} running={step} limit={limit}')


class WatchdogTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.linear = PretendLinear()
        self.now = T0 + timedelta(seconds=61)

    async def run_check(self, graph=('active', 'boot-1')):
        await check(self.linear, lambda: self.now, graph)

    async def test_stuck_comment_and_assignment(self):
        self.linear.add('JUL-1', status=status())
        await self.run_check()
        self.assertEqual(len(self.linear.posted), 1)
        body = self.linear.posted[0][1]
        self.assertIn('Building (attempt 1)', body)
        self.assertIn('1 min', body)
        self.assertIn('Last known activity', body)
        self.assertIn('12:00 UTC', body)
        self.assertEqual(self.linear.assigned, ['JUL-1'])

    async def test_restart_deduplicates_and_assignment_failure_recovers(self):
        self.linear.add('JUL-1', status=status())
        self.linear.fail_assign = True
        with self.assertRaisesRegex(RuntimeError, 'assignment failed'):
            await self.run_check()
        self.linear.fail_assign = False
        await self.run_check()  # a fresh check object, as after timer restart
        self.assertEqual(len(self.linear.posted), 1)
        self.assertEqual(self.linear.assigned, ['JUL-1'])

    async def test_new_step_incident_alerts_again(self):
        self.linear.add('JUL-1', status=status())
        await self.run_check()
        self.linear.cards['JUL-1']['comments'][0]['body'] = status(T0 + timedelta(minutes=2), 'testing', 60)
        self.now = T0 + timedelta(minutes=3, seconds=1)
        await self.run_check()
        self.assertEqual(len(self.linear.posted), 2)

    async def test_dead_graph_only_eligible_ready_and_new_outage(self):
        self.linear.add('JUL-2', 'Ready', description='no UAT plan', order=0)
        self.linear.add('JUL-3', 'Ready', description=PLAN, blockers=[{'identifier': 'JUL-8', 'state': 'Implementation'}])
        self.linear.add('JUL-4', 'Ready', description=PLAN, labels=['Decision'])
        self.linear.add('JUL-5', 'Ready', description=PLAN, order=4)
        await self.run_check(('inactive', 'outage-1'))
        await self.run_check(('inactive', 'outage-1'))
        self.assertEqual([name for name, _ in self.linear.posted], ['JUL-5'])
        await self.run_check(('inactive', 'outage-2'))
        self.assertEqual([name for name, _ in self.linear.posted], ['JUL-5', 'JUL-5'])

    async def test_uat_is_silent(self):
        self.linear.add('JUL-1', 'UAT', status=status())
        await self.run_check(('inactive', 'outage-1'))
        self.assertEqual(self.linear.posted, [])
        self.assertEqual(self.linear.assigned, [])
