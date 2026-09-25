"""The graph run with its workers replaced by scripted fakes.

Git is real (a throwaway repository); Linear, the builder and the test worker
are fakes. What is checked is what can be seen from outside: the comments on
the card, the commits in git, and the saved progress.
"""

from __future__ import annotations

import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from julia_graph import workers
from julia_graph.checkpoint import CardLocked, CardRun, Checkpoint, ReviewResult, TestResult
from julia_graph.graph import BuildResult, Deps, checked_limit, run_card


class Crash(BaseException):
    """Stands in for the graph's process being killed mid-step."""


class FakeLinear:
    def __init__(self):
        self.store: dict[str, str] = {}  # comment id -> body, in posting order
        self.edits: list[str] = []  # ids, one per edit
        self.assigned: list[tuple[str, str | None]] = []

    @property
    def comments(self) -> list[str]:
        return list(self.store.values())

    async def card(self, card):
        return {'identifier': card, 'title': 'Add a greeting', 'description': '- [ ] say hello',
                'comments': [{'id': i, 'body': b} for i, b in self.store.items()]}

    async def comment(self, card, body):
        comment_id = f'c{len(self.store) + 1}'
        self.store[comment_id] = body
        return comment_id

    async def edit(self, comment_id, body):
        assert comment_id in self.store, f'no comment {comment_id} to edit'
        self.store[comment_id] = body
        self.edits.append(comment_id)

    async def assign(self, card, assignee=None):
        self.assigned.append((card, assignee))

    def status(self) -> list[str]:
        return [b for b in self.store.values() if 'graph: status' in b]


class Clock:
    def __init__(self):
        self.t = datetime(2026, 9, 25, 13, 57, tzinfo=timezone.utc)

    def __call__(self):
        return self.t

    def advance(self, seconds):
        self.t += timedelta(seconds=seconds)


