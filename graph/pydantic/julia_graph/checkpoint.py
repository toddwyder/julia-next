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


class ReviewResult(BaseModel):
    ok: bool = True
    verdict: str | None = None  # 'approve' | 'findings'
    summary: str = ''
    findings: str | None = None
    reason: str | None = None
    report: str | None = None
    stopped: bool = False
    tampered: bool = False
    voided: bool = False
    void_reason: str | None = None
    reviewer: str | None = None
    company: str | None = None
    maker: str | None = None


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
    step: Step = 'prepare'
    # True once a builder has been started for the current attempt. A restart
    # that finds it still set knows the builder never finished.
    build_started: bool = False
    attempt: int = 0
    commit: str | None = None
    builder_report: str | None = None
    tests: TestResult | None = None
    review: ReviewResult | None = None
    prior_findings: str | None = None
    round_reasons: list[str] = []
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
