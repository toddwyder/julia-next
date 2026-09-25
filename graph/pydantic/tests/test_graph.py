"""The graph run with its workers replaced by scripted fakes.

Git is real (a throwaway repository); Linear, the builder and the test worker
are fakes. What is checked is what can be seen from outside: the comments on
the card, the commits in git, and the saved progress.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from datetime import datetime, timedelta, timezone
from pathlib import Path

from julia_graph import workers
from julia_graph.checkpoint import CardLocked, CardRun, Checkpoint, ReviewResult, TestResult
from julia_graph.graph import MAX_REVIEW_BYTES, BuildResult, Deps, checked_limit, run_card

REPO_ROOT = Path(__file__).resolve().parents[3]
ROLE = 'ROLE FILE: attack the candidate against every acceptance criterion.'


def met(*criteria: str) -> list[dict]:
    """The reviewer's answers, one per acceptance criterion, all met."""
    return [{'id': f'AC{n}', 'criterion': text, 'verdict': 'met', 'how': f'read the diff for {text}'}
            for n, text in enumerate(criteria, 1)]


async def approving_reviewer(run, brief, limit, progress):
    """Approves whatever card it gets, answering each criterion the brief lists."""
    listed = re.findall(r'^- AC\d+: (.*)$', brief, re.M)
    return ReviewResult(ok=True, verdict='approve', summary='all criteria met', criteria=met(*listed))


def verdict(value, **extra) -> str:
    """A reviewer's final message ending with its JSON verdict, as the role file asks."""
    return 'I checked the diff against each criterion.\n\n' + json.dumps({'verdict': value, **extra})