def sh(cwd, *args):
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class GraphTest(unittest.IsolatedAsyncioTestCase):
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
        self.state_dir.mkdir()
        self.worktree = root / 'worktrees' / 'card-1'
        self.linear = FakeLinear()
        self.builder_calls = 0
        self.tester_calls = 0
        self.reviewer_calls = 0
        self.reviewer_brief = None
        self.alive: dict[str, list[int]] = {'builder': [], 'tests': [], 'reviewer': []}
        self.clock = Clock()

    def tearDown(self):
        self.tmp.cleanup()

    def state(self):
        return CardRun(card='JUL-1', base=self.base, branch='graph/card-1', worktree=str(self.worktree))

    async def prepare(self, run):
        if self.worktree.exists() and (self.worktree / '.git').is_file():
            workers.set_aside(self.worktree)  # as the real prepare does with an old-style worktree
        if not self.worktree.exists():
            sh(self.repo, 'git', 'clone', '-q', '--no-checkout', '.', run.worktree)
            sh(self.worktree, 'git', 'checkout', '-q', '-b', run.branch, run.base)
        return None

    def deps(self, builder=None, tester=None, reviewer=None, alive_after_wait=None):
        async def default_builder(run, brief, limit, progress):
            self.builder_calls += 1
            self.brief = brief
            (Path(run.worktree) / 'hello.txt').write_text(f'hello {run.attempt}\n')
            return BuildResult(True, report='Added hello.txt')

        async def default_tester(run, limit, *_):
            self.tester_calls += 1
            return TestResult(passed=True, summary='tests 3, pass 3, fail 0')

        async def default_reviewer(run, brief, limit, *_):
            self.reviewer_calls += 1
            self.reviewer_brief = brief
            return ReviewResult(ok=True, verdict='approve', summary='candidate approved')

        async def wait_for_exit(kind):
            return alive_after_wait if alive_after_wait is not None else []

        return Deps(
            linear=self.linear, checkpoint=Checkpoint(self.state_dir, 'JUL-1'), prepare=self.prepare,
            builder=builder or default_builder, discard=workers.discard, commit=workers.commit,
            tester=tester or default_tester, reviewer=reviewer or default_reviewer,
            live_workers=lambda kind: self.alive[kind],
            wait_for_exit=wait_for_exit, graph_version='pydantic-graph test', log=lambda line: None,
            now=self.clock,
            worker_names={'builder': 'Gemini (agy)', 'tests': 'the test runner (no AI model)', 'reviewer': 'DeepSeek (Pi)'},
            worker_companies={'builder': 'Google', 'tests': 'none', 'reviewer': 'DeepSeek'},
            worker_makers={'builder': 'Google', 'tests': 'none', 'reviewer': 'DeepSeek'},
            limits={'builder': 3600, 'tests': 900, 'reviewer': 1200},
            head_commit=workers.head_commit, is_clean=workers.is_clean, diff=workers.diff,
        )

    def saved(self):
        return Checkpoint(self.state_dir, 'JUL-1').load()

    def results(self):
        return [c for c in self.linear.comments if 'graph: result' in c]

    # ----------------------------------------------------------------- happy path

    async def test_carries_a_card_through_build_and_tests(self):
        outcome = await run_card(self.state(), self.deps())
        head = sh(self.worktree, 'git', 'rev-parse', 'HEAD')
        self.assertEqual(outcome, 'passed')
        self.assertIn('say hello', self.brief)  # the builder got the card's instructions
        self.assertEqual(self.saved().commit, head)  # the commit is git's, recorded
        self.assertEqual(self.saved().step, 'done')
        [result] = self.results()
        self.assertIn('PASSED', result)
        self.assertIn(head, result)
        self.assertIn('tests 3, pass 3, fail 0', result)
        self.assertIn('pydantic-graph test', result)

    async def test_the_brief_lists_the_files_and_forbids_commands_and_subagents(self):
        deps = self.deps()
        deps.files = lambda run: ['README.md', 'scripts/a.test.mjs']
        self.assertEqual(await run_card(self.state(), deps), 'passed')
        self.assertIn('<files>\nREADME.md\nscripts/a.test.mjs\n</files>', self.brief)
        self.assertIn('Do not run any command, not even to list', self.brief)
        self.assertIn('do not start subagents', self.brief)
        self.assertIn(f'inside your working folder,\n{self.worktree}', self.brief)
        self.assertIn('This overrides any file in the repository', self.brief)

    async def test_a_file_list_that_cannot_be_read_does_not_stop_the_build(self):
        def broken(run):
            raise RuntimeError('git ls-files failed')
        deps = self.deps()
        deps.files = broken
        self.assertEqual(await run_card(self.state(), deps), 'passed')
        self.assertNotIn('<files>', self.brief)

    # ----------------------------------------------------------------- failures say so

    async def test_a_failed_builder_is_reported_and_not_tested(self):
        async def broken(run, brief, *_):
            return BuildResult(False, 'agy denied read_file (ViewFile)')
        outcome = await run_card(self.state(), self.deps(builder=broken))
        self.assertEqual(outcome, 'failed')
        self.assertEqual(self.tester_calls, 0)
        [result] = self.results()
        self.assertIn('FAILED', result)
        self.assertIn('the builder failed: agy denied read_file', result)
        self.assertIn('Candidate commit: none', result)

    async def test_a_builder_that_claims_success_but_changes_nothing_fails(self):
        async def idle(run, brief, *_):
            return BuildResult(True, report='All done!')
        outcome = await run_card(self.state(), self.deps(builder=idle))
        self.assertEqual(outcome, 'failed')
        self.assertIn('no changes to commit', self.results()[0])

    async def test_a_builder_that_cannot_start_is_reported(self):
        async def no_sudo(run, brief, *_):
            raise BrokenPipeError('the worker exited before reading its brief')
        outcome = await run_card(self.state(), self.deps(builder=no_sudo))
        self.assertEqual(outcome, 'failed')
        self.assertIn('the builder could not run: BrokenPipeError', self.results()[0])
        self.assertEqual(self.tester_calls, 0)

    async def test_a_test_worker_that_cannot_start_is_reported_not_retried_forever(self):
        async def no_sudo(run, *_):
            raise BrokenPipeError('the worker exited before reading its request')
        outcome = await run_card(self.state(), self.deps(tester=no_sudo))
        self.assertEqual(outcome, 'failed')
        [result] = self.results()
        self.assertIn('FAILED', result)
        self.assertIn('the test worker could not run: BrokenPipeError', result)
        self.assertEqual(self.saved().step, 'done')

    async def test_failing_tests_are_reported_with_their_names(self):
        async def red(run, *_):
            return TestResult(passed=False, summary='tests 3, pass 2, fail 1', failing=['greets politely'])
        outcome = await run_card(self.state(), self.deps(tester=red))
        self.assertEqual(outcome, 'failed')
        [result] = self.results()
        self.assertIn('FAILED', result)
        self.assertIn('failing: greets politely', result)
        self.assertIn(sh(self.worktree, 'git', 'rev-parse', 'HEAD'), result)

    # ----------------------------------------------------------------- restarts

    async def test_a_restart_after_a_killed_builder_does_not_count_it_as_done(self):
        async def killed(run, brief, *_):
            (Path(run.worktree) / 'half.txt').write_text('half')
            raise Crash()
        with self.assertRaises(Crash):
            await run_card(self.state(), self.deps(builder=killed))
        self.assertEqual(self.results(), [])  # nothing claimed
        self.assertEqual(self.saved().step, 'build')
        self.assertTrue(self.saved().build_started)

        outcome = await run_card(self.state(), self.deps())
        self.assertEqual(outcome, 'passed')
        self.assertEqual(self.builder_calls, 1)  # exactly one new builder
        self.assertFalse((self.worktree / 'half.txt').exists())
        interrupted = [c for c in self.linear.comments if 'graph: build-interrupted' in c]
        self.assertEqual(len(interrupted), 1)
        self.assertIn('did not count it as done', interrupted[0])
        self.assertEqual(len(self.results()), 1)

    async def test_a_run_resumed_in_an_older_graphs_worktree_starts_again_from_a_fresh_copy(self):
        # A card mid-build when the new graph is deployed: its folder is a git
        # worktree whose .git points outside the builder's folder.
        sh(self.repo, 'git', 'worktree', 'add', '-q', '-b', 'graph/card-1', str(self.worktree), self.base)
        (self.worktree / 'half.txt').write_text('left by the old builder')
        old = self.state()
        old.step, old.build_started, old.attempt = 'build', True, 1
        Checkpoint(self.state_dir, 'JUL-1').save(old)
        self.assertEqual(await run_card(self.state(), self.deps()), 'passed')
        self.assertEqual(self.builder_calls, 1)
        self.assertTrue((self.worktree / '.git').is_dir())  # built in a fresh clone
        self.assertFalse((self.worktree / 'half.txt').exists())
        self.assertTrue((self.worktree.with_name('card-1.run1') / 'half.txt').exists())  # kept aside as it was
        [note] = [c for c in self.linear.comments if 'graph: fresh-copy' in c]
        self.assertIn('made by an older version of the graph', note)

    async def test_a_fresh_copy_waits_for_an_old_builder_still_running(self):
        sh(self.repo, 'git', 'worktree', 'add', '-q', '-b', 'graph/card-1', str(self.worktree), self.base)
        old = self.state()
        old.step, old.build_started, old.attempt = 'build', True, 1
        Checkpoint(self.state_dir, 'JUL-1').save(old)
        self.alive['builder'] = [4242]
        self.assertEqual(await run_card(self.state(), self.deps(alive_after_wait=[4242])), 'failed')
        self.assertEqual(self.builder_calls, 0)
        self.assertTrue((self.worktree / '.git').is_file())  # untouched while the old builder runs

    async def test_a_restart_while_the_old_builder_still_runs_starts_no_second_one(self):
        async def killed(run, brief, *_):
            raise Crash()
        with self.assertRaises(Crash):
            await run_card(self.state(), self.deps(builder=killed))
        self.alive['builder'] = [4242]  # the orphaned builder is still alive
        outcome = await run_card(self.state(), self.deps(alive_after_wait=[4242]))
        self.assertEqual(outcome, 'failed')
        self.assertEqual(self.builder_calls, 0)
        [result] = self.results()
        self.assertIn('an earlier builder is still running (process 4242)', result)
        self.assertNotIn('PASSED', result)

    async def test_a_restart_waits_for_an_old_builder_to_end_before_starting_one(self):
        async def killed(run, brief, *_):
            raise Crash()
        with self.assertRaises(Crash):
            await run_card(self.state(), self.deps(builder=killed))
        self.alive['builder'] = [4242]
        order = []

        async def wait_then_gone(kind):
            order.append('waited')
            self.alive['builder'] = []
            return []

        async def builder(run, brief, *_):
            order.append('built')
            (Path(run.worktree) / 'hello.txt').write_text('hello\n')
            return BuildResult(True, report='ok')

        deps = self.deps(builder=builder)
        deps.wait_for_exit = wait_then_gone
        self.assertEqual(await run_card(self.state(), deps), 'passed')
        self.assertEqual(order, ['waited', 'built'])

    async def test_a_commit_made_before_a_crash_is_not_taken_as_the_candidate(self):
        async def commit_then_die(run):
            await workers.commit(run)
            raise Crash()
        deps = self.deps()
        deps.commit = commit_then_die
        with self.assertRaises(Crash):
            await run_card(self.state(), deps)
        self.assertIsNone(self.saved().commit)
        self.assertEqual(await run_card(self.state(), self.deps()), 'passed')
        # the unrecorded commit was discarded; the candidate is one fresh commit on base
        self.assertEqual(sh(self.worktree, 'git', 'rev-list', '--count', f'{self.base}..HEAD'), '1')
        self.assertEqual(self.saved().commit, sh(self.worktree, 'git', 'rev-parse', 'HEAD'))

    async def test_a_restart_during_tests_reruns_them_and_does_not_rebuild(self):
        async def dies(run, *_):
            raise Crash()
        with self.assertRaises(Crash):
            await run_card(self.state(), self.deps(tester=dies))
        commit = self.saved().commit
        self.assertEqual(self.results(), [])
        self.builder_calls = 0
        self.assertEqual(await run_card(self.state(), self.deps()), 'passed')
        self.assertEqual(self.builder_calls, 0)
        self.assertEqual(self.tester_calls, 1)
        self.assertEqual(self.saved().commit, commit)

    async def test_a_crash_after_posting_the_result_does_not_post_it_twice(self):
        deps = self.deps()
        real_save = deps.checkpoint.save

        def die_on_done(run):
            if run.step == 'done':
                raise Crash()
            real_save(run)
        deps.checkpoint.save = die_on_done
        with self.assertRaises(Crash):
            await run_card(self.state(), deps)
        self.assertEqual(await run_card(self.state(), self.deps()), 'passed')
        self.assertEqual(len(self.results()), 1)

    async def test_a_finished_card_is_not_run_again(self):
        await run_card(self.state(), self.deps())
        posted = len(self.linear.comments)
        self.assertEqual(await run_card(self.state(), self.deps()), 'already reported')
        self.assertEqual(self.builder_calls, 1)
        self.assertEqual(len(self.linear.comments), posted)

    async def test_a_second_graph_for_the_same_card_is_refused(self):
        held = Checkpoint(self.state_dir, 'JUL-1')
        held.lock()
        try:
            with self.assertRaises(CardLocked):
                await run_card(self.state(), self.deps())
        finally:
            held.unlock()
        self.assertEqual(self.builder_calls, 0)

    # ----------------------------------------------------------------- where the card is (JUL-126)

    async def test_the_status_comment_shows_the_step_the_worker_and_when_it_last_moved(self):
        seen = {}

        async def builder(run, brief, limit, progress):
            self.clock.advance(120)  # 13:59
            seen['building'] = self.linear.status()
            seen['limits'] = [('builder', limit)]
            (Path(run.worktree) / 'hello.txt').write_text('hello\n')
            return BuildResult(True, report='ok')

        async def tester(run, limit, *_):
            self.clock.advance(60)  # 14:00
            seen['testing'] = self.linear.status()
            seen['limits'].append(('tests', limit))
            self.clock.advance(30)
            return TestResult(passed=True, summary='tests 3, pass 3, fail 0')

        self.assertEqual(await run_card(self.state(), self.deps(builder=builder, tester=tester)), 'passed')
        [building] = seen['building']
        self.assertIn('Now: Building (attempt 1)', building)
        self.assertIn('Gemini (agy)', building)
        self.assertIn('Last moved: 13:57 UTC, 25 Sep', building)
        self.assertIn('time limit 60 min', building)
        self.assertIn('✓ Prepared the working copy', building)
        [testing] = seen['testing']
        self.assertIn('Now: Running the tests', testing)
        self.assertIn('the test runner (no AI model)', testing)
        self.assertIn('Last moved: 13:59 UTC, 25 Sep', testing)  # the build finishing moved it
        self.assertIn('✓ Built (attempt 1)', testing)
        [final] = self.linear.status()
        self.assertIn('Finished: the tests passed', final)
        self.assertIn('Last moved: 14:00 UTC, 25 Sep', final)
        self.assertNotIn('Now:', final)
        self.assertIn('graph-moved: 2026-09-25T14:00:30Z', final)  # the machine line the stuck check reads
        self.assertEqual(seen['limits'], [('builder', 3600), ('tests', 900)])

    async def test_worker_output_moves_the_card_but_edits_it_at_most_once_a_minute(self):
        async def chatty(run, brief, limit, progress):
            for _ in range(12):  # a line every 10 s for two minutes
                self.clock.advance(10)
                await progress()
            (Path(run.worktree) / 'hello.txt').write_text('hello\n')
            return BuildResult(True, report='ok')

        edits_before = {}

        async def tester(run, limit, *_):
            edits_before['n'] = len(self.linear.edits)
            edits_before['text'] = self.linear.status()[0]
            return TestResult(passed=True, summary='tests 1, pass 1, fail 0')

        await run_card(self.state(), self.deps(builder=chatty, tester=tester))
        # the build starting and the tests starting are one edit each; the rest came from output
        output_edits = edits_before['n'] - 2
        self.assertEqual(output_edits, 2)
        self.assertIn('Last moved: 13:59 UTC', edits_before['text'])

    async def test_a_restart_edits_the_same_status_comment_and_never_posts_a_second(self):
        async def killed(run, brief, *_):
            raise Crash()
        with self.assertRaises(Crash):
            await run_card(self.state(), self.deps(builder=killed))
        # even if the saved progress lost the comment's id, the card's marker finds it
        saved = self.saved()
        saved.status_id = None
        Checkpoint(self.state_dir, 'JUL-1').save(saved)
        self.clock.advance(300)
        self.assertEqual(await run_card(self.state(), self.deps()), 'passed')
        [status] = self.linear.status()
        self.assertIn('Building (attempt 1): interrupted', status)
        self.assertIn('✓ Built (attempt 2)', status)
        self.assertIn('Finished: the tests passed', status)

    async def test_a_builder_past_its_limit_is_stopped_and_the_card_says_so(self):
        async def overrun(run, brief, limit, progress):
            self.clock.advance(limit + 12)
            return BuildResult(False, reason='stopped: ran longer than its 3600-second time limit', stopped=True)

        self.assertEqual(await run_card(self.state(), self.deps(builder=overrun)), 'failed')
        self.assertEqual(self.tester_calls, 0)
        [result] = self.results()
        self.assertIn('The builder ran longer than its 60 min time limit and was stopped after 60 min 12 s.', result)
        self.assertIn('It is no longer running, so the builder is free for the next card.', result)
        [status] = self.linear.status()
        self.assertIn('Stopped: the builder ran too long', status)
        self.assertIn('Building (attempt 1): stopped after 60 min 12 s', status)

    async def test_a_stopped_builder_that_does_not_end_is_named_and_the_builder_is_not_free(self):
        async def overrun(run, brief, limit, progress):
            self.alive['builder'] = [5151]
            self.clock.advance(limit + 1)
            return BuildResult(False, reason='stopped', stopped=True)

        await run_card(self.state(), self.deps(builder=overrun, alive_after_wait=[5151]))
        [result] = self.results()
        self.assertIn('was stopped after 60 min 1 s', result)
        self.assertIn('still running (process 5151)', result)
        self.assertIn('the builder is not free', result)
        self.assertNotIn('free for the next card', result)

    async def test_a_crash_while_confirming_a_stop_reports_the_stop_and_never_reruns_the_worker(self):
        # review finding 1: the graph can die while it waits to see the stopped worker gone
        async def overrun(run, brief, limit, progress):
            self.builder_calls += 1
            self.alive['builder'] = [7]
            self.clock.advance(limit + 5)
            return BuildResult(False, reason='stopped', stopped=True)

        async def dies(kind):
            raise Crash()
        deps = self.deps(builder=overrun)
        deps.wait_for_exit = dies
        with self.assertRaises(Crash):
            await run_card(self.state(), deps)
        self.alive['builder'] = []  # it ended while the graph was down
        self.assertEqual(await run_card(self.state(), self.deps(builder=overrun)), 'failed')
        self.assertEqual(self.builder_calls, 1)
        [result] = self.results()
        self.assertIn('was stopped after 60 min 5 s', result)
        self.assertIn('It is no longer running, so the builder is free for the next card.', result)

    async def test_test_output_moves_the_card_too(self):
        # review finding 2
        async def tester(run, limit, progress):
            for _ in range(3):
                self.clock.advance(70)
                await progress()
            return TestResult(passed=True, summary='tests 1, pass 1, fail 0')
        edits = []

        async def spy(run, limit, progress):
            before = len(self.linear.edits)
            result = await tester(run, limit, progress)
            edits.append(len(self.linear.edits) - before)
            return result
        await run_card(self.state(), self.deps(tester=spy))
        self.assertEqual(edits, [3])

    async def test_a_restart_that_waits_for_an_earlier_builder_says_so_on_the_card(self):
        # review finding 8: the card never shows a finished step as still running
        async def killed(run, brief, *_):
            raise Crash()
        with self.assertRaises(Crash):
            await run_card(self.state(), self.deps(builder=killed))
        self.alive['builder'] = [4242]
        seen = []

        async def wait_and_look(kind):
            seen.append(self.linear.status()[0])
            self.alive['builder'] = []
            return []
        deps = self.deps()
        deps.wait_for_exit = wait_and_look
        await run_card(self.state(), deps)
        self.assertIn('Now: Waiting for an earlier builder to end', seen[0])
        self.assertNotIn('Now: Preparing', seen[0])

    async def test_a_test_run_past_its_limit_is_stopped_and_the_card_says_so(self):
        async def hangs(run, limit, *_):
            self.clock.advance(limit + 3)
            return TestResult(passed=False, summary='stopped: ran longer than its 900-second time limit', stopped=True)

        self.assertEqual(await run_card(self.state(), self.deps(tester=hangs)), 'failed')
        [result] = self.results()
        self.assertIn('The test run ran longer than its 15 min time limit and was stopped after 15 min 3 s.', result)
        self.assertIn('It is no longer running.', result)  # review finding 9: nothing about "the builder"
        self.assertNotIn('builder is free', result)
        [status] = self.linear.status()
        self.assertIn('Stopped: the test run ran too long', status)

    # ----------------------------------------------------------------- independent review (JUL-128)

    async def test_reviewer_approval_posted_on_card(self):
        # AC 1 & UAT 1: Reviewer from different maker reviews full change, verdict posted on card
        async def reviewer(run, brief, limit, progress):
            self.reviewer_calls += 1
            self.reviewer_brief = brief
            return ReviewResult(ok=True, verdict='approve', summary='meets all criteria')

        outcome = await run_card(self.state(), self.deps(reviewer=reviewer))
        self.assertEqual(outcome, 'passed')
        self.assertEqual(self.reviewer_calls, 1)
        self.assertIn('<card>', self.reviewer_brief)
        self.assertIn('<diff>', self.reviewer_brief)
        # Check verdict comment on card
        verdicts = [c for c in self.linear.comments if 'graph: review-verdict' in c]
        self.assertEqual(len(verdicts), 1)
        self.assertIn('Independent Review: APPROVED', verdicts[0])
        self.assertIn('Reviewer: DeepSeek (Pi)', verdicts[0])
        self.assertIn('Company: DeepSeek', verdicts[0])
        self.assertIn('Verdict: approve', verdicts[0])
        self.assertIn('Summary: meets all criteria', verdicts[0])
        # Check result text contains review
        [result] = self.results()
        self.assertIn('PASSED', result)
        self.assertIn('Review: approve (DeepSeek (Pi), DeepSeek) - meets all criteria', result)

    async def test_reviewer_findings_go_back_to_builder_then_approved(self):
        # AC 2: Findings go back to the builder
        builder_briefs = []

        async def builder(run, brief, limit, progress):
            self.builder_calls += 1
            builder_briefs.append(brief)
            (Path(run.worktree) / 'hello.txt').write_text(f'hello round {run.attempt}\n')
            return BuildResult(True, report=f'Attempt {run.attempt} done')

        review_rounds = 0

        async def reviewer(run, brief, limit, progress):
            nonlocal review_rounds
            review_rounds += 1
            self.reviewer_calls += 1
            if review_rounds == 1:
                return ReviewResult(ok=True, verdict='findings', summary='missing tests', findings='Please add tests for edge cases')
            return ReviewResult(ok=True, verdict='approve', summary='all issues resolved')

        outcome = await run_card(self.state(), self.deps(builder=builder, reviewer=reviewer))
        self.assertEqual(outcome, 'passed')
        self.assertEqual(self.builder_calls, 2)
        self.assertEqual(self.reviewer_calls, 2)
        # Verify findings reached the builder on round 2
        self.assertNotIn('<findings>', builder_briefs[0])
        self.assertIn('<findings>', builder_briefs[1])
        self.assertIn('Please add tests for edge cases', builder_briefs[1])
        # Both verdict comments exist
        verdicts = [c for c in self.linear.comments if 'graph: review-verdict' in c]
        self.assertEqual(len(verdicts), 2)
        self.assertIn('Independent Review: FINDINGS', verdicts[0])
        self.assertIn('Independent Review: APPROVED', verdicts[1])

    async def test_reviewer_two_unsuccessful_rounds_stops_with_both_reasons_in_one_comment(self):
        # AC 2 & UAT 2: After two unsuccessful rounds the card stops with both reasons in one comment,
        # and the card should not be assigned to Todd.
        async def builder(run, brief, limit, progress):
            self.builder_calls += 1
            (Path(run.worktree) / 'hello.txt').write_text(f'hello attempt {run.attempt}\n')
            return BuildResult(True, report=f'Attempt {run.attempt} done')

        async def reviewer(run, brief, limit, progress):
            self.reviewer_calls += 1
            return ReviewResult(
                ok=True,
                verdict='findings',
                findings=f'Issue in attempt {run.attempt}: check validation',
            )

        outcome = await run_card(self.state(), self.deps(builder=builder, reviewer=reviewer))
        self.assertEqual(outcome, 'failed')
        self.assertEqual(self.builder_calls, 2)
        self.assertEqual(self.reviewer_calls, 2)
        # Check single comment with both reasons
        stops = [c for c in self.linear.comments if 'graph: two-rounds-stopped' in c]
        self.assertEqual(len(stops), 1)
        self.assertIn('**Review stopped after two unsuccessful rounds:**', stops[0])
        self.assertIn('1. **Round 1:** Issue in attempt 1: check validation', stops[0])
        self.assertIn('2. **Round 2:** Issue in attempt 2: check validation', stops[0])
        # UAT 2: Card should NOT be assigned to Todd
        self.assertEqual(self.linear.assigned, [])

    async def test_reviewer_crashed_or_abnormal_exit_is_never_an_approval(self):
        # AC 3: A crash, timeout, missing verdict or abnormal exit is never an approval,
        # even if the reviewer wrote "approve" earlier.
        async def crashed_reviewer(run, brief, limit, progress):
            self.reviewer_calls += 1
            # Pretend reviewer wrote "approve" in stdout but crashed / had abnormal exit
            return ReviewResult(ok=False, reason='the reviewer exited 137 (SIGKILL)', report='verdict: approve')

        outcome = await run_card(self.state(), self.deps(reviewer=crashed_reviewer))
        self.assertEqual(outcome, 'failed')
        [result] = self.results()
        self.assertIn('FAILED', result)
        self.assertIn('the reviewer failed: the reviewer exited 137', result)
        self.assertNotIn('PASSED', result)
        # No verdict comment posted
        verdicts = [c for c in self.linear.comments if 'graph: review-verdict' in c]
        self.assertEqual(len(verdicts), 0)

    async def test_reviewer_tampering_is_voided_and_card_says_so(self):
        # AC 4: A reviewer that changed the candidate has its review voided and the card says so.
        async def tampering_reviewer(run, brief, limit, progress):
            self.reviewer_calls += 1
            # Reviewer writes a file to the working tree
            (Path(run.worktree) / 'tampered.txt').write_text('illicit edit')
            return ReviewResult(ok=True, verdict='approve', summary='approved with modifications')

        outcome = await run_card(self.state(), self.deps(reviewer=tampering_reviewer))
        self.assertEqual(outcome, 'failed')
        # Check review-voided comment on card
        voids = [c for c in self.linear.comments if 'graph: review-voided' in c]
        self.assertEqual(len(voids), 1)
        self.assertIn('was voided because the reviewer modified the candidate', voids[0])
        self.assertIn('DeepSeek (Pi)', voids[0])
        # Candidate changes discarded
        self.assertFalse((Path(self.worktree) / 'tampered.txt').exists())
        # Not approved
        [result] = self.results()
        self.assertIn('FAILED', result)
        self.assertIn('review was voided', result)

    async def test_stopped_card_assigned_to_todd_only_for_account_money_or_product_decision(self):
        # AC 5: A stopped card is assigned to Todd only for an account action, a money decision or a product decision.
        # 1. Builder fails needing account action (sign-in)
        async def account_action_builder(run, brief, limit, progress):
            return BuildResult(False, 'sign-in required: please authenticate to continue')

        await run_card(self.state(), self.deps(builder=account_action_builder))
        self.assertEqual(self.linear.assigned, [('JUL-1', 'Todd')])
        self.linear.assigned.clear()

        # 2. Builder fails needing money decision
        self.tmp.cleanup()
        self.setUp()
        async def money_builder(run, brief, limit, progress):
            return BuildResult(False, 'budget exceeded: money decision needed')

        await run_card(self.state(), self.deps(builder=money_builder))
        self.assertEqual(self.linear.assigned, [('JUL-1', 'Todd')])
        self.linear.assigned.clear()

        # 3. Builder fails needing product decision
        self.tmp.cleanup()
        self.setUp()
        async def product_builder(run, brief, limit, progress):
            return BuildResult(False, 'product decision needed: choose between option (a) or (b)')

        await run_card(self.state(), self.deps(builder=product_builder))
        self.assertEqual(self.linear.assigned, [('JUL-1', 'Todd')])
        self.linear.assigned.clear()

        # 4. Ordinary code failure -> NOT assigned to Todd
        self.tmp.cleanup()
        self.setUp()
        async def normal_fail_builder(run, brief, limit, progress):
            return BuildResult(False, 'syntax error on line 42')

        await run_card(self.state(), self.deps(builder=normal_fail_builder))
        self.assertEqual(self.linear.assigned, [])

    async def test_reviewer_same_maker_as_builder_is_refused(self):
        # AC 1: Reviewer must be from a different maker than the builder
        deps = self.deps()
        deps.worker_makers = {'builder': 'Google', 'reviewer': 'Google'}
        outcome = await run_card(self.state(), deps)
        self.assertEqual(outcome, 'failed')
        [result] = self.results()
        self.assertIn('the reviewer maker (Google) must be different from the builder maker (Google)', result)


class PrepareTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.origin = root / 'origin'
        self.origin.mkdir()
        sh(self.origin, 'git', 'init', '-q', '-b', 'main')
        (self.origin / 'package-lock.json').write_text('{}\n')
        sh(self.origin, 'git', *workers.GIT_ID, 'add', '-A')
        sh(self.origin, 'git', *workers.GIT_ID, 'commit', '-q', '-m', 'one')
        self.first = sh(self.origin, 'git', 'rev-parse', 'HEAD')
        sh(self.origin, 'git', *workers.GIT_ID, 'commit', '-q', '--allow-empty', '-m', 'two')
        self.second = sh(self.origin, 'git', 'rev-parse', 'HEAD')
        self.repo = root / 'repo'
        sh(root, 'git', 'clone', '-q', str(self.origin), str(self.repo))
        self.worktree = root / 'worktrees' / 'card-1'
        self.installs = []

    def tearDown(self):
        self.tmp.cleanup()

    def run_for(self, base):
        return CardRun(card='JUL-1', base=base, branch='graph/card-1', worktree=str(self.worktree))

    def install(self, worktree):
        self.installs.append(worktree)
        return None

    async def test_a_leftover_working_copy_from_another_base_is_refused(self):
        prepare = workers.prepare(str(self.repo), install=self.install)
        self.assertIsNone(await prepare(self.run_for(self.second)))
        sh(self.worktree, 'git', 'checkout', '-q', '--detach')
        sh(self.worktree, 'git', 'reset', '-q', '--hard', self.first)
        sh(self.worktree, 'git', 'checkout', '-q', '-B', 'graph/card-1')
        refusal = await prepare(self.run_for(self.second))
        self.assertIn('does not start from', refusal)

    async def test_a_leftover_working_copy_ahead_of_the_base_is_refused(self):
        prepare = workers.prepare(str(self.repo), install=self.install)
        self.assertIsNone(await prepare(self.run_for(self.first)))
        (self.worktree / 'other.txt').write_text('another card')
        sh(self.worktree, 'git', *workers.GIT_ID, 'add', '-A')
        sh(self.worktree, 'git', *workers.GIT_ID, 'commit', '-q', '-m', 'other card')
        self.assertIn('does not start from', await prepare(self.run_for(self.first)))

    async def test_a_leftover_working_copy_with_uncommitted_edits_is_refused(self):
        prepare = workers.prepare(str(self.repo), install=self.install)
        self.assertIsNone(await prepare(self.run_for(self.first)))
        (self.worktree / 'stale.txt').write_text('an abandoned edit')
        self.assertIn('uncommitted', await prepare(self.run_for(self.first)) or '')

    async def test_the_working_copy_holds_its_own_git_data(self):
        # JUL-127 live check: Gemini followed a worktree's .git pointer out of
        # its folder and headless agy ended the build. Nothing may point out.
        prepare = workers.prepare(str(self.repo), install=self.install)
        self.assertIsNone(await prepare(self.run_for(self.second)))
        git_dir = self.worktree / '.git'
        self.assertTrue(git_dir.is_dir())  # a folder, not a "gitdir:" pointer file
        self.assertFalse((git_dir / 'objects' / 'info' / 'alternates').exists())
        self.assertEqual(Path(sh(self.worktree, 'git', 'rev-parse', '--absolute-git-dir')), git_dir.resolve())
        self.assertEqual(sh(self.worktree, 'git', 'rev-parse', 'HEAD'), self.second)
        self.assertEqual(sh(self.worktree, 'git', 'rev-parse', '--abbrev-ref', 'HEAD'), 'graph/card-1')

    def names_the_repo(self) -> list[str]:
        """Files in the working copy whose contents name the repo it came from."""
        needle = str(self.repo).encode()
        found = []
        for path in self.worktree.rglob('*'):
            if path.is_file() and '/objects/' not in path.as_posix() and needle in path.read_bytes():
                found.append(str(path.relative_to(self.worktree)))
        return found

    async def test_nothing_in_the_working_copy_names_the_repo(self):
        # Live check, 25 Sep: Gemini read the clone's history log ("clone: from
        # /srv/julia-runner/repo"), followed it, and the refused read ended the build.
        prepare = workers.prepare(str(self.repo), install=self.install)
        self.assertIsNone(await prepare(self.run_for(self.second)))
        self.assertEqual(self.names_the_repo(), [])
        self.assertEqual(sh(self.worktree, 'git', 'remote'), '')
        self.assertEqual(sh(self.worktree, 'git', 'rev-parse', 'HEAD'), self.second)
        # and the graph can still commit and discard there
        (self.worktree / 'hello.txt').write_text('hello\n')
        commit, _ = await workers.commit(self.run_for(self.second))
        self.assertEqual(sh(self.worktree, 'git', 'rev-parse', 'HEAD'), commit)
        self.assertEqual(await workers.discard(self.run_for(self.second)), 1)
        self.assertEqual(sh(self.worktree, 'git', 'rev-parse', 'HEAD'), self.second)

    async def test_a_working_copy_left_straight_after_cloning_is_cleaned_on_resume(self):
        sh(self.repo, 'git', 'clone', '-q', '--no-checkout', '.', str(self.worktree))
        sh(self.worktree, 'git', 'checkout', '-q', '-b', 'graph/card-1', self.second)
        self.assertTrue(self.names_the_repo())  # the killed run never cut the ties
        prepare = workers.prepare(str(self.repo), install=self.install)
        self.assertIsNone(await prepare(self.run_for(self.second)))
        self.assertEqual(self.names_the_repo(), [])

    async def test_an_older_graphs_git_worktree_is_kept_aside_and_replaced_by_a_clone(self):
        sh(self.repo, 'git', 'worktree', 'add', '-q', '-b', 'graph/card-1', str(self.worktree), self.second)
        prepare = workers.prepare(str(self.repo), install=self.install)
        self.assertIsNone(await prepare(self.run_for(self.second)))
        self.assertTrue((self.worktree / '.git').is_dir())  # a clone now
        self.assertEqual(self.names_the_repo(), [])
        kept = self.worktree.with_name('card-1.run1')
        self.assertTrue((kept / '.git').is_file())  # the old worktree, kept as it was

    async def test_a_half_made_clone_is_never_left_as_the_cards_folder(self):
        new = self.worktree.with_name('card-1.new')
        new.mkdir(parents=True)
        (new / 'junk').write_text('a clone killed half-way\n')
        prepare = workers.prepare(str(self.repo), install=self.install)
        self.assertIsNone(await prepare(self.run_for(self.second)))
        self.assertFalse(new.exists())
        self.assertEqual(sh(self.worktree, 'git', 'rev-parse', 'HEAD'), self.second)

    async def test_a_missing_base_leaves_no_folder_behind(self):
        prepare = workers.prepare(str(self.repo), install=self.install)
        with self.assertRaises(RuntimeError):
            await prepare(self.run_for('0' * 40))
        self.assertFalse(self.worktree.exists())
        self.assertFalse(self.worktree.with_name('card-1.new').exists())

    async def test_a_base_newer_than_the_repos_own_main_is_still_found(self):
        # The base is the repo's fresh copy of GitHub's main; the repo's local
        # main lags behind it. The server's repo is shallow, so its clone copies
        # only what its branches reach, and a clone alone would not carry the base.
        shallow = Path(self.tmp.name) / 'shallow-repo'
        sh(Path(self.tmp.name), 'git', 'clone', '-q', '--depth', '1', f'file://{self.origin}', str(shallow))
        (self.origin / 'new.txt').write_text('newer\n')
        sh(self.origin, 'git', *workers.GIT_ID, 'add', '-A')
        sh(self.origin, 'git', *workers.GIT_ID, 'commit', '-q', '-m', 'three')
        third = sh(self.origin, 'git', 'rev-parse', 'HEAD')
        prepare = workers.prepare(str(shallow), install=self.install)
        self.assertIsNone(await prepare(self.run_for(third)))
        self.assertEqual(sh(self.worktree, 'git', 'rev-parse', 'HEAD'), third)
        self.assertNotEqual(sh(shallow, 'git', 'rev-parse', 'main'), third)  # the repo's own main did lag

    async def test_an_interrupted_install_is_run_again(self):
        prepare = workers.prepare(str(self.repo), install=self.install)
        await prepare(self.run_for(self.second))
        await prepare(self.run_for(self.second))  # a restart while still preparing
        self.assertEqual(len(self.installs), 2)


