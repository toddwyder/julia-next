"""The card's saved progress, kept by the graph itself.

pydantic-graph 2.49.0 has no persistence of its own (the 1.x
``FileStatePersistence`` is gone), so the graph saves its state here after
every step. One JSON file per card, replaced atomically, so a crash leaves
either the old state or the new one, never half of each. A lock file held for
the whole run keeps a second graph for the same card from starting at all.
"""

from __future__ import annotations

import fcntl
import os
from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

Step = Literal['prepare', 'build', 'test', 'review', 'report', 'done']


class TestResult(BaseModel):
    passed: bool
    summary: str
    failing: list[str] = []
    # True when the test run was stopped for running past its time limit.
    stopped: bool = False
    # What the failures said (the reporter's "failing tests" section, or the
    # lint's output), for the builder's repair brief.
    details: str = ''


class ReviewResult(BaseModel):
    """One review, as read from the reviewer's final message (JUL-128)."""
    # True only when the final message ended with a clear verdict. A crash, a
    # timeout, an abnormal exit or a missing verdict leaves it False, and
    # False is never an approval.
    ok: bool = False
    verdict: Literal['approve', 'changes_needed'] | None = None
    summary: str = ''
    findings: str = ''
    # Set only when the reviewer says the findings need Todd: an account
    # action, a money decision or a product decision (graph.TODD_REASONS).
    todd: str | None = None
    todd_reason: str = ''
    # The reviewer's answer for each acceptance criterion, as its role file asks:
    # [{id, criterion, verdict, how}]. An approval must cover every one (graph.criteria_gaps).
    criteria: list[dict] = []
    reason: str | None = None  # why there is no verdict
    stopped: bool = False  # ran past its time limit
    voided: bool = False  # it changed the candidate, so it does not count
    text: str = ''  # the reviewer's final message
    # Filled in by the graph: who reviewed, as the card shows it, and which round.
    reviewer: str = ''
    round: int = 0
    # The model the reviewer itself reports it ran (run-reviewer.mjs), or None.
    model: str | None = None


class StepMark(BaseModel):
    """One line of the card's "Where this card is" comment."""
    doing: str  # 'Building (attempt 1)'
    done: str  # 'Built (attempt 1)'
    worker: str | None = None
    limit: int | None = None  # seconds
    started: datetime
    ended: datetime | None = None
    # None while running; 'done', or what went wrong in a few words.
    outcome: str | None = None


class CardRun(BaseModel):
    card: str
    base: str
    branch: str
    worktree: str
    # Selected through MODEL_CATALOG and pinned for every resumed attempt.
    builder_model: str | None = None
    reviewer_model: str | None = None
    step: Step = 'prepare'
    # True once a builder has been started for the current attempt. A restart
    # that finds it still set knows the builder never finished.
    build_started: bool = False
    attempt: int = 0  # builder runs on this card, repairs included
    tries: int = 0  # builder runs for the current build or repair; an interrupted one is tried again
    # Failed tests the builder has been given to repair, and the commit that
    # repair starts from: the failed candidate. An interrupted repair goes back
    # to it, never to the base, so the first build's work is kept.
    repairs: int = 0
    repair_from: str | None = None
    # Every test run's summary, oldest first, for the result comment.
    test_rounds: list[str] = []
    commit: str | None = None
    builder_report: str | None = None
    tests: TestResult | None = None
    # The independent review (JUL-128): the latest review, the findings each
    # unsuccessful round gave the builder, and what the builder is fixing now
    # ('tests' for failed tests, 'review' for review findings, None at first).
    review: ReviewResult | None = None
    round_reasons: list[str] = []
    fixing: Literal['tests', 'review'] | None = None
    # Set when a stopped card needs Todd: one of graph.TODD_REASONS.
    needs_todd: str | None = None
    # The working copy as a review found it (HEAD, status with the dependency
    # fingerprint), saved before the reviewer starts and cleared with its
    # outcome: a restart that finds it set knows a review was interrupted.
    review_before: list[str] | None = None
    # The marker lines of the comments this run has posted (graph.say_once),
    # so it need not ask Linear again. What keeps a comment from ever being
    # posted twice is its own id (graph.comment_id), which Linear will not repeat.
    posted: list[str] = []
    failure: str | None = None
    # The card's one "Where this card is" comment (JUL-126).
    status_id: str | None = None
    marks: list[StepMark] = []
    moved_at: datetime | None = None  # the last time anything happened
    shown_at: datetime | None = None  # the last time the comment was edited
    ending: str | None = None  # the comment's closing line, once the run is over
    # A worker stopped for running too long whose end the graph has yet to see:
    # its kind and how long it ran. Saved first, so a crash while confirming the
    # stop is resumed as that confirmation, never as a new worker.
    stop_kind: str | None = None
    stop_ran: float = 0
    # The card's "## UAT plan" section as it was when the card started (JUL-127).
    # Later edits to the card do not change it; only an Instruction comment does.
    uat_plan: str | None = None
    uat_locked_at: datetime | None = None


class CardLocked(Exception):
    """Another graph run already holds this card."""


class Checkpoint:
    def __init__(self, state_dir: Path, card: str):
        self.path = Path(state_dir) / f'{card}.json'
        self._lock_path = Path(state_dir) / f'{card}.lock'
        self._lock = None

    def lock(self) -> None:
        self._lock = open(self._lock_path, 'a')
        try:
            fcntl.flock(self._lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self._lock.close()
            self._lock = None
            raise CardLocked(f'another graph run is already working on {self.path.stem}') from None

    def unlock(self) -> None:
        if self._lock:
            self._lock.close()
            self._lock = None

    def load(self) -> CardRun | None:
        try:
            return CardRun.model_validate_json(self.path.read_text())
        except FileNotFoundError:
            return None

    def save(self, run: CardRun) -> None:
        tmp = self.path.with_suffix('.tmp')
        with open(tmp, 'w') as f:
            f.write(run.model_dump_json(indent=2))
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self.path)