def pi_stream(*finals: str, stop='stop', error=None) -> str:
    """A Pi JSON event stream (run-pi-seat.mjs's output), one assistant message
    per text, ending as Pi ends a run: agent_end repeating the last message
    without its text (ops/service-dropbox/run-pi-seat.test.mjs), then agent_settled."""
    events = [{'type': 'agent_start'}]
    for text in finals:
        events.append({'type': 'message_start', 'message': {'role': 'assistant', 'content': [], 'stopReason': 'pending'}})
        events.append({'type': 'message_update', 'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': text[:10]}]}})
        events.append({'type': 'message_end', 'message': {'role': 'assistant', 'stopReason': stop,
                                                          'content': [{'type': 'text', 'text': text}],
                                                          **({'errorMessage': error} if error else {})}})
    events.append({'type': 'agent_end', 'messages': [{'role': 'assistant', 'stopReason': stop,
                                                      **({'errorMessage': error} if error else {})}], 'willRetry': False})
    events.append({'type': 'agent_settled'})
    return '\n'.join(map(json.dumps, events)) + '\n'


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
        return {'identifier': card, 'title': 'Add a greeting', 'description': '## Acceptance criteria\n\n- [ ] say hello\n',
                'comments': [{'id': i, 'body': b} for i, b in self.store.items()]}

    async def comment(self, card, body):
        comment_id = f'c{len(self.store) + 1}'
        self.store[comment_id] = body
        return comment_id

    async def edit(self, comment_id, body):
        assert comment_id in self.store, f'no comment {comment_id} to edit'
        self.store[comment_id] = body
        self.edits.append(comment_id)

    async def assign_to_todd(self, card):
        self.assigned.append(card)

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
        self.reviewer_briefs: list[str] = []
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
            self.reviewer_briefs.append(brief)
            return ReviewResult(ok=True, verdict='approve', summary='candidate approved', criteria=met('say hello'))

        async def wait_for_exit(kind):
            return alive_after_wait if alive_after_wait is not None else []

        return Deps(
            linear=self.linear, checkpoint=Checkpoint(self.state_dir, 'JUL-1'), prepare=self.prepare,
            builder=builder or default_builder, discard=workers.discard, commit=workers.commit,
            tester=tester or default_tester, reviewer=reviewer or default_reviewer,
            live_workers=lambda kind: self.alive[kind],
            wait_for_exit=wait_for_exit, graph_version='pydantic-graph test', log=lambda line: None,
            now=self.clock,
            worker_names={'builder': 'Gemini (agy)', 'tests': 'the test runner (no AI model)',
                          'reviewer': 'DeepSeek V4 Pro (Pi)'},
            worker_makers={'builder': 'Google', 'reviewer': 'DeepSeek'},
            limits={'builder': 3600, 'tests': 900, 'reviewer': 1200},
            snapshot=workers.snapshot, restore=workers.restore, drift=workers.drift, diff=workers.change,
            base_file=lambda run, path: ROLE if path == '.agents/skills/julia-reviewer/SKILL.md' else '',
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
        self.assertEqual(self.builder_calls, 1)  # not the builder's to fix

    # ----------------------------------------------------------------- failed tests go back to the builder

    def repairing_builder(self, crash_on=None):
        """Builds hello.txt, then each repair adds a line (a real change to commit)."""
        self.briefs = []

        async def build(run, brief, limit, progress):
            self.builder_calls += 1
            self.briefs.append(brief)
            path = Path(run.worktree) / 'hello.txt'
            path.write_text((path.read_text() if path.exists() else '') + f'turn {self.builder_calls}\n')
            if self.builder_calls == crash_on:
                raise Crash()
            return BuildResult(True, report=f'turn {self.builder_calls}')
        return build

    def red_until(self, turn, failing='greets politely'):
        async def test(run, *_):
            self.tester_calls += 1
            if self.tester_calls >= turn:
                return TestResult(passed=True, summary='tests 3, pass 3, fail 0')
            return TestResult(passed=False, summary=f'tests 3, pass 2, fail 1 (run {self.tester_calls})',
                              failing=[failing], details=f'✖ {failing}\n  AssertionError: expected "hello" (run {self.tester_calls})')
        return test

    async def test_failed_tests_go_to_the_builder_and_the_repaired_commit_is_tested_again(self):
        outcome = await run_card(self.state(), self.deps(builder=self.repairing_builder(), tester=self.red_until(2)))
        self.assertEqual(outcome, 'passed')
        self.assertEqual((self.builder_calls, self.tester_calls), (2, 2))
        first, repaired = sh(self.worktree, 'git', 'rev-list', '--reverse', f'{self.base}..HEAD').splitlines()
        # the repair got the failure, the failing commit and its own earlier work
        self.assertNotIn('failed on', self.briefs[0])
        self.assertIn('greets politely', self.briefs[1])
        self.assertIn('AssertionError: expected "hello" (run 1)', self.briefs[1])
        self.assertIn(first, self.briefs[1])
        self.assertIn('say hello', self.briefs[1])  # still the card's own brief
        self.assertEqual((Path(self.worktree) / 'hello.txt').read_text(), 'turn 1\nturn 2\n')
        # the card said the tests failed and a repair was starting
        [told] = [c for c in self.linear.comments if 'graph: tests-failed' in c]
        self.assertIn(first, told)
        self.assertIn('repair 1 of 2', told)
        [result] = self.results()
        self.assertIn('PASSED', result)
        self.assertIn(f'Candidate commit: `{repaired}`', result)
        self.assertIn('fail 1 (run 1)', result)  # the earlier round is still listed
        self.assertEqual(self.saved().commit, repaired)

    async def test_tests_that_keep_failing_end_the_run_once_the_repairs_are_used(self):
        outcome = await run_card(self.state(), self.deps(builder=self.repairing_builder(), tester=self.red_until(99)))
        self.assertEqual(outcome, 'failed')
        self.assertEqual((self.builder_calls, self.tester_calls), (3, 3))
        [result] = self.results()
        self.assertIn('FAILED', result)
        self.assertIn('the tests still failed after 2 repair attempts', result)
        self.assertIn('failing: greets politely', result)
        for run in (1, 2, 3):
            self.assertIn(f'fail 1 (run {run})', result)
        self.assertIn(sh(self.worktree, 'git', 'rev-parse', 'HEAD'), result)
        self.assertEqual(len([c for c in self.linear.comments if 'graph: tests-failed' in c]), 2)
        self.assertEqual(self.saved().step, 'done')

    async def test_a_failure_that_names_no_test_is_reported_not_repaired(self):
        async def unclear(run, *_):
            self.tester_calls += 1
            return TestResult(passed=False, summary='the test worker did not answer (exit 1)')
        outcome = await run_card(self.state(), self.deps(tester=unclear))
        self.assertEqual(outcome, 'failed')
        self.assertEqual((self.builder_calls, self.tester_calls), (1, 1))
        self.assertIn('the test worker did not answer', self.results()[0])

    async def test_a_repair_that_changes_nothing_fails_and_says_so(self):
        async def once(run, brief, *_):
            self.builder_calls += 1
            if self.builder_calls == 1:
                (Path(run.worktree) / 'hello.txt').write_text('hello\n')
            return BuildResult(True, report='done')
        outcome = await run_card(self.state(), self.deps(builder=once, tester=self.red_until(99)))
        self.assertEqual(outcome, 'failed')
        [result] = self.results()
        self.assertIn('no changes to commit', result)
        self.assertIn('fail 1 (run 1)', result)

    async def test_a_restart_during_a_repair_keeps_the_failed_candidate_and_discards_only_the_repair(self):
        with self.assertRaises(Crash):
            await run_card(self.state(), self.deps(builder=self.repairing_builder(crash_on=2), tester=self.red_until(2)))
        first = self.saved().commit
        self.assertEqual(self.saved().step, 'build')
        self.builder_calls = 1  # the next builder turn is the repair again
        outcome = await run_card(self.state(), self.deps(builder=self.repairing_builder(), tester=self.red_until(2)))
        self.assertEqual(outcome, 'passed')
        interrupted = [c for c in self.linear.comments if 'graph: build-interrupted' in c]
        self.assertEqual(len(interrupted), 1)
        # the interrupted repair's edit was thrown away, the first build's was kept
        self.assertEqual(sh(self.worktree, 'git', 'rev-list', '--reverse', f'{self.base}..HEAD').splitlines()[0], first)
        self.assertEqual((Path(self.worktree) / 'hello.txt').read_text(), 'turn 1\nturn 2\n')
        self.assertIn('greets politely', self.briefs[-1])  # the retried repair still got the failure

    async def test_the_status_comment_shows_the_failed_tests_and_the_repair(self):
        await run_card(self.state(), self.deps(builder=self.repairing_builder(), tester=self.red_until(2)))
        [status] = self.linear.status()
        self.assertIn('✗ Running the tests: failed', status)
        self.assertIn('✓ Built (attempt 2, repairing failed tests)', status)
        self.assertIn('Finished: the tests passed and the review approved.', status)

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

    # ----------------------------------------------------------------- the independent review (JUL-128)

    def reviewer_says(self, *answers):
        """A pretend reviewer giving these answers in turn (the last one repeats)."""
        answers = list(answers)

        async def review(run, brief, limit, progress):
            self.reviewer_calls += 1
            self.reviewer_briefs.append(brief)
            answer = answers[min(self.reviewer_calls, len(answers)) - 1]
            return await answer(run) if callable(answer) else answer
        return review

    def verdicts(self):
        return [c for c in self.linear.comments if 'graph: review-verdict' in c]

    def head(self):
        return sh(self.worktree, 'git', 'rev-parse', 'HEAD')

    APPROVE = ReviewResult(ok=True, verdict='approve', summary='every criterion met', criteria=met('say hello'))

    @staticmethod
    def findings(text, **extra):
        return ReviewResult(ok=True, verdict='changes_needed', findings=text, **extra)

    async def test_1_approval_is_posted_with_the_reviewer_and_its_company(self):
        outcome = await run_card(self.state(), self.deps(reviewer=self.reviewer_says(self.APPROVE)))
        self.assertEqual(outcome, 'passed')
        [brief] = self.reviewer_briefs
        # the reviewer works from its role file, the card, the graph's test result and the whole change
        for part in (ROLE, '- AC1: say hello', 'tests 3, pass 3, fail 0', '+hello 1', self.head(), self.base):
            self.assertIn(part, brief)
        [posted] = self.verdicts()
        self.assertIn('APPROVED', posted)
        self.assertIn('Reviewer: DeepSeek V4 Pro (Pi), from DeepSeek', posted)
        [result] = self.results()
        self.assertIn('PASSED', result)
        self.assertIn('Review: approved, by DeepSeek V4 Pro (Pi), from DeepSeek (round 1 of 2)', result)
        self.assertEqual(self.linear.assigned, [])
        self.assertIn('Finished: the tests passed and the review approved.', self.linear.status()[0])

    async def test_2_findings_go_back_to_the_builder_on_top_of_its_commit_then_approval(self):
        outcome = await run_card(self.state(), self.deps(
            reviewer=self.reviewer_says(self.findings('F1: hello.txt must end with a full stop'), self.APPROVE)))
        self.assertEqual(outcome, 'passed')
        self.assertEqual((self.builder_calls, self.tester_calls, self.reviewer_calls), (2, 2, 2))
        first, second = sh(self.worktree, 'git', 'rev-list', '--reverse', f'{self.base}..HEAD').splitlines()
        self.assertIn('F1: hello.txt must end with a full stop', self.brief)  # the second build's brief
        self.assertIn(f'({first})', self.brief)
        self.assertNotIn('The tests failed', self.brief)
        self.assertIn(second, self.reviewer_briefs[1])  # the new commit was reviewed
        found, approved = self.verdicts()
        self.assertIn('CHANGES NEEDED', found)
        self.assertIn('F1: hello.txt must end with a full stop', found)
        self.assertIn('APPROVED', approved)
        self.assertIn('Round: 2 of 2', approved)
        self.assertIn('✓ Built (attempt 2, fixing review findings)', self.linear.status()[0])

    async def test_3_two_rounds_of_findings_stop_the_card_with_both_reasons_in_one_comment(self):
        outcome = await run_card(self.state(), self.deps(reviewer=self.reviewer_says(
            self.findings('F1: no validation'), self.findings('F2: still no validation, now off by one'))))
        self.assertEqual(outcome, 'failed')
        self.assertEqual((self.builder_calls, self.reviewer_calls), (2, 2))
        [stop] = [c for c in self.linear.comments if 'graph: review-stopped' in c]
        self.assertIn('Round 1:** F1: no validation', stop)
        self.assertIn('Round 2:** F2: still no validation, now off by one', stop)
        self.assertIn('No new card was opened', stop)
        self.assertEqual(self.linear.assigned, [])  # UAT 2: not assigned to Todd
        self.assertIn('the review asked for changes in 2 rounds', self.results()[0])

    async def test_4_a_crashed_reviewer_is_never_an_approval_even_after_writing_approve(self):
        crashed = ReviewResult(reason='the reviewer exited 137: killed', text=verdict('approve'))
        outcome = await run_card(self.state(), self.deps(reviewer=self.reviewer_says(crashed)))
        self.assertEqual(outcome, 'failed')
        self.assertEqual(self.verdicts(), [])
        [result] = self.results()
        self.assertIn('FAILED', result)
        self.assertIn('no clear final verdict, so it is not an approval: the reviewer exited 137', result)
        self.assertIn('Review: no clear verdict', result)

    async def test_4_a_reviewer_that_cannot_run_is_never_an_approval(self):
        async def broken(run):
            raise BrokenPipeError('sudo: a password is required')
        self.assertEqual(await run_card(self.state(), self.deps(reviewer=self.reviewer_says(broken))), 'failed')
        self.assertIn('the reviewer could not run: BrokenPipeError', self.results()[0])

    async def test_4_a_reviewer_past_its_time_limit_is_never_an_approval(self):
        timed_out = ReviewResult(stopped=True, reason='stopped by the graph after its 1200-second time limit',
                                 text=verdict('approve'))
        outcome = await run_card(self.state(), self.deps(reviewer=self.reviewer_says(timed_out)))
        self.assertEqual(outcome, 'failed')
        self.assertIn('The reviewer ran longer than its 20 min time limit', self.results()[0])
        self.assertEqual(self.verdicts(), [])

    async def test_5_a_reviewer_that_changed_the_candidate_is_voided_and_the_candidate_put_back(self):
        async def edits(run):
            (Path(run.worktree) / 'hello.txt').write_text('reviewer was here\n')
            (Path(run.worktree) / 'new.txt').write_text('x')
            return self.APPROVE
        outcome = await run_card(self.state(), self.deps(reviewer=self.reviewer_says(edits)))
        self.assertEqual(outcome, 'failed')
        [void] = [c for c in self.linear.comments if 'graph: review-voided' in c]
        self.assertIn('is **void**', void)
        self.assertIn('files in the working copy changed', void)
        self.assertEqual(self.verdicts(), [])  # its approval was never posted
        self.assertEqual(self.head(), self.saved().commit)
        self.assertEqual(sh(self.worktree, 'git', 'status', '--porcelain', '--untracked-files=all'), '')
        self.assertEqual((Path(self.worktree) / 'hello.txt').read_text(), 'hello 1\n')
        self.assertIn('the review was voided', self.results()[0])

    async def test_5_a_reviewer_that_committed_is_voided_and_its_commit_dropped(self):
        async def commits(run):
            (Path(run.worktree) / 'hello.txt').write_text('reviewer commit\n')
            sh(self.worktree, 'git', *workers.GIT_ID, 'commit', '-qam', 'reviewer')
            return self.APPROVE
        candidate = None

        async def remember(run):
            nonlocal candidate
            candidate = self.head()
            return await commits(run)
        self.assertEqual(await run_card(self.state(), self.deps(reviewer=self.reviewer_says(remember))), 'failed')
        [void] = [c for c in self.linear.comments if 'graph: review-voided' in c]
        self.assertIn(f'the commit moved from `{candidate[:12]}`', void)
        self.assertEqual(self.head(), candidate)

    async def test_a_stopped_card_goes_to_todd_only_when_the_reviewer_names_one_of_the_three_reasons(self):
        money = self.findings('F2: this needs a paid plan', todd='money_decision', todd_reason='It needs a paid plan.')
        await run_card(self.state(), self.deps(reviewer=self.reviewer_says(self.findings('F1: x'), money)))
        self.assertEqual(self.linear.assigned, ['JUL-1'])
        [stop] = [c for c in self.linear.comments if 'graph: review-stopped' in c]
        self.assertIn('needs Todd: a money decision. It needs a paid plan.', stop)
        self.assertTrue(any('Assigned to Todd' in c for c in self.linear.comments))

    async def test_findings_that_merely_mention_money_do_not_go_to_todd(self):
        await run_card(self.state(), self.deps(reviewer=self.reviewer_says(
            self.findings('the cost of this loop is quadratic'), self.findings('price field has no budget check'))))
        self.assertEqual(self.linear.assigned, [])

    async def test_the_reviewer_must_come_from_a_different_maker(self):
        deps = self.deps()
        deps.worker_makers = {'builder': 'Google', 'reviewer': 'google'}
        self.assertEqual(await run_card(self.state(), deps), 'failed')
        self.assertEqual(self.reviewer_calls, 0)
        self.assertIn('different model maker', self.results()[0])

    async def test_a_review_too_big_for_one_prompt_is_refused_not_cut_short(self):
        async def big(run, brief, *_):
            self.builder_calls += 1
            (Path(run.worktree) / 'big.txt').write_text('x\n' * (MAX_REVIEW_BYTES // 2))
            return BuildResult(True, report='big')
        self.assertEqual(await run_card(self.state(), self.deps(builder=big)), 'failed')
        self.assertEqual(self.reviewer_calls, 0)
        self.assertIn(f'over the {MAX_REVIEW_BYTES}-byte limit', self.results()[0])

    async def test_a_restart_during_the_review_reviews_again_without_rebuilding(self):
        async def dies(run):
            raise Crash()
        with self.assertRaises(Crash):
            await run_card(self.state(), self.deps(reviewer=self.reviewer_says(dies)))
        self.assertEqual(self.saved().step, 'review')
        self.builder_calls = 0
        self.assertEqual(await run_card(self.state(), self.deps(reviewer=self.reviewer_says(self.APPROVE))), 'passed')
        self.assertEqual(self.builder_calls, 0)
        self.assertEqual(len(self.verdicts()), 1)

    async def test_an_interrupted_findings_round_goes_back_to_the_candidate_not_the_base(self):
        async def build_then_die(run, brief, *_):
            self.builder_calls += 1
            (Path(run.worktree) / 'hello.txt').write_text(f'hello {run.attempt}\n')
            if self.builder_calls == 2:
                raise Crash()
            return BuildResult(True, report='built')
        with self.assertRaises(Crash):
            await run_card(self.state(), self.deps(builder=build_then_die,
                                                   reviewer=self.reviewer_says(self.findings('F1: x'))))
        candidate = self.saved().commit
        self.assertEqual(await run_card(self.state(), self.deps(reviewer=self.reviewer_says(self.APPROVE))), 'passed')
        self.assertEqual(sh(self.worktree, 'git', 'rev-list', '--reverse', f'{self.base}..HEAD').splitlines()[0], candidate)

    async def test_test_repairs_and_review_rounds_are_counted_apart(self):
        async def red_once(run, *_):
            self.tester_calls += 1
            if self.tester_calls == 1:
                return TestResult(passed=False, summary='tests 3, fail 1', failing=['greets'], details='boom')
            return TestResult(passed=True, summary='tests 3, pass 3, fail 0')
        outcome = await run_card(self.state(), self.deps(
            tester=red_once, reviewer=self.reviewer_says(self.findings('F1: x'), self.APPROVE)))
        self.assertEqual(outcome, 'passed')
        # build, test repair, review fix: three builder runs, and the review fix was told only the findings
        self.assertEqual(self.builder_calls, 3)
        self.assertIn('F1: x', self.brief)
        self.assertNotIn('boom', self.brief)

    async def test_the_builders_brief_names_the_starting_commit(self):
        await run_card(self.state(), self.deps())
        self.assertIn(f'This card starts from commit {self.base}.', self.brief)

    async def test_an_approval_that_does_not_answer_every_criterion_is_not_an_approval(self):
        cases = {
            'no criteria at all': [],
            'criterion named without its words': [{'id': 'AC1', 'criterion': 'something else', 'verdict': 'met', 'how': 'x'}],
            'met without saying how': [{'id': 'AC1', 'criterion': 'say hello', 'verdict': 'met', 'how': ' '}],
        }
        for name, criteria in cases.items():
            self.setUp()
            bare = ReviewResult(ok=True, verdict='approve', summary='fine', criteria=criteria)
            self.assertEqual(await run_card(self.state(), self.deps(reviewer=self.reviewer_says(bare))), 'failed', name)
            self.assertIn('its approval does not cover the acceptance criteria', self.results()[0], name)
            self.assertEqual(self.verdicts(), [], name)
            self.tearDown()

    async def test_5_an_ignored_file_the_reviewer_wrote_voids_the_review_and_is_removed(self):
        (self.repo / '.gitignore').write_text('.julia/\nnode_modules/\n')
        sh(self.repo, 'git', *workers.GIT_ID, 'add', '-A')
        sh(self.repo, 'git', *workers.GIT_ID, 'commit', '-q', '-m', 'ignore')
        self.base = sh(self.repo, 'git', 'rev-parse', 'HEAD')

        async def writes_ignored(run):
            (Path(run.worktree) / 'node_modules').mkdir(exist_ok=True)
            (Path(run.worktree) / '.julia').mkdir()
            (Path(run.worktree) / '.julia' / 'answer.json').write_text('{}')
            return self.APPROVE

        async def install_then_build(run, brief, *_):
            self.builder_calls += 1
            (Path(run.worktree) / 'node_modules').mkdir(exist_ok=True)
            (Path(run.worktree) / 'node_modules' / 'dep.js').write_text('installed')
            (Path(run.worktree) / 'hello.txt').write_text('hello 1\n')
            return BuildResult(True, report='built')
        outcome = await run_card(self.state(), self.deps(builder=install_then_build, reviewer=self.reviewer_says(writes_ignored)))
        self.assertEqual(outcome, 'failed')
        self.assertTrue(any('graph: review-voided' in c for c in self.linear.comments))
        self.assertFalse((self.worktree / '.julia').exists())
        self.assertTrue((self.worktree / 'node_modules' / 'dep.js').exists())  # installed dependencies are kept

    async def test_5_a_crash_right_after_a_tamper_is_seen_still_voids_it_and_never_reviews_again(self):
        async def edits(run):
            (Path(run.worktree) / 'hello.txt').write_text('reviewer was here\n')
            return self.APPROVE
        deps = self.deps(reviewer=self.reviewer_says(edits))
        real_restore = deps.restore

        async def dies(run, commit):
            if (Path(run.worktree) / 'hello.txt').read_text() == 'reviewer was here\n':
                raise Crash()  # the graph dies before it can put the working copy back
            await real_restore(run, commit)
        deps.restore = dies
        with self.assertRaises(Crash):
            await run_card(self.state(), deps)
        self.assertEqual((self.saved().step, self.saved().review.voided), ('report', True))
        self.assertEqual(await run_card(self.state(), self.deps(reviewer=self.reviewer_says(self.APPROVE))), 'failed')
        self.assertEqual(self.reviewer_calls, 1)  # no second review
        self.assertTrue(any('graph: review-voided' in c for c in self.linear.comments))
        self.assertEqual((Path(self.worktree) / 'hello.txt').read_text(), 'hello 1\n')

    async def test_a_review_starts_from_exactly_the_candidate(self):
        async def build_and_leave_a_mess(run, brief, *_):
            self.builder_calls += 1
            (Path(run.worktree) / 'hello.txt').write_text('hello 1\n')
            return BuildResult(True, report='built')

        async def dirty_after_tests(run, *_):
            (Path(run.worktree) / 'stray.txt').write_text('left by something')
            return TestResult(passed=True, summary='tests 3, pass 3, fail 0')
        seen = []

        async def looks(run):
            seen.append(sh(self.worktree, 'git', 'status', '--porcelain', '--untracked-files=all'))
            return self.APPROVE
        outcome = await run_card(self.state(), self.deps(builder=build_and_leave_a_mess, tester=dirty_after_tests,
                                                         reviewer=self.reviewer_says(looks)))
        self.assertEqual(outcome, 'passed')  # put back, then reviewed; the stray file was not the reviewer's doing
        self.assertEqual(seen, [''])
        [note] = [c for c in self.linear.comments if 'graph: review-drift' in c]
        self.assertIn('1 file(s) differ', note)

    async def test_a_reviewer_still_running_after_its_limit_is_named_and_no_new_review_starts(self):
        # The seat's Pi child can outlive the seat, and the graph cannot signal runner's processes:
        # it says the reviewer is still running and holds any new review until it ends.
        async def times_out_leaving_pi(run):
            self.alive['reviewer'] = [4242]  # the seat's Pi child, still running
            return ReviewResult(stopped=True, reason='stopped by the graph after its 1200-second time limit')
        outcome = await run_card(self.state(), self.deps(reviewer=self.reviewer_says(times_out_leaving_pi),
                                                         alive_after_wait=[4242]))
        self.assertEqual(outcome, 'failed')
        [result] = self.results()
        self.assertIn('still running (process 4242), so no new review starts until it ends', result)

    async def test_a_crash_between_saving_a_verdict_and_posting_it_still_posts_it_and_keeps_the_round(self):
        deps = self.deps(reviewer=self.reviewer_says(self.findings('F1: x'), self.APPROVE))
        real = deps.linear.comment

        async def dies_on_verdict(card, body):
            if 'graph: review-verdict' in body:
                raise Crash()
            return await real(card, body)
        deps.linear.comment = dies_on_verdict
        with self.assertRaises(Crash):
            await run_card(self.state(), deps)
        saved = self.saved()
        self.assertEqual((saved.step, saved.fixing, len(saved.round_reasons)), ('build', 'review', 1))
        deps.linear.comment = real
        outcome = await run_card(self.state(), self.deps(reviewer=self.reviewer_says(self.APPROVE)))
        self.assertEqual(outcome, 'passed')
        self.assertEqual(self.reviewer_calls, 2)  # round 1 was not reviewed again
        found, approved = self.verdicts()
        self.assertIn('F1: x', found)
        self.assertIn('F1: x', self.brief)  # the builder still got round 1's findings


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

    def test_the_failure_details_for_the_builder_come_from_the_reporters_failing_tests_section(self):
        output = ('✔ says hi (1ms)\n✖ greets politely (2ms)\n  AssertionError: early copy\nℹ tests 2\nℹ pass 1\nℹ fail 1\n'
                  'ℹ duration_ms 9\n\n✖ failing tests:\n\ntest at scripts/a.test.mjs:3:1\n✖ greets politely (2ms)\n'
                  '  AssertionError: expected "hello"\n')
        result = workers.suite_result(1, output)
        self.assertTrue(result.details.startswith('✖ failing tests:'))
        self.assertIn('AssertionError: expected "hello"', result.details)
        self.assertNotIn('says hi', result.details)
        # no such section: the end of the output instead, capped
        self.assertEqual(workers.suite_result(1, 'x' * 20000).details, 'x' * workers.MAX_DETAILS)

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

    # the reviewer's reply, as run-pi-seat.mjs prints it

    def test_the_final_message_is_read_from_a_real_pi_stream(self):
        fixture = REPO_ROOT / 'graph' / 'fixtures' / 'orca-1.4.205' / 'cost.pi.seat-json-stream.multi-turn.jsonl'
        text, error = workers.pi_final(fixture.read_text())
        self.assertIsNone(error)
        self.assertIn('julia-next', text)  # the turn's last message, after a tool call and an agent_end
        cut = '\n'.join(line for line in fixture.read_text().splitlines() if '"stopReason":"stop"' not in line)
        self.assertEqual(workers.pi_final(cut)[0], '')  # a message that ended in a tool call is not final

    def test_the_final_messages_closing_json_is_the_verdict(self):
        answers = {'criteria': met('say hello')}
        result = workers.reviewer_outcome(0, pi_stream(verdict('approve', summary='checked', **answers)), '')
        self.assertTrue(result.ok)
        self.assertEqual((result.verdict, result.summary, result.criteria), ('approve', 'checked', met('say hello')))
        fenced = workers.reviewer_outcome(0, pi_stream('```json\n' + json.dumps({'verdict': 'approve'}) + '\n```'), '')
        self.assertEqual(fenced.verdict, 'approve')

    def test_an_approve_written_earlier_is_not_the_final_verdict(self):
        cases = {
            'a later message with no verdict': pi_stream(verdict('approve'), 'Wait, let me look again.'),
            'text after the verdict': pi_stream(verdict('approve') + '\nActually, one more problem.'),
            'no verdict object at all': pi_stream('VERDICT: APPROVE'),
            'a verdict the role file does not know': pi_stream(verdict('lgtm')),
        }
        for name, stream in cases.items():
            result = workers.reviewer_outcome(0, stream, '')
            self.assertFalse(result.ok, name)
            self.assertIsNone(result.verdict, name)
        later = workers.reviewer_outcome(0, pi_stream(verdict('approve'), verdict('changes_needed', findings='F1')), '')
        self.assertEqual((later.verdict, later.findings), ('changes_needed', 'F1'))

    def test_an_approval_with_a_criterion_not_met_is_not_clear(self):
        unmet = {'criteria': [{'id': 'AC1', 'verdict': 'met'}, {'id': 'AC2', 'verdict': 'not_met', 'how': 'no test'}]}
        self.assertFalse(workers.reviewer_outcome(0, pi_stream(verdict('approve', **unmet)), '').ok)
        found = workers.reviewer_outcome(0, pi_stream(verdict('changes_needed', **unmet)), '')
        self.assertEqual(found.findings, '- AC2: no test')

    def test_a_crash_a_vendor_error_or_a_stop_is_never_an_approval(self):
        # the stream the seat printed live on 25 Sep when the reviewer's weekly allowance ran out
        limit = ('429: {"message":"You\'ve reached your weekly usage limit for your plan.",'
                 '"type":"rate_limit_error","code":"RATE_LIMITED"}')
        cases = {
            'vendor error, exit 1': (1, pi_stream('', stop='error', error=limit), 'reached your weekly usage limit'),
            'vendor error, exit 0': (0, pi_stream(verdict('approve'), stop='error', error='overloaded'), 'overloaded'),
            'killed after writing approve': (137, pi_stream(verdict('approve')), 'exited 137'),
            'nothing printed': (0, '', 'does not end with a verdict'),
        }
        for name, (status, stream, reason) in cases.items():
            result = workers.reviewer_outcome(status, stream, '')
            self.assertFalse(result.ok, name)
            self.assertIn(reason, result.reason, name)
        stopped = workers.reviewer_outcome(workers.STOPPED_EXIT, pi_stream(verdict('approve')), 'stopped by the graph')
        self.assertTrue(stopped.stopped)
        self.assertFalse(stopped.ok)

    def test_only_the_three_named_reasons_go_to_todd(self):
        says = lambda todd: workers.reviewer_outcome(0, pi_stream(verdict('changes_needed', findings='F', todd=todd, todd_reason='r')), '')
        self.assertEqual(says('product_decision').todd, 'product_decision')
        self.assertIsNone(says('whatever').todd)
        self.assertEqual(says('whatever').todd_reason, '')

    def test_the_reviewer_is_started_exactly_as_its_sudo_rule_allows(self):
        rules = (REPO_ROOT / 'ops' / 'julia-runner' / 'sudoers').read_text()
        command = workers.sudo_command('reviewer')
        self.assertEqual(command[:5], ['sudo', '-n', '-u', 'runner', '--'])
        self.assertIn(f"orchestrator-svc ALL=(runner) NOPASSWD: {' '.join(command[5:])}\n", rules)

    def test_the_reviewers_account_is_shared_so_only_the_seat_or_its_model_counts(self):
        with tempfile.TemporaryDirectory() as d:
            proc = Path(d)
            for pid, cmd in {'10': ['/opt/Orca/orca-ide', '--serve'],
                             '11': ['/usr/bin/node', workers.WORKER_COMMANDS['reviewer'][1], 'reviewer-backup'],
                             '12': ['node', '/usr/bin/pi', '--model', workers.REVIEWER_MODEL, '-p']}.items():
                (proc / pid).mkdir()
                (proc / pid / 'cmdline').write_bytes(b'\0'.join(c.encode() for c in cmd) + b'\0')
                (proc / pid / 'status').write_text('Uid:\t1001\t1001\t1001\t1001\n')
            with mock.patch.object(workers, 'account_uid', return_value=1001):
                self.assertEqual(workers.live_workers('reviewer', proc=proc), [11, 12])


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

    async def test_a_test_worker_that_does_not_answer_names_no_failure_for_the_builder(self):
        # review finding: a lint call the worker never answered is not a lint failure to repair
        for replies in ([(None, 'the test worker did not answer (exit 1): sudo: a password is required', False)],
                        [(0, 'lint ok', False), (None, 'the test worker did not answer (exit 1): boom', False)]):
            replies = iter(replies)

            async def ask(run, what, limit, progress):
                return next(replies)
            result = await workers.tester(None, 900, None, ask=ask)
            self.assertFalse(result.passed)
            self.assertEqual(result.failing, [])
            self.assertIn('the test worker did not answer', result.summary)

    async def test_ask_tester_gives_no_status_when_the_worker_does_not_answer(self):
        run = CardRun(card='JUL-1', base='b', branch='graph/card-1', worktree='/w')
        cases = [((1, '', 'sudo: a password is required\n'), (None, 'password is required')),
                 ((0, '{"status": 1, "output": "ℹ fail 1"}\n', ''), (1, 'ℹ fail 1'))]
        for reply, (want_status, want_output) in cases:
            async def run_worker(kind, request, on_line=None, reply=reply):
                return reply
            with mock.patch.object(workers, 'run_worker', run_worker):
                status, output, stopped = await workers.ask_tester(run, 'lint', 60, None)
            self.assertEqual(status, want_status)
            self.assertIn(want_output, output)
            self.assertFalse(stopped)

    async def test_a_failed_lint_is_named_and_its_output_goes_to_the_builder(self):
        replies = iter([(1, 'eslint\nscripts/a.mjs:3 no-unused-vars', False), (0, 'ℹ tests 1\nℹ pass 1\nℹ fail 0\n', False)])

        async def ask(run, what, limit, progress):
            return next(replies)
        result = await workers.tester(None, 900, None, ask=ask)
        self.assertFalse(result.passed)
        self.assertEqual(result.failing, ['lint: scripts/a.mjs:3 no-unused-vars'])
        self.assertIn('scripts/a.mjs:3 no-unused-vars', result.details)

    async def test_the_graph_stops_the_process_it_started_past_its_limit(self):
        # Only the process the graph started (sudo, on the server): a grandchild it leaves is caught by
        # live_workers and reported (test_a_reviewer_still_running_after_its_limit_is_named...).
        with mock.patch.object(workers, 'sudo_command', return_value=[sys.executable, '-c', 'import time; time.sleep(30)']):
            status, _, err = await workers.run_worker('reviewer', 'brief', limit_seconds=1)
        self.assertEqual(status, workers.STOPPED_EXIT)
        self.assertIn('1-second time limit', err)

    async def test_the_reviewer_gets_its_brief_as_plain_text_from_the_root_folder(self):
        seen = {}

        async def run_worker(kind, request, on_line=None, cwd=None, limit_seconds=None):
            seen.update(kind=kind, request=request, cwd=cwd, limit=limit_seconds)
            return 0, pi_stream(verdict('approve')), ''
        run = CardRun(card='JUL-1', base='b', branch='graph/card-1', worktree='/w')
        with mock.patch.object(workers, 'run_worker', run_worker):
            result = await workers.reviewer(lambda line: None)(run, 'the brief', 1200, None)
        self.assertEqual(seen, {'kind': 'reviewer', 'request': 'the brief', 'cwd': '/', 'limit': 1200})
        self.assertEqual(result.verdict, 'approve')

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