class WorkerParsingTest(unittest.TestCase):
    def test_agy_success_needs_a_final_result_and_a_reply(self):
        ok = '{"step_update":{"state":"ACTIVE","tool_name":"edit_file"}}\n{"event":"result","result":{"status":"SUCCESS","response":"done"}}\n'
        self.assertTrue(workers.agy_outcome(0, ok, '').ok)
        self.assertFalse(workers.agy_outcome(0, '{"step_update":{}}\n', '').ok)
        empty = '{"event":"result","result":{"status":"SUCCESS","response":"  "}}'
        self.assertIn('empty reply', workers.agy_outcome(0, empty, '').reason)
        denied = '{"event":"result","result":{"status":"SUCCESS","response":"x","denied_actions":[{"action":"read_file","display_name":"ViewFile"}]}}'
        self.assertIn('denied read_file', workers.agy_outcome(0, denied, '').reason)
        self.assertFalse(workers.agy_outcome(1, ok, '').ok)

    def test_a_builder_stopped_by_its_time_limit_is_reported_as_stopped(self):
        # time-limit.mjs exits 124 and says so on stderr; whatever agy printed first does not count
        ok = '{"event":"result","result":{"status":"SUCCESS","response":"done"}}\n'
        result = workers.agy_outcome(124, ok, 'stopped: ran longer than its 3600-second time limit\n')
        self.assertFalse(result.ok)
        self.assertTrue(result.stopped)
        self.assertFalse(workers.agy_outcome(1, ok, '').stopped)

    def test_suite_counts_come_from_the_spec_reporter(self):
        out = '✔ a (1ms)\n✖ b breaks (2.5ms)\nℹ tests 2\nℹ pass 1\nℹ fail 1\nℹ skipped 0\n'
        result = workers.suite_result(1, out)
        self.assertFalse(result.passed)
        self.assertEqual(result.failing, ['b breaks'])
        self.assertIn('tests 2, pass 1, fail 1', result.summary)
        self.assertTrue(workers.suite_result(0, 'ℹ tests 2\nℹ pass 2\nℹ fail 0\n').passed)
        self.assertFalse(workers.suite_result(0, 'no summary at all').passed)

    def test_live_workers_reads_the_process_table(self):
        with tempfile.TemporaryDirectory() as d:
            proc = Path(d)
            (proc / '101').mkdir()
            (proc / '101' / 'cmdline').write_bytes(b'sudo\0-n\0-u\0gemini-worker\0--\0/usr/bin/node\0/opt/julia-runner/ops/julia-runner/run-gemini.mjs\0')
            (proc / '102').mkdir()
            (proc / '102' / 'cmdline').write_bytes(b'/usr/bin/node\0/opt/julia-runner/ops/julia-runner/run-tests.mjs\0')
            (proc / 'self').mkdir()
            self.assertEqual(workers.live_workers('builder', proc, uid=None), [101])
            self.assertEqual(workers.live_workers('tests', proc, uid=None), [102])

    def test_live_workers_also_counts_anything_the_worker_account_still_runs(self):
        # review finding 4: an agy or node --test left behind has no launcher in its command line
        with tempfile.TemporaryDirectory() as d:
            proc = Path(d)
            agy = '/home/gemini-worker/.local/bin/agy' + chr(0) + '--print' + chr(0)
            for pid, uid, cmd in [('201', 1005, agy), ('202', 1000, '/usr/bin/bash' + chr(0))]:
                (proc / pid).mkdir()
                (proc / pid / 'cmdline').write_bytes(cmd.encode())
                (proc / pid / 'status').write_text('Name: x' + chr(10) + 'Uid:' + f'{chr(9)}{uid}' * 4 + chr(10))
            self.assertEqual(workers.live_workers('builder', proc, uid=1005), [201])

    def test_reviewer_outcome_parses_json_approval(self):
        stdout = 'some notes\n{"verdict": "approve", "summary": "looks good"}\n'
        res = workers.reviewer_outcome(0, stdout, '')
        self.assertTrue(res.ok)
        self.assertEqual(res.verdict, 'approve')
        self.assertEqual(res.summary, 'looks good')

    def test_reviewer_outcome_parses_json_findings(self):
        stdout = '{"verdict": "findings", "summary": "needs work", "findings": "fix bugs"}\n'
        res = workers.reviewer_outcome(0, stdout, '')
        self.assertTrue(res.ok)
        self.assertEqual(res.verdict, 'findings')
        self.assertEqual(res.findings, 'fix bugs')

    def test_reviewer_outcome_parses_text_verdicts(self):
        res1 = workers.reviewer_outcome(0, 'Code looks solid.\nVERDICT: CLEAN\n', '')
        self.assertTrue(res1.ok)
        self.assertEqual(res1.verdict, 'approve')

        res2 = workers.reviewer_outcome(0, 'VERDICT: FINDINGS\nIssues found.', '')
        self.assertTrue(res2.ok)
        self.assertEqual(res2.verdict, 'findings')

    def test_reviewer_outcome_nonzero_exit_is_never_an_approval(self):
        # AC 3: crash/abnormal exit is never an approval, even if reviewer wrote approve
        res = workers.reviewer_outcome(1, 'VERDICT: CLEAN\nverdict: approve', 'crash dump')
        self.assertFalse(res.ok)
        self.assertIsNone(res.verdict)
        self.assertIn('the reviewer exited 1', res.reason)

    def test_reviewer_outcome_missing_verdict_fails(self):
        res = workers.reviewer_outcome(0, 'I read the code and thought about it.', '')
        self.assertFalse(res.ok)
        self.assertIsNone(res.verdict)
        self.assertIn('ended without a valid verdict', res.reason)

    def test_reviewer_outcome_stopped_by_time_limit(self):
        res = workers.reviewer_outcome(124, '', 'stopped: ran longer than time limit\n')
        self.assertFalse(res.ok)
        self.assertTrue(res.stopped)


