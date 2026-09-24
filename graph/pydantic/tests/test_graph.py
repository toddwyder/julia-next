"""The graph run with its workers replaced by scripted fakes.

Git is real (a throwaway repository); Linear, the builder and the test worker
are fakes. What is checked is what can be seen from outside: the comments on
the card, the commits in git, and the saved progress.
"""

from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from julia_graph import workers
from julia_graph.checkpoint import CardLocked, CardRun, Checkpoint, TestResult
from julia_graph.graph import BuildResult, Deps, run_card


class Crash(BaseException):
    """Stands in for the graph's process being killed mid-step."""


class FakeLinear:
    def __init__(self):
        self.comments: list[str] = []

    async def card(self, card):
        return {'identifier': card, 'title': 'Add a greeting', 'description': '- [ ] say hello', 'comments': list(self.comments)}

    async def comment(self, card, body):
        self.comments.append(body)


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
        self.alive: dict[str, list[int]] = {'builder': [], 'tests': []}

    def tearDown(self):
        self.tmp.cleanup()

    def state(self):
        return CardRun(card='JUL-1', base=self.base, branch='graph/card-1', worktree=str(self.worktree))

    async def prepare(self, run):
        if not self.worktree.exists():
            sh(self.repo, 'git', 'worktree', 'add', '-q', '-b', run.branch, run.worktree, run.base)
        return None

    def deps(self, builder=None, tester=None, alive_after_wait=None):
        async def default_builder(run, brief):
            self.builder_calls += 1
            self.brief = brief
            (Path(run.worktree) / 'hello.txt').write_text('hello\n')
            return BuildResult(True, report='Added hello.txt')

        async def default_tester(run):
            self.tester_calls += 1
            return TestResult(passed=True, summary='tests 3, pass 3, fail 0')

        async def counted(fn, *a):
            return await fn(*a)

        async def wait_for_exit(kind):
            return alive_after_wait if alive_after_wait is not None else []

        return Deps(
            linear=self.linear, checkpoint=Checkpoint(self.state_dir, 'JUL-1'), prepare=self.prepare,
            builder=builder or default_builder, discard=workers.discard, commit=workers.commit,
            tester=tester or default_tester, live_workers=lambda kind: self.alive[kind],
            wait_for_exit=wait_for_exit, graph_version='pydantic-graph test', log=lambda line: None,
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

    # ----------------------------------------------------------------- failures say so

    async def test_a_failed_builder_is_reported_and_not_tested(self):
        async def broken(run, brief):
            return BuildResult(False, 'agy denied read_file (ViewFile)')
        outcome = await run_card(self.state(), self.deps(builder=broken))
        self.assertEqual(outcome, 'failed')
        self.assertEqual(self.tester_calls, 0)
        [result] = self.results()
        self.assertIn('FAILED', result)
        self.assertIn('the builder failed: agy denied read_file', result)
        self.assertIn('Candidate commit: none', result)

    async def test_a_builder_that_claims_success_but_changes_nothing_fails(self):
        async def idle(run, brief):
            return BuildResult(True, report='All done!')
        outcome = await run_card(self.state(), self.deps(builder=idle))
        self.assertEqual(outcome, 'failed')
        self.assertIn('no changes to commit', self.results()[0])

    async def test_a_builder_that_cannot_start_is_reported(self):
        async def no_sudo(run, brief):
            raise BrokenPipeError('the worker exited before reading its brief')
        outcome = await run_card(self.state(), self.deps(builder=no_sudo))
        self.assertEqual(outcome, 'failed')
        self.assertIn('the builder could not run: BrokenPipeError', self.results()[0])
        self.assertEqual(self.tester_calls, 0)

    async def test_a_test_worker_that_cannot_start_is_reported_not_retried_forever(self):
        async def no_sudo(run):
            raise BrokenPipeError('the worker exited before reading its request')
        outcome = await run_card(self.state(), self.deps(tester=no_sudo))
        self.assertEqual(outcome, 'failed')
        [result] = self.results()
        self.assertIn('FAILED', result)
        self.assertIn('the test worker could not run: BrokenPipeError', result)
        self.assertEqual(self.saved().step, 'done')

    async def test_failing_tests_are_reported_with_their_names(self):
        async def red(run):
            return TestResult(passed=False, summary='tests 3, pass 2, fail 1', failing=['greets politely'])
        outcome = await run_card(self.state(), self.deps(tester=red))
        self.assertEqual(outcome, 'failed')
        [result] = self.results()
        self.assertIn('FAILED', result)
        self.assertIn('failing: greets politely', result)
        self.assertIn(sh(self.worktree, 'git', 'rev-parse', 'HEAD'), result)

    # ----------------------------------------------------------------- restarts

    async def test_a_restart_after_a_killed_builder_does_not_count_it_as_done(self):
        async def killed(run, brief):
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

    async def test_a_restart_while_the_old_builder_still_runs_starts_no_second_one(self):
        async def killed(run, brief):
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
        async def killed(run, brief):
            raise Crash()
        with self.assertRaises(Crash):
            await run_card(self.state(), self.deps(builder=killed))
        self.alive['builder'] = [4242]
        order = []

        async def wait_then_gone(kind):
            order.append('waited')
            self.alive['builder'] = []
            return []

        async def builder(run, brief):
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
        async def dies(run):
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
            self.assertEqual(workers.live_workers('builder', proc), [101])
            self.assertEqual(workers.live_workers('tests', proc), [102])


if __name__ == '__main__':
    unittest.main()
