"""The board check (JUL-127), driven from outside.

Linear is a pretend board with several cards; the builder and the tests are
scripted fakes; git is real. Every card that starts goes through the real
graph run. What is checked is what Todd would see: which card started, the
comments on each card, the column each card is in, and the builder's brief.
"""

from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path

from julia_graph import workers
from julia_graph.board import CHECK_EVERY, Board, BoardLocked, serve
from julia_graph.checkpoint import Checkpoint, TestResult
from julia_graph.graph import BuildResult, Deps, run_card
from julia_graph.linear import ready_card

from .test_graph import Clock, Crash, sh

GOOD = """## What to build

Say hello.

## Acceptance criteria

- [ ] say hello

## UAT plan

1. Open the page and see hello.
"""


class PretendBoard:
    """Linear with several cards: columns, board order, labels, blockers, comments."""

    def __init__(self):
        self.cards: dict[str, dict] = {}
        self.store: dict[str, tuple[str, str]] = {}  # comment id -> (card, body)
        self.edits: list[str] = []
        self.down = False

    def add(self, name, order, description=GOOD, labels=(), blockers=(), state='Ready'):
        self.cards[name] = {'state': state, 'sort_order': order, 'description': description,
                            'labels': list(labels), 'blockers': list(blockers)}

    def on(self, name) -> list[str]:
        return [body for card, body in self.store.values() if card == name]

    async def ready_cards(self):
        await asyncio.sleep(0)  # a real call yields, so two checks can interleave
        if self.down:
            raise ConnectionError('Linear is unreachable')
        return [{'identifier': name, 'title': f'Card {name}', 'description': c['description'],
                 'sort_order': c['sort_order'], 'labels': c['labels'], 'blockers': c['blockers']}
                for name, c in self.cards.items() if c['state'] == 'Ready']

    async def card(self, name):
        await asyncio.sleep(0)  # a real call yields, so two checks can interleave
        return {'identifier': name, 'title': f'Card {name}', 'description': self.cards[name]['description'],
                'comments': [{'id': i, 'body': b} for i, (card, b) in self.store.items() if card == name]}

    async def comment(self, name, body):
        await asyncio.sleep(0)  # a real call yields, so two checks can interleave
        comment_id = f'c{len(self.store) + 1}'
        self.store[comment_id] = (name, body)
        return comment_id

    async def edit(self, comment_id, body):
        await asyncio.sleep(0)  # a real call yields, so two checks can interleave
        name, _ = self.store[comment_id]
        self.store[comment_id] = (name, body)
        self.edits.append(comment_id)

    async def move(self, name, state):
        await asyncio.sleep(0)  # a real call yields, so two checks can interleave
        self.cards[name]['state'] = state


class BoardTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.repo = root / 'repo'
        self.repo.mkdir()
        sh(self.repo, 'git', 'init', '-q', '-b', 'main')
        (self.repo / 'README.md').write_text('hi\n')
        sh(self.repo, 'git', *workers.GIT_ID, 'add', '-A')
        sh(self.repo, 'git', *workers.GIT_ID, 'commit', '-q', '-m', 'base')
        self.base = sh(self.repo, 'git', 'rev-parse', 'HEAD')
        self.state_dir = root / 'state'
        self.worktrees = root / 'worktrees'
        self.linear = PretendBoard()
        self.clock = Clock()
        self.built: list[str] = []  # the card each builder was started for, in order
        self.briefs: dict[str, str] = {}
        self.alive: dict[str, list[int]] = {'builder': [], 'tests': []}
        self.builder = self.default_builder
        self.on_prepare = None
        self.logged: list[str] = []
        self.boards: list[Board] = []

    async def asyncTearDown(self):
        for board in self.boards:
            await board.idle()
            board.close()

    def tearDown(self):
        self.tmp.cleanup()

    async def default_builder(self, run, brief, limit, progress):
        (Path(run.worktree) / 'hello.txt').write_text('hello\n')
        return BuildResult(True, report='Added hello.txt')

    def card_deps(self, name):
        async def prepare(run):
            if self.on_prepare:
                await self.on_prepare(run)
            if not Path(run.worktree).exists():
                sh(self.repo, 'git', 'worktree', 'add', '-q', '-b', run.branch, run.worktree, run.base)
            return None

        async def builder(run, brief, limit, progress):
            self.built.append(run.card)
            self.briefs[run.card] = brief
            return await self.builder(run, brief, limit, progress)

        async def tester(run, limit, *_):
            return TestResult(passed=True, summary='tests 3, pass 3, fail 0')

        async def wait_for_exit(kind):
            return self.alive[kind]

        return Deps(
            linear=self.linear, checkpoint=Checkpoint(self.state_dir, name), prepare=prepare,
            builder=builder, discard=workers.discard, commit=workers.commit, tester=tester,
            live_workers=lambda kind: self.alive[kind], wait_for_exit=wait_for_exit,
            graph_version='pydantic-graph test', log=lambda line: None, now=self.clock,
        )

    def board(self, open_it=True) -> Board:
        async def base():
            return self.base
        board = Board(linear=self.linear, state_dir=self.state_dir, worktrees=str(self.worktrees), base=base,
                      card_deps=self.card_deps, run=run_card, log=self.logged.append, now=self.clock)
        if open_it:
            board.open()
        self.boards.append(board)
        return board

    def not_started(self, name) -> list[str]:
        return [b for b in self.linear.on(name) if 'graph: not-started' in b]

    def result(self, name) -> list[str]:
        return [b for b in self.linear.on(name) if 'graph: result' in b]

    # ----------------------------------------------------------------- 1. Ready starts the card

    async def test_a_card_moved_to_ready_starts_at_the_next_check(self):
        board = self.board()
        self.assertEqual(await board.check(), 'nothing to start')
        self.linear.add('JUL-1', 10)  # Todd moves the card to Ready
        self.assertEqual(await board.check(), 'started JUL-1')
        await board.idle()
        self.assertEqual(self.built, ['JUL-1'])
        self.assertEqual(self.linear.cards['JUL-1']['state'], 'Implementation')  # it left Ready
        self.assertTrue(any('The Pydantic graph started on this card' in b for b in self.linear.on('JUL-1')))
        [result] = self.result('JUL-1')
        self.assertIn('PASSED', result)
        self.assertIsNone(board.reserved())  # the builder is free again
        self.assertEqual(await board.check(), 'nothing to start')  # and it is not started twice
        self.assertEqual(self.built, ['JUL-1'])

    async def test_the_board_is_checked_about_once_a_minute(self):
        self.assertEqual(CHECK_EVERY, 60)
        board = self.board(open_it=False)
        self.boards.remove(board)
        serving = asyncio.create_task(serve(board, every=0.05))
        try:
            await asyncio.sleep(0.1)
            self.linear.add('JUL-1', 10)  # moved to Ready while the graph runs
            for _ in range(100):
                if self.built:
                    break
                await asyncio.sleep(0.02)
        finally:
            serving.cancel()
            await asyncio.gather(serving, return_exceptions=True)
            await board.idle()
        self.assertEqual(self.built, ['JUL-1'])

    # ----------------------------------------------------------------- 2. board order, skipping the ineligible

    async def test_the_highest_eligible_card_starts_and_an_ineligible_one_above_it_is_skipped(self):
        self.linear.add('JUL-4', 30)
        self.linear.add('JUL-2', 10, description='## What to build\n\nNo plan here.\n')
        self.linear.add('JUL-3', 20)
        board = self.board()
        self.assertEqual(await board.check(), 'started JUL-3')
        await board.idle()
        self.assertEqual(self.built, ['JUL-3'])
        self.assertEqual(self.linear.cards['JUL-2']['state'], 'Ready')
        self.assertEqual(self.linear.cards['JUL-4']['state'], 'Ready')  # waits its turn
        self.assertEqual(len(self.not_started('JUL-2')), 1)
        self.assertEqual(self.not_started('JUL-4'), [])
        self.assertEqual(await board.check(), 'started JUL-4')

    async def test_each_reason_a_card_cannot_start(self):
        self.linear.add('JUL-2', 1, blockers=[{'identifier': 'JUL-9', 'state': 'Implementation', 'type': 'started'}])
        self.linear.add('JUL-3', 2, labels=['Parent'])
        self.linear.add('JUL-4', 3, labels=['Decision'])
        self.linear.add('JUL-5', 4, description='## UAT plan\n\nWe will see.\n')
        self.linear.add('JUL-6', 5, description='## What to build\n\nThings.\n')
        # a blocker at UAT or later, or finished, no longer blocks
        self.linear.add('JUL-7', 6, blockers=[{'identifier': 'JUL-8', 'state': 'UAT', 'type': 'started'},
                                               {'identifier': 'JUL-10', 'state': 'Canceled', 'type': 'canceled'}])
        board = self.board()
        self.assertEqual(await board.check(), 'started JUL-7')
        await board.idle()
        self.assertIn('blocked by JUL-9 (Implementation)', self.not_started('JUL-2')[0])
        self.assertIn('It is a Parent card', self.not_started('JUL-3')[0])
        self.assertIn('It is a Decision card', self.not_started('JUL-4')[0])
        self.assertIn('has no numbered steps', self.not_started('JUL-5')[0])
        self.assertIn('has no "## UAT plan" section', self.not_started('JUL-6')[0])
        self.assertEqual(self.not_started('JUL-7'), [])
        self.assertEqual(self.built, ['JUL-7'])

    # ----------------------------------------------------------------- 3. one plain comment, updated only when the reason changes

    async def test_an_ineligible_card_gets_one_comment_updated_only_when_the_reason_changes(self):
        self.linear.add('JUL-2', 1, blockers=[{'identifier': 'JUL-9', 'state': 'Backlog', 'type': 'backlog'}])
        board = self.board()
        for _ in range(3):
            await board.check()
        [comment] = self.not_started('JUL-2')
        self.assertTrue(comment.startswith('The graph will not start this card yet:'))
        self.assertIn('The cards below it in Ready are not held up.', comment)
        self.assertEqual(self.linear.edits, [])

        # the blocker moves on but still blocks: the reason is the same, so no edit
        self.linear.cards['JUL-2']['blockers'][0].update(state='Implementation', type='started')
        await board.check()
        self.assertEqual(self.linear.edits, [])

        # a new reason: the same comment is edited, never a second one
        self.linear.cards['JUL-2']['labels'].append('Decision')
        await board.check()
        await board.check()
        [comment] = self.not_started('JUL-2')
        self.assertEqual(len(self.linear.edits), 1)
        self.assertIn('It is a Decision card', comment)
        self.assertIn('blocked by JUL-9', comment)
        self.assertEqual(self.built, [])

    async def test_a_restarted_graph_does_not_repeat_the_comment(self):
        self.linear.add('JUL-2', 1, labels=['Parent'])
        first = self.board()
        await first.check()
        first.close()
        await self.board().check()
        self.assertEqual(len(self.not_started('JUL-2')), 1)
        self.assertEqual(self.linear.edits, [])

    # ----------------------------------------------------------------- 4. never a second builder

    async def test_two_checks_at_once_start_one_builder(self):
        self.linear.add('JUL-1', 1)
        self.linear.add('JUL-2', 2)
        release = asyncio.Event()

        async def slow(run, brief, limit, progress):
            await release.wait()
            return await self.default_builder(run, brief, limit, progress)
        self.builder = slow
        board = self.board()
        said = await asyncio.gather(board.check(), board.check())
        for _ in range(50):
            await asyncio.sleep(0)
        self.assertEqual(sorted(said), ['busy with JUL-1', 'started JUL-1'])
        self.assertEqual(await board.check(), 'busy with JUL-1')  # a later check while it builds
        self.assertEqual(self.built, ['JUL-1'])
        self.assertEqual(self.linear.cards['JUL-2']['state'], 'Ready')
        release.set()
        await board.idle()
        self.assertEqual(await board.check(), 'started JUL-2')  # one at a time
        await board.idle()
        self.assertEqual(self.built, ['JUL-1', 'JUL-2'])

    async def test_a_second_graph_started_during_a_restart_is_refused(self):
        self.linear.add('JUL-1', 1)
        self.board()
        with self.assertRaises(BoardLocked):
            self.board()
        self.assertEqual(self.built, [])

    async def test_a_restart_mid_build_resumes_that_card_and_starts_no_other(self):
        self.linear.add('JUL-1', 1)
        self.linear.add('JUL-2', 2)

        async def killed(run, brief, limit, progress):
            raise Crash()  # the graph's process dies while the builder runs
        self.builder = killed
        first = self.board()
        self.assertEqual(await first.check(), 'started JUL-1')
        await first.idle()
        first.close()  # the process is gone; its lock with it
        self.assertEqual(first.reserved(), 'JUL-1')  # the reservation survives

        self.builder = self.default_builder
        again = self.board()
        self.assertEqual(await again.check(), 'resumed JUL-1')
        self.assertEqual(await again.check(), 'busy with JUL-1')
        await again.idle()
        self.assertEqual(self.built, ['JUL-1', 'JUL-1'])  # the same card again, nothing else
        self.assertEqual(self.linear.cards['JUL-2']['state'], 'Ready')
        self.assertTrue(any('graph: build-interrupted' in b for b in self.linear.on('JUL-1')))
        self.assertIn('PASSED', self.result('JUL-1')[0])
        self.assertEqual(await again.check(), 'started JUL-2')

    async def test_a_restart_while_the_old_builder_is_still_alive_starts_no_builder(self):
        self.linear.add('JUL-1', 1)

        async def killed(run, brief, limit, progress):
            raise Crash()
        self.builder = killed
        first = self.board()
        await first.check()
        await first.idle()
        first.close()
        self.alive['builder'] = [4242]  # the orphaned builder never ended
        self.builder = self.default_builder
        again = self.board()
        self.assertEqual(await again.check(), 'resumed JUL-1')
        await again.idle()
        self.assertEqual(self.built, ['JUL-1'])  # only the one that was killed
        self.assertIn('an earlier builder is still running (process 4242)', self.result('JUL-1')[0])

    async def test_a_reservation_whose_run_had_ended_is_released(self):
        self.linear.add('JUL-1', 1)
        board = self.board()
        await board.check()
        await board.idle()
        board._reserve('JUL-1')  # a crash between the end of the run and the release
        board.close()
        self.linear.add('JUL-2', 2)
        self.assertEqual(await self.board().check(), 'started JUL-2')

    # ----------------------------------------------------------------- 5. already in Ready when the graph starts

    async def test_a_card_already_in_ready_when_the_graph_starts_is_picked_up(self):
        self.linear.add('JUL-1', 1)  # there before the graph
        board = self.board(open_it=False)
        self.boards.remove(board)
        serving = asyncio.create_task(serve(board, every=3600))  # no second check would come in time
        try:
            for _ in range(100):
                if self.result('JUL-1'):
                    break
                await asyncio.sleep(0.02)
        finally:
            serving.cancel()
            await asyncio.gather(serving, return_exceptions=True)
            await board.idle()
        self.assertEqual(self.built, ['JUL-1'])

    # ----------------------------------------------------------------- 6. the UAT steps lock at the start

    async def test_the_uat_steps_are_the_ones_on_the_card_when_it_started(self):
        self.linear.add('JUL-1', 1)

        async def todd_edits_the_card(run):
            # after the start, before the builder: the steps change, a note and an Instruction arrive
            self.linear.cards['JUL-1']['description'] = GOOD.replace('Open the page and see hello.',
                                                                     'Open the page and see goodbye.')
            await self.linear.comment('JUL-1', 'Looks good to me.')
            await self.linear.comment('JUL-1', 'Instruction: also check that hello is bold.')
        self.on_prepare = todd_edits_the_card
        board = self.board()
        await board.check()
        await board.idle()
        brief = self.briefs['JUL-1']
        self.assertIn('1. Open the page and see hello.', brief)
        self.assertNotIn('goodbye', brief)
        self.assertIn('Instruction: also check that hello is bold.', brief)
        self.assertNotIn('Looks good to me.', brief)
        started = next(b for b in self.linear.on('JUL-1') if 'graph: started' in b)
        self.assertIn('UAT plan (1 step) is locked as it was at 13:57 UTC, 25 Sep', started)
        self.assertIn('only a new Instruction comment does', started)
        self.assertEqual(Checkpoint(self.state_dir, 'JUL-1').load().uat_plan,
                         '## UAT plan\n\n1. Open the page and see hello.')

    async def test_the_locked_steps_survive_a_restart(self):
        self.linear.add('JUL-1', 1)

        async def killed(run, brief, limit, progress):
            raise Crash()
        self.builder = killed
        first = self.board()
        await first.check()
        await first.idle()
        first.close()
        self.linear.cards['JUL-1']['description'] = GOOD.replace('see hello', 'see goodbye')
        self.builder = self.default_builder
        again = self.board()
        await again.check()
        await again.idle()
        self.assertIn('see hello', self.briefs['JUL-1'])
        self.assertNotIn('goodbye', self.briefs['JUL-1'])

    # ----------------------------------------------------------------- the edges

    async def test_a_finished_card_moved_back_to_ready_runs_again_on_a_fresh_branch(self):
        self.linear.add('JUL-1', 1)
        board = self.board()
        await board.check()
        await board.idle()
        self.linear.cards['JUL-1']['state'] = 'Ready'  # Todd sends it round again
        self.assertEqual(await board.check(), 'started JUL-1')
        await board.idle()
        self.assertEqual(self.built, ['JUL-1', 'JUL-1'])
        self.assertEqual(Checkpoint(self.state_dir, 'JUL-1').load().branch, 'graph/card-1-r2')
        self.assertTrue((self.state_dir / 'JUL-1.run1.json').exists())

    async def test_linear_being_unreachable_starts_nothing_and_the_next_check_carries_on(self):
        self.linear.add('JUL-1', 1)
        self.linear.down = True
        board = self.board()
        self.assertEqual(await board.check(), 'nothing to start')
        self.assertTrue(any('the board could not be read' in line for line in self.logged))
        self.linear.down = False
        self.assertEqual(await board.check(), 'started JUL-1')

    async def test_a_board_that_was_never_opened_checks_nothing(self):
        self.linear.add('JUL-1', 1)
        board = self.board(open_it=False)
        with self.assertRaises(BoardLocked):
            await board.check()
        self.assertEqual(self.built, [])


class LinearShapeTest(unittest.TestCase):
    def test_a_ready_card_reads_its_blockers_from_the_inverse_relations(self):
        card = ready_card({
            'identifier': 'JUL-5', 'title': 'T', 'description': None, 'sortOrder': -28624.5,
            'labels': {'nodes': [{'name': 'Parent'}]},
            'inverseRelations': {'nodes': [
                {'type': 'blocks', 'issue': {'identifier': 'JUL-4', 'state': {'name': 'Backlog', 'type': 'backlog'}}},
                {'type': 'related', 'issue': {'identifier': 'JUL-3', 'state': {'name': 'Ready', 'type': 'unstarted'}}},
            ]},
        })
        self.assertEqual(card, {'identifier': 'JUL-5', 'title': 'T', 'description': '', 'sort_order': -28624.5,
                                'labels': ['Parent'],
                                'blockers': [{'identifier': 'JUL-4', 'state': 'Backlog', 'type': 'backlog'}]})