class WorkerCallTest(unittest.IsolatedAsyncioTestCase):
    async def test_a_test_run_stopped_by_its_time_limit_is_reported_as_stopped(self):
        replies = iter([(0, 'lint ok', False), (workers.STOPPED_EXIT, 'stopped: ran longer than its 900-second time limit', True)])
        asked = []

        async def ask(run, what, limit, progress):
            asked.append((what, limit))
            return next(replies)
        result = await workers.tester(None, 900, None, ask=ask)
        self.assertTrue(result.stopped)
        self.assertFalse(result.passed)
        self.assertIn('stopped: ran longer than its 900-second time limit', result.summary)
        self.assertEqual(asked, [('lint', 900), ('suite', 900)])

    async def test_a_test_command_that_itself_exits_124_is_a_failure_not_a_stop(self):
        # review finding 6: only the launcher's own stop counts as stopped
        replies = iter([(0, 'lint ok', False), (124, 'ℹ tests 1\nℹ pass 0\nℹ fail 1\n', False)])

        async def ask(run, what, limit, progress):
            return next(replies)
        result = await workers.tester(None, 900, None, ask=ask)
        self.assertFalse(result.stopped)
        self.assertFalse(result.passed)

    async def test_worker_output_lines_reach_the_progress_callback(self):
        lines = []

        async def progress():
            lines.append('moved')
        on_line = workers.line_handler(lambda line: None, progress)
        await on_line('{"step_update":{"state":"ACTIVE","tool_name":"edit_file","tool_info":{"parameters":{"path":"a.js"}}}}\n')
        await on_line('plain text\n')
        self.assertEqual(lines, ['moved', 'moved'])


class LimitTest(unittest.TestCase):
    def test_a_limit_outside_what_the_launcher_allows_is_refused(self):
        # review finding 5: the card never quotes a limit the launcher would not enforce
        self.assertEqual(checked_limit('builder', '20'), 20)
        self.assertEqual(checked_limit('tests', str(60 * 60)), 60 * 60)
        self.assertEqual(checked_limit('reviewer', str(60 * 60)), 60 * 60)
        for bad in ('0', '-5', 'x', str(3 * 60 * 60 + 1)):
            with self.assertRaises(ValueError, msg=bad):
                checked_limit('builder', bad)
        with self.assertRaises(ValueError):
            checked_limit('tests', str(60 * 60 + 1))
        with self.assertRaises(ValueError):
            checked_limit('reviewer', str(60 * 60 + 1))

if __name__ == '__main__':
    unittest.main()
