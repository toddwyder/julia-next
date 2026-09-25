"""ops/julia-runner/reap.py, the reviewer's subreaper (JUL-128): its sweep and its /proc walk.

The real-process checks (setsid, double fork, a child forking while stopped)
are in scripts/julia-runner-reviewer.test.mjs; these pin the logic a timing
test cannot: a process that forks between being listed and being killed.
"""

from __future__ import annotations

import importlib.util
import signal
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('reap', REPO_ROOT / 'ops' / 'julia-runner' / 'reap.py')
reap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reap)


class Pretend:
    """Processes below the reaper, a kill that acts on them, and a clock."""

    def __init__(self, *pids, forks_when_killed=None, unkillable=()):
        self.alive = set(pids)
        self.forks = dict(forks_when_killed or {})  # pid -> the child it starts as SIGKILL lands
        self.unkillable = set(unkillable)
        self.signals: list[tuple[int, int]] = []
        self.t = 0.0

    def listed(self):
        return sorted(self.alive)

    def kill(self, pid, sig):
        if pid not in self.alive:
            raise ProcessLookupError(pid)
        self.signals.append((pid, sig))
        if sig == signal.SIGKILL and pid not in self.unkillable:
            self.alive.discard(pid)
            if child := self.forks.pop(pid, None):
                self.alive.add(child)  # forked after the reaper looked, before the kill landed

    def pause(self, seconds):
        self.t += seconds

    def sweep(self):
        return reap.sweep(listed=self.listed, kill=self.kill, reap=lambda: None, pause=self.pause, clock=lambda: self.t)


class SweepTest(unittest.TestCase):
    def test_a_child_forked_while_its_parent_is_being_killed_is_killed_too(self):
        world = Pretend(10, forks_when_killed={10: 11, 11: 12})  # a chain of forks racing the kills
        self.assertEqual(world.sweep(), [])
        self.assertEqual(world.alive, set())
        self.assertIn((12, signal.SIGKILL), world.signals)

    def test_sigterm_comes_first(self):
        world = Pretend(10)
        world.sweep()
        self.assertEqual(world.signals[0], (10, signal.SIGTERM))

    def test_what_will_not_die_is_returned_after_the_deadline(self):
        world = Pretend(10, 20, unkillable=[20])
        self.assertEqual(world.sweep(), [20])
        self.assertGreaterEqual(world.t, reap.KILL_SECONDS)


class BelowTest(unittest.TestCase):
    def test_the_parent_chain_is_followed_and_zombies_are_not_listed(self):
        with tempfile.TemporaryDirectory() as d:
            proc = Path(d)
            # pid: (comm, state, ppid). 100 is the reaper; 104 is a zombie whose child 105 still runs.
            table = {100: ('python3', 'S', 1), 101: ('node', 'S', 100), 102: ('sleep) (x', 'S', 101),
                     103: ('orca', 'S', 1), 104: ('sh', 'Z', 100), 105: ('sleep', 'S', 104)}
            for pid, (comm, state, ppid) in table.items():
                (proc / str(pid)).mkdir()
                (proc / str(pid) / 'stat').write_text(f'{pid} ({comm}) {state} {ppid} 1 1 0 -1\n')
            self.assertEqual(sorted(reap.below(100, str(proc))), [101, 102, 105])
